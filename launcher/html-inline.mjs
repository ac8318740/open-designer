// Inlines an HTML design's local assets for the single-file build.
//
// Local stylesheets, scripts, images, and the fonts and images their CSS
// references become inline text or data: URLs. Every local path must resolve
// inside .open-designer; an absolute path or one that climbs out fails the
// build. Remote assets (https:, //, data:) stay as links, because frames may
// load https. Other <link> elements (icons, canonical) are left untouched.
//
// The rewriting is regex-based on purpose: design HTML is agent-written and
// regular, and a full HTML parser would be a new dependency.

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const MIME = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const isRemote = (ref) => /^(https?:|\/\/|data:|blob:|#|mailto:|tel:|about:)/i.test(ref);

// Inline text must not close its own element or open an HTML comment.
export const inlineScript = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
export const inlineStyle = (css) => css.replace(/<\/style/gi, "<\\/style");

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Resolve a local reference against the file that makes it.
 *
 * @returns {string} absolute path inside dataRoot
 */
function local(dataRoot, fromFile, ref) {
  const path = decodeURIComponent(decode(ref).replace(/[?#].*$/, ""));
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) {
    throw new Error(`${rel(dataRoot, fromFile)}: ${ref} is an absolute path; single-file builds inline only paths inside .open-designer`);
  }
  const abs = resolve(dirname(fromFile), path);
  if (!abs.startsWith(dataRoot + sep)) throw new Error(`${rel(dataRoot, fromFile)}: ${ref} resolves outside .open-designer`);
  if (!existsSync(abs)) throw new Error(`${rel(dataRoot, fromFile)}: ${ref} does not exist`);
  return abs;
}

const rel = (dataRoot, abs) => relative(dataRoot, abs).split(sep).join("/");

function dataUrl(abs) {
  const mime = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
}

// CSS from `fromFile`: local @import inlined, local url() as data: URLs.
// Remote @import rules move to the top, where CSS requires them.
function inlineCss(dataRoot, fromFile, css, seen = new Set()) {
  const remote = [];
  const body = css
    .replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?([^;]*);/g, (rule, _q, ref, media) => {
      if (isRemote(ref)) {
        remote.push(rule);
        return "";
      }
      const abs = local(dataRoot, fromFile, ref);
      if (seen.has(abs)) return "";
      seen.add(abs);
      const inner = inlineCss(dataRoot, abs, readFileSync(abs, "utf8"), seen);
      remote.push(...inner.remote);
      return media.trim() ? `@media ${media.trim()} {\n${inner.body}\n}` : inner.body;
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _q, ref) => (isRemote(ref.trim()) ? whole : `url("${dataUrl(local(dataRoot, fromFile, ref.trim()))}")`));
  return { remote, body };
}

const cssText = (dataRoot, fromFile, css) => {
  const { remote, body } = inlineCss(dataRoot, fromFile, css);
  return [...remote, body].join("\n");
};

/**
 * Return the HTML design at `file` with its local assets inlined. A design
 * system's tokens.css becomes <style data-od-tokens="<name>">, so a host's
 * `tokens` message replaces it as it does in the viewer. Deferred local
 * scripts move to the end of <body>, which keeps their order and timing.
 *
 * @param {string} dataRoot  Absolute path of .open-designer
 * @param {string} file  Absolute path of the design HTML
 * @returns {string}
 */
export function inlineHtmlDesign(dataRoot, file) {
  const deferred = [];
  let html = readFileSync(file, "utf8");

  // Authored <style> blocks first, before inlined stylesheets join them.
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open, css, close) =>
    !/url\(|@import/.test(css) ? whole : `${open}${inlineStyle(cssText(dataRoot, file, css))}${close}`,
  );

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attr(tag, "href");
    if (!href || isRemote(href) || !/\bstylesheet\b/i.test(attr(tag, "rel") ?? "")) return tag;
    const abs = local(dataRoot, file, href);
    const media = attr(tag, "media");
    const tokens = /^design-systems\/([^/]+)\/tokens\.css$/.exec(rel(dataRoot, abs));
    const marker = tokens ? ` data-od-tokens="${escapeAttr(tokens[1])}"` : "";
    return `<style${marker}${media ? ` media="${escapeAttr(media)}"` : ""}>${inlineStyle(cssText(dataRoot, abs, readFileSync(abs, "utf8")))}</style>`;
  });

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (whole, attrs) => {
    const src = attr(`<script${attrs}>`, "src");
    if (!src || isRemote(src)) return whole;
    const abs = local(dataRoot, file, src);
    const type = attr(`<script${attrs}>`, "type");
    const script = `<script${type ? ` type="${escapeAttr(type)}"` : ""}>${inlineScript(readFileSync(abs, "utf8"))}</script>`;
    if (/\sdefer\b/i.test(attrs) && type !== "module") {
      deferred.push(script);
      return "";
    }
    return script;
  });

  html = html.replace(/<(img|source|video|audio|track|input)\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s(?:src|poster)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (whole, lead, _v, dq, sq) => {
      const ref = dq ?? sq;
      return isRemote(ref) ? whole : `${lead}"${dataUrl(local(dataRoot, file, ref))}"`;
    }),
  );

  html = html.replace(/\sstyle\s*=\s*"([^"]*url\([^"]*)"/gi, (whole, css) =>
    ` style="${escapeAttr(inlineCss(dataRoot, file, decode(css)).body)}"`,
  );

  if (deferred.length > 0) {
    const at = html.search(/<\/body>/i);
    html = at === -1 ? html + deferred.join("\n") : html.slice(0, at) + deferred.join("\n") + html.slice(at);
  }
  return html;
}
