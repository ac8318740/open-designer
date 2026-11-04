// React design builds for design systems with `framework: "react"`.
//
// A design or design-system page whose file ends in .tsx default-exports a
// component. The launcher builds it with esbuild each time the frame asks for
// it, which the viewer does on every save, into
// .open-designer/.build/<same path>.html, .js, and .css. Packages from
// node_modules (React, Radix, ...) go into one vendor bundle per design system
// and reach each page through window.__odVendor, so a page rebuild stays small.
// buildSingleFile instead inlines one page, all its variants, and a production
// vendor bundle into one HTML file for hosts without an OpenDesigner server.
//
// `@ds/<name>` imports resolve to the design system's components/ folder, or
// to the project's real primitives once manifest.shippedComponents is set.
// Each file's nearest tsconfig.json still resolves its own path aliases.
//
// CSS comes from the project's own Tailwind, run on the design system's
// stylesheet (see designSystemOf) over the classes the page bundle contains.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { injectBridge } from "./finalize.mjs";
import { inlineHtmlDesign, inlineScript, inlineStyle } from "./html-inline.mjs";

const RUNTIME = fileURLToPath(new URL("./react-runtime.js", import.meta.url));
const TYPECHECK = fileURLToPath(new URL("./typecheck.mjs", import.meta.url));
const BRIDGE = fileURLToPath(new URL("../viewer/dist/od-bridge.js", import.meta.url));
const SKIP = Symbol("od-skip");

// Data-root-relative paths that build as React pages.
export const REACT_PAGE = /^(designs\/[^/]+|design-systems\/[^/]+\/pages)\/[^/]+\.tsx$/;

// One build at a time: builds share the vendor bundle, and the VM is small.
let queue = Promise.resolve();

/**
 * Build one React page and return its HTML. A failed build returns an HTML
 * page that shows the error instead.
 *
 * @param {string} dataRoot  Absolute path of .open-designer
 * @param {string} rel  Page path relative to dataRoot, matching REACT_PAGE
 * @returns {Promise<string>}
 */
export function buildReactPage(dataRoot, rel) {
  const run = queue.then(() => build(dataRoot, rel)).catch((err) => errorPage(err));
  queue = run;
  return run;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// The design system a page belongs to, where its components live, and the
// stylesheet Tailwind compiles: manifest.stylesheet (relative to shippedTo,
// or to the project root), else the design system's own styles.css.
function designSystemOf(dataRoot, rel) {
  const parts = rel.split("/");
  const name = parts[0] === "design-systems" ? parts[1] : readJson(join(dataRoot, "designs", parts[1], "index.json"))?.designSystem;
  if (!name) return { name: null, componentsDir: null, sourceRoot: null, shipped: false, stylesheet: null, ownDir: null, dsDir: null };
  const dir = join(dataRoot, "design-systems", name);
  const manifest = readJson(join(dir, "manifest.json")) ?? {};
  const appRoot = resolve(manifest.shippedTo ?? dirname(dataRoot));
  const own = join(dir, "styles.css");
  const stylesheet = manifest.stylesheet ? resolve(appRoot, manifest.stylesheet) : existsSync(own) ? own : null;
  if (manifest.shippedComponents) {
    // ownDir still holds components the design loop added after shipping.
    const ownDir = join(dir, "components");
    return { name, componentsDir: resolve(appRoot, manifest.shippedComponents), sourceRoot: appRoot, shipped: true, stylesheet, ownDir, dsDir: dir };
  }
  return { name, componentsDir: join(dir, "components"), sourceRoot: dir, shipped: false, stylesheet, ownDir: null, dsDir: dir };
}

const inside = (path, dir) => !!dir && path.startsWith(dir + sep);
const inNodeModules = (path) => path.includes(`${sep}node_modules${sep}`);

// Fixture paths are relative to the ACStack element folder that holds them.
function fixturePath(projectRoot, path) {
  const m = /[\\/]elements[\\/][^\\/]+[\\/](.+)$/.exec(path);
  return m ? m[1].replace(/\\/g, "/") : relative(projectRoot, path).replace(/\\/g, "/");
}

// Resolve a package from the first directory that has it. A monorepo app
// keeps its packages beside its components or stylesheet, not at the root.
function resolveFrom(spec, dirs) {
  for (const dir of dirs.filter(Boolean)) {
    try {
      return createRequire(join(dir, "noop.js")).resolve(spec);
    } catch {
      /* try the next directory */
    }
  }
  return null;
}

const defineFor = (prod) => ({ "process.env.NODE_ENV": prod ? '"production"' : '"development"' });

/**
 * Bundle one page without its packages. `only` guards the mount so a
 * single-file build can carry every variant and render the one its
 * <meta name="od-variant"> names.
 */
async function bundlePage(esbuild, dataRoot, rel, ds, { prod, vendor, only }) {
  const projectRoot = dirname(dataRoot);
  const page = join(dataRoot, rel);
  const needed = {};

  const plugin = {
    name: "open-designer",
    setup(b) {
      b.onResolve({ filter: /^@ds\// }, async (args) => {
        if (!ds.componentsDir) return { errors: [{ text: `${args.path}: this page has no design system` }] };
        const r = await b.resolve(`./${args.path.slice(4)}`, { kind: args.kind, resolveDir: ds.componentsDir });
        return r.errors.length && ds.ownDir ? b.resolve(`./${args.path.slice(4)}`, { kind: args.kind, resolveDir: ds.ownDir }) : r;
      });
      // Anything that resolves into node_modules comes from the vendor bundle.
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData === SKIP) return undefined;
        const opts = { kind: args.kind, importer: args.importer, pluginData: SKIP };
        let r = await b.resolve(args.path, { ...opts, resolveDir: args.resolveDir });
        // A monorepo app keeps its packages beside its components, not at the root.
        if (r.errors.length && ds.componentsDir) r = await b.resolve(args.path, { ...opts, resolveDir: ds.componentsDir });
        if (r.errors.length || !inNodeModules(r.path) || r.path.endsWith(".css")) return r;
        needed[args.path] = vendor[args.path] ?? r.path;
        return { path: args.path, namespace: "od-vendor" };
      });
      b.onLoad({ filter: /.*/, namespace: "od-vendor" }, (args) => ({
        contents: `module.exports = window.__odVendor[${JSON.stringify(args.path)}];`,
        loader: "js",
      }));
      b.onLoad({ filter: /\.json$/ }, (args) => {
        if (inNodeModules(args.path)) return undefined;
        const data = JSON.stringify(JSON.parse(readFileSync(args.path, "utf8")));
        return {
          contents: `import { fixture } from ${JSON.stringify(RUNTIME)};\nexport default fixture(${data}, ${JSON.stringify(fixturePath(projectRoot, args.path))});`,
          loader: "js",
        };
      });
      // Design-system components tag their own exports for the runtime.
      b.onLoad({ filter: /\.[jt]sx?$/ }, (args) => {
        const own = inside(args.path, ds.ownDir);
        if (!own && !inside(args.path, ds.componentsDir)) return undefined;
        const source = relative(own ? ds.dsDir : ds.sourceRoot, args.path).replace(/\\/g, "/");
        return {
          contents:
            readFileSync(args.path, "utf8") +
            `\nimport * as __odSelf from ${JSON.stringify(args.path)};` +
            `\nimport { mark as __odMark } from ${JSON.stringify(RUNTIME)};` +
            `\n__odMark(__odSelf, ${JSON.stringify(source)});\n`,
          loader: args.path.split(".").pop(),
        };
      });
    },
  };

  const mount = "mount(createRoot, createElement, Page);";
  const result = await esbuild.build({
    stdin: {
      contents: [
        `import Page from ${JSON.stringify(page)};`,
        `import { createElement } from "react";`,
        `import { createRoot } from "react-dom/client";`,
        `import { mount } from ${JSON.stringify(RUNTIME)};`,
        only ? `if (document.querySelector('meta[name="od-variant"]')?.content === ${JSON.stringify(only)}) ${mount}` : mount,
      ].join("\n"),
      resolveDir: dirname(page),
      sourcefile: rel,
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    define: defineFor(prod),
    minify: prod,
    outfile: join(dataRoot, ".build", rel.replace(/\.tsx$/, ".js")),
    write: false,
    logLevel: "silent",
    plugins: [plugin],
  });
  const text = (ext) => result.outputFiles.filter((f) => f.path.endsWith(ext)).map((f) => f.text).join("\n");
  return { js: text(".js"), css: text(".css"), needed };
}

async function bundleVendor(esbuild, projectRoot, packages, prod) {
  const result = await esbuild.build({
    stdin: {
      contents: `window.__odVendor = {${Object.entries(packages)
        .map(([spec, path]) => `${JSON.stringify(spec)}: require(${JSON.stringify(path)})`)
        .join(",\n")}};`,
      resolveDir: projectRoot,
      sourcefile: "od-vendor.js",
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    define: defineFor(prod),
    minify: prod,
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/**
 * Compile the design system's stylesheet with the project's own Tailwind
 * over the class candidates in `content`. Returns "" with no stylesheet.
 */
async function tailwindCss(ds, projectRoot, content, prod) {
  if (!ds.stylesheet) return "";
  if (!existsSync(ds.stylesheet)) throw new Error(`stylesheet not found: ${ds.stylesheet}`);
  const dirs = [dirname(ds.stylesheet), ds.componentsDir, projectRoot];
  const node = resolveFrom("@tailwindcss/node", dirs);
  const oxide = resolveFrom("@tailwindcss/oxide", dirs);
  if (!node || !oxide) throw new Error(`${ds.stylesheet} needs Tailwind v4: install tailwindcss and @tailwindcss/postcss beside it`);
  const { compile, optimize } = await import(pathToFileURL(node).href);
  const { Scanner } = createRequire(oxide)(oxide);
  const compiler = await compile(readFileSync(ds.stylesheet, "utf8"), {
    base: dirname(ds.stylesheet),
    from: ds.stylesheet,
    onDependency: () => {},
  });
  const css = compiler.build(new Scanner({}).scanFiles([{ content, extension: "js" }]));
  // optimize flattens nesting for older browsers, as the PostCSS plugin does.
  return optimize ? optimize(css, { file: ds.stylesheet, minify: prod }).code : css;
}

async function build(dataRoot, rel) {
  const esbuild = await import("esbuild");
  const projectRoot = dirname(dataRoot);
  const ds = designSystemOf(dataRoot, rel);
  const buildRoot = join(dataRoot, ".build");
  const out = join(buildRoot, rel.replace(/\.tsx$/, ""));
  const vendorBase = join(buildRoot, "_vendor", ds.name ?? "_none");
  const vendor = readJson(`${vendorBase}.json`) ?? {};

  const { js, css, needed } = await bundlePage(esbuild, dataRoot, rel, ds, { prod: false, vendor });
  const styles = [await tailwindCss(ds, projectRoot, js, false), css].filter(Boolean).join("\n");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.js`, js);
  writeFileSync(`${out}.css`, styles);

  // shortcut: the vendor bundle only rebuilds when a page needs a new package,
  // so upgrading a package in node_modules needs `rm -r .open-designer/.build`.
  if (Object.keys(needed).some((spec) => !(spec in vendor)) || !existsSync(`${vendorBase}.js`)) {
    const all = { ...vendor, ...needed };
    mkdirSync(dirname(vendorBase), { recursive: true });
    writeFileSync(`${vendorBase}.js`, await bundleVendor(esbuild, projectRoot, all, false));
    writeFileSync(`${vendorBase}.json`, JSON.stringify(all, null, 2));
  }
  writeFileSync(join(buildRoot, ".gitignore"), "*\n");

  const url = (abs) => `/data/${relative(dataRoot, abs).split(sep).join("/")}`;
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles ? `<link rel="stylesheet" href="${url(`${out}.css`)}">\n` : ""}</head>
<body>
<div id="od-root"></div>
<script src="${url(`${vendorBase}.js`)}"></script>
<script src="${url(`${out}.js`)}"></script>
</body>
</html>
`;
  writeFileSync(`${out}.html`, html);
  return html;
}

// Token sheets in parent-to-child order, as the viewer sends them.
function tokenSheets(dataRoot, name, seen = new Set()) {
  if (!name || seen.has(name)) return [];
  seen.add(name);
  const dir = join(dataRoot, "design-systems", name);
  const parent = readJson(join(dir, "manifest.json"))?.extends;
  const own = existsSync(join(dir, "tokens.css")) ? [{ name, css: readFileSync(join(dir, "tokens.css"), "utf8") }] : [];
  return [...tokenSheets(dataRoot, parent, seen), ...own];
}

// HTML variants are whole documents, so the single file carries each one
// base64-encoded and writes the one <meta name="od-variant"> names while the
// page parses. document.write keeps the parser's script order and timing.
const HTML_BOOT = `(function () {
  var id = document.querySelector('meta[name="od-variant"]').getAttribute("content");
  var el = document.getElementById("od-variant-" + id) || document.querySelector('script[id^="od-variant-"]');
  var bytes = Uint8Array.from(atob(el.textContent.trim()), function (c) { return c.charCodeAt(0); });
  document.write(new TextDecoder().decode(bytes).replace(/^\\s*<!doctype[^>]*>/i, ""));
})();`;

/**
 * Write one design page, every variant, and its tweak definitions as one
 * self-contained HTML file: production React, minified, with the bridge
 * inlined as <script data-od-bridge>. The variant shown is the one
 * <meta name="od-variant" content="..."> names; a host switches variant by
 * rewriting that content and reloading. <script type="application/json"
 * id="od-page"> holds the variant list and the tweak definitions.
 *
 * @param {string} dataRoot  Absolute path of .open-designer
 * @param {string} design
 * @param {string} pageId
 * @param {string} [outPath]  Defaults to .build/single/<design>/<page>.html
 * @returns {Promise<{ path: string, size: number, design: string, page: string, variant: string, variants: string[] }>}
 */
export async function buildSingleFile(dataRoot, design, pageId, outPath) {
  const esbuild = await import("esbuild");
  const projectRoot = dirname(dataRoot);
  const index = readJson(join(dataRoot, "designs", design, "index.json"));
  if (!index) throw new Error(`no readable designs/${design}/index.json`);
  const page = index.pages?.find((p) => p.id === pageId);
  if (!page) throw new Error(`design ${design} has no page ${pageId}; pages: ${(index.pages ?? []).map((p) => p.id).join(", ") || "none"}`);
  const variants = page.variants ?? [];
  if (variants.length === 0) throw new Error(`page ${pageId} has no variants`);
  const kind = (v) => (v.file?.endsWith(".tsx") ? "React" : v.file?.endsWith(".html") ? "HTML" : null);
  const odd = variants.find((v) => !kind(v) || kind(v) !== kind(variants[0]));
  const outside = variants.find((v) => !resolve(dataRoot, "designs", design, v.file ?? "").startsWith(join(dataRoot, "designs", design) + sep));
  if (outside) throw new Error(`variant ${outside.id} (${outside.file}) is outside designs/${design}`);
  if (odd) throw new Error(`variant ${odd.id} (${odd.file}) does not match: a page's variants must all be .tsx or all be .html`);
  if (!existsSync(BRIDGE)) throw new Error(`the bridge build is missing at ${BRIDGE}; run npm run build:viewer`);

  const ds = designSystemOf(dataRoot, `designs/${design}/x.tsx`);
  const meta = {
    design,
    designSystem: ds.name,
    page: { id: page.id, label: page.label, tweaks: page.tweaks ?? [] },
    designTweaks: index.tweaks ?? [],
    variants: variants.map(({ id, label, file, tweaks, discardReason }) => ({ id, label, file, tweaks: tweaks ?? [], discardReason })),
  };
  const head = `<meta name="od-variant" content="${escapeId(variants[0].id)}">
<script type="application/json" id="od-page">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>`;
  const write = (doc) => {
    const path = resolve(outPath ?? join(dataRoot, ".build", "single", design, `${pageId}.html`));
    const file = injectBridge(doc, readFileSync(BRIDGE, "utf8"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file);
    return { path, size: Buffer.byteLength(file), design, page: pageId, variant: variants[0].id, variants: variants.map((v) => v.id) };
  };

  if (kind(variants[0]) === "HTML") {
    const docs = variants.map(
      (v) =>
        `<script type="text/plain" id="od-variant-${escapeId(v.id)}">${Buffer.from(inlineHtmlDesign(dataRoot, join(dataRoot, "designs", design, v.file))).toString("base64")}</script>`,
    );
    return write(`<!doctype html>
<html>
<head>
${head}
${docs.join("\n")}
<script>${HTML_BOOT}</script>
</head>
<body></body>
</html>
`);
  }

  const packages = {};
  const bundles = [];
  for (const v of variants) {
    const b = await bundlePage(esbuild, dataRoot, `designs/${design}/${v.file}`, ds, { prod: true, vendor: packages, only: v.id });
    Object.assign(packages, b.needed);
    bundles.push(b);
  }
  const vendor = await bundleVendor(esbuild, projectRoot, packages, true);
  const js = bundles.map((b) => b.js).join("\n");
  const css = [await tailwindCss(ds, projectRoot, js, true), ...bundles.map((b) => b.css)].filter(Boolean).join("\n");
  return write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
${tokenSheets(dataRoot, ds.name).map((s) => `<style data-od-tokens="${s.name}">${inlineStyle(s.css)}</style>`).join("\n")}
<style data-od-css>${inlineStyle(css)}</style>
</head>
<body>
<div id="od-root"></div>
<script>${inlineScript(vendor)}</script>
${bundles.map((b) => `<script>${inlineScript(b.js)}</script>`).join("\n")}
</body>
</html>
`);
}

const escapeId = (id) => String(id).replace(/[&"<>]/g, "");

function errorPage(err) {
  const text = (err.errors?.length ? err.errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("\n") : err.message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body><pre style="white-space:pre-wrap;color:#b42318;font:13px/1.5 ui-monospace,monospace;padding:16px">Build failed\n\n${text}</pre></body>
</html>
`;
}

/**
 * `tsc --noEmit` over a design's chosen React variants, run at finalize only.
 * Returns the diagnostics text, or null when they pass or none are React.
 *
 * @param {string} dataRoot
 * @param {string} design
 * @param {{ pages?: Array<{ id: string, variants?: Array<{ id: string, file: string }> }> }} index
 * @param {{ pages?: Record<string, { variantId: string }> } | null} chosen
 * @returns {Promise<string | null>}
 */
export async function typecheckChosen(dataRoot, design, index, chosen) {
  const files = Object.entries(chosen?.pages ?? {})
    .map(([pageId, entry]) => index.pages?.find((p) => p.id === pageId)?.variants?.find((v) => v.id === entry.variantId)?.file)
    .filter((file) => file?.endsWith(".tsx"))
    .map((file) => join(dataRoot, "designs", design, file));
  if (files.length === 0) return null;
  const ds = designSystemOf(dataRoot, `designs/${design}/x.tsx`);
  const args = { projectRoot: dirname(dataRoot), componentsDir: ds.componentsDir, ownDir: ds.ownDir, shipped: ds.shipped, files };
  const child = spawn(process.execPath, [TYPECHECK, JSON.stringify(args)], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  const code = await new Promise((ok) => child.on("close", ok));
  if (code === 0) {
    if (output) console.warn(output.trim());
    return null;
  }
  return `Type check failed:\n${output.split("\n").slice(0, 30).join("\n")}`;
}
