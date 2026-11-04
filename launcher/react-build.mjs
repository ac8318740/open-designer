// React design builds for design systems with `framework: "react"`.
//
// A design or design-system page whose file ends in .tsx default-exports a
// component. The launcher builds it with esbuild each time the frame asks for
// it, which the viewer does on every save, into
// .open-designer/.build/<same path>.html and .js. Packages from node_modules
// (React, Radix, ...) go into one vendor bundle per design system and reach
// each page through window.__odVendor, so a page rebuild stays small.
//
// `@ds/<name>` imports resolve to the design system's components/ folder, or
// to the project's real primitives once manifest.shippedComponents is set.
// Each file's nearest tsconfig.json still resolves its own path aliases.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME = fileURLToPath(new URL("./react-runtime.js", import.meta.url));
const TYPECHECK = fileURLToPath(new URL("./typecheck.mjs", import.meta.url));
const TAILWIND = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
const SKIP = Symbol("od-skip");
// Development React: designs are for iterating, and its warnings help.
const DEFINE = { "process.env.NODE_ENV": '"development"' };

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

// The design system a page belongs to, and where its components live.
function designSystemOf(dataRoot, rel) {
  const parts = rel.split("/");
  const name = parts[0] === "design-systems" ? parts[1] : readJson(join(dataRoot, "designs", parts[1], "index.json"))?.designSystem;
  if (!name) return { name: null, componentsDir: null, sourceRoot: null, shipped: false };
  const dir = join(dataRoot, "design-systems", name);
  const manifest = readJson(join(dir, "manifest.json")) ?? {};
  if (manifest.shippedComponents) {
    const sourceRoot = resolve(manifest.shippedTo ?? dirname(dataRoot));
    return { name, componentsDir: resolve(sourceRoot, manifest.shippedComponents), sourceRoot, shipped: true };
  }
  return { name, componentsDir: join(dir, "components"), sourceRoot: dir, shipped: false };
}

const inside = (path, dir) => !!dir && path.startsWith(dir + sep);
const inNodeModules = (path) => path.includes(`${sep}node_modules${sep}`);

// Fixture paths are relative to the ACStack element folder that holds them.
function fixturePath(projectRoot, path) {
  const m = /[\\/]elements[\\/][^\\/]+[\\/](.+)$/.exec(path);
  return m ? m[1].replace(/\\/g, "/") : relative(projectRoot, path).replace(/\\/g, "/");
}

async function build(dataRoot, rel) {
  const esbuild = await import("esbuild");
  const projectRoot = dirname(dataRoot);
  const page = join(dataRoot, rel);
  const ds = designSystemOf(dataRoot, rel);
  const buildRoot = join(dataRoot, ".build");
  const out = join(buildRoot, rel.replace(/\.tsx$/, ""));
  const vendorBase = join(buildRoot, "_vendor", ds.name ?? "_none");
  const vendor = readJson(`${vendorBase}.json`) ?? {};
  const needed = {};

  const plugin = {
    name: "open-designer",
    setup(b) {
      b.onResolve({ filter: /^@ds\// }, (args) => {
        if (!ds.componentsDir) return { errors: [{ text: `${args.path}: this page has no design system` }] };
        return b.resolve(`./${args.path.slice(4)}`, { kind: args.kind, resolveDir: ds.componentsDir });
      });
      // Anything that resolves into node_modules comes from the vendor bundle.
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData === SKIP) return undefined;
        const r = await b.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: SKIP });
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
        if (!inside(args.path, ds.componentsDir)) return undefined;
        const source = relative(ds.sourceRoot, args.path).replace(/\\/g, "/");
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

  const result = await esbuild.build({
    stdin: {
      contents: [
        `import Page from ${JSON.stringify(page)};`,
        `import { createElement } from "react";`,
        `import { createRoot } from "react-dom/client";`,
        `import { mount } from ${JSON.stringify(RUNTIME)};`,
        `mount(createRoot, createElement, Page);`,
      ].join("\n"),
      resolveDir: dirname(page),
      sourcefile: rel,
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    define: DEFINE,
    outfile: `${out}.js`,
    metafile: true,
    logLevel: "silent",
    plugins: [plugin],
  });

  // shortcut: the vendor bundle only rebuilds when a page needs a new package,
  // so upgrading a package in node_modules needs `rm -r .open-designer/.build`.
  if (Object.keys(needed).some((spec) => !(spec in vendor)) || !existsSync(`${vendorBase}.js`)) {
    const all = { ...vendor, ...needed };
    await esbuild.build({
      stdin: {
        contents: `window.__odVendor = {${Object.entries(all)
          .map(([spec, path]) => `${JSON.stringify(spec)}: require(${JSON.stringify(path)})`)
          .join(",\n")}};`,
        resolveDir: projectRoot,
        sourcefile: "od-vendor.js",
      },
      bundle: true,
      format: "iife",
      target: "es2020",
      define: DEFINE,
      outfile: `${vendorBase}.js`,
      logLevel: "silent",
    });
    writeFileSync(`${vendorBase}.json`, JSON.stringify(all, null, 2));
  }
  writeFileSync(join(buildRoot, ".gitignore"), "*\n");

  const url = (abs) => `/data/${relative(dataRoot, abs).split(sep).join("/")}`;
  const css = Object.keys(result.metafile.outputs).some((o) => o.endsWith(".css"));
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="${TAILWIND}"></script>
${css ? `<link rel="stylesheet" href="${url(`${out}.css`)}">\n` : ""}</head>
<body>
<div id="od-root"></div>
<script src="${url(`${vendorBase}.js`)}"></script>
<script src="${url(`${out}.js`)}"></script>
</body>
</html>
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.html`, html);
  return html;
}

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
  const args = { projectRoot: dirname(dataRoot), componentsDir: ds.componentsDir, shipped: ds.shipped, files };
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
