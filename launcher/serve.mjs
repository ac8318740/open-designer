#!/usr/bin/env node
// Zero-dependency launcher for the open-designer viewer.
// Serves the built viewer at / and .open-designer/ at /data/.

import { createServer } from "node:http";
import { readFile, stat, readdir, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { applyFinalizeBody, applyPromoteBody, isValidDesignName } from "./finalize.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const REPO_CWD = process.cwd();

// Viewer build lives next to the launcher. Fall back to source dir if no build.
const VIEWER_DIST = join(PLUGIN_ROOT, "viewer", "dist");
const VIEWER_SRC = join(PLUGIN_ROOT, "viewer");
const VIEWER_ROOT = existsSync(join(VIEWER_DIST, "index.html")) ? VIEWER_DIST : VIEWER_SRC;

// Designs + design systems live in the repo's working directory.
const DATA_ROOT = join(REPO_CWD, ".open-designer");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeJoin(root, relPath) {
  const decoded = decodeURIComponent(relPath.replace(/\?.*$/, ""));
  const joined = normalize(join(root, decoded));
  if (!joined.startsWith(root + sep) && joined !== root) return null;
  return joined;
}

async function serveFile(res, absPath) {
  try {
    const data = await readFile(absPath);
    const mime = MIME[extname(absPath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// Synthesize /data/designs/index.json by listing design subdirectories.
// Accepts the legacy /drafts/ path as a read-only alias.
async function maybeServeDesignIndex(res, urlPath) {
  const isDesigns =
    urlPath === "/data/designs/index.json" || urlPath === "/data/designs/";
  if (!isDesigns) return false;
  const root = join(DATA_ROOT, "designs");
  if (!existsSync(root)) {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ designs: [] }));
    return true;
  }
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify({ designs: names }));
  return true;
}

// Synthesize /data/design-systems/index.json from the manifest of each DS.
async function maybeServeDsIndex(res, urlPath) {
  const isDs =
    urlPath === "/data/design-systems/index.json" ||
    urlPath === "/data/design-systems/";
  if (!isDs) return false;
  const root = join(DATA_ROOT, "design-systems");
  if (!existsSync(root)) {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ designSystems: [] }));
    return true;
  }
  const entries = await readdir(root, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = join(root, e.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      out.push({
        name: String(manifest.name ?? e.name),
        description: manifest.description ?? null,
        extends: manifest.extends ?? null,
        updatedAt: manifest.updatedAt ?? null,
      });
    } catch {
      // Skip unreadable manifests – log but don't fail the whole listing.
      console.warn(`Skipping DS ${e.name}: unreadable manifest.`);
    }
  }
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify({ designSystems: out }));
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// Atomic-write helper – write to `.tmp` then rename. Used by finalize + promote
// so a concurrent reader never sees a half-written file.
async function atomicWrite(path, content) {
  const tmp = path + ".tmp";
  try {
    await writeFile(tmp, content);
    await rename(tmp, path);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

async function handleFinalize(req, res, design) {
  if (!isValidDesignName(design)) {
    res.writeHead(400);
    return res.end("invalid design name");
  }
  const indexPath = safeJoin(DATA_ROOT, `designs/${design}/index.json`);
  if (!indexPath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!existsSync(indexPath)) {
    res.writeHead(404);
    return res.end("index.json not found");
  }
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const current = JSON.parse(await readFile(indexPath, "utf8"));
    const merged = applyFinalizeBody(current.chosen, body);
    if (merged.error) {
      res.writeHead(400);
      return res.end(merged.error);
    }
    if (merged.chosen === null) {
      delete current.chosen;
    } else {
      current.chosen = merged.chosen;
    }
    await atomicWrite(indexPath, JSON.stringify(current, null, 2));
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ ok: true, chosen: current.chosen ?? null }));
  } catch (err) {
    res.writeHead(500);
    res.end(`finalize failed: ${err.message}`);
  }
}

async function handlePromote(req, res, ds) {
  if (!isValidDesignName(ds)) {
    res.writeHead(400);
    return res.end("invalid ds name");
  }
  const tokensPath = safeJoin(DATA_ROOT, `design-systems/${ds}/tokens.css`);
  const manifestPath = safeJoin(DATA_ROOT, `design-systems/${ds}/manifest.json`);
  if (!tokensPath || !manifestPath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!existsSync(tokensPath)) {
    res.writeHead(404);
    return res.end("tokens.css not found");
  }
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const css = await readFile(tokensPath, "utf8");
    const patched = applyPromoteBody(css, body);
    if (patched.error) {
      res.writeHead(400);
      return res.end(patched.error);
    }
    await atomicWrite(tokensPath, patched.css);
    // Bump manifest.updatedAt.
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.updatedAt = new Date().toISOString();
        await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (err) {
        console.warn(`Promote: failed to bump manifest: ${err.message}`);
      }
    }
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500);
    res.end(`promote failed: ${err.message}`);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = url.pathname;

  if (pathname === "/") pathname = "/index.html";

  const designFinalize = pathname.match(/^\/data\/designs\/([^/]+)\/finalize$/);
  if (designFinalize && req.method === "POST") {
    return handleFinalize(req, res, decodeURIComponent(designFinalize[1]));
  }

  const dsPromote = pathname.match(/^\/data\/design-systems\/([^/]+)\/promote$/);
  if (dsPromote && req.method === "POST") {
    return handlePromote(req, res, decodeURIComponent(dsPromote[1]));
  }

  if (await maybeServeDesignIndex(res, pathname)) return;
  if (await maybeServeDsIndex(res, pathname)) return;

  if (pathname.startsWith("/data/")) {
    const rel = pathname.slice("/data/".length);
    const abs = safeJoin(DATA_ROOT, rel);
    if (!abs) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      const s = await stat(abs);
      if (s.isDirectory()) {
        const indexed = await serveFile(res, join(abs, "index.html"));
        if (!indexed) {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
    } catch {
      res.writeHead(404);
      return res.end("Not found");
    }
    if (await serveFile(res, abs)) return;
    res.writeHead(404);
    return res.end("Not found");
  }

  const abs = safeJoin(VIEWER_ROOT, pathname.slice(1));
  if (!abs) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (await serveFile(res, abs)) return;
  res.writeHead(404);
  res.end("Not found");
}

function listen(port) {
  return new Promise((resolveOk, rejectErr) => {
    const server = createServer(handle);
    server.once("error", rejectErr);
    server.listen(port, "127.0.0.1", () => resolveOk(server));
  });
}

async function pickPort(start) {
  for (let p = start; p < start + 20; p++) {
    try {
      return await listen(p);
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(`No free port in range ${start}-${start + 20}`);
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* user can copy the URL */
  }
}

const startPort = parseInt(process.env.OPEN_DESIGNER_PORT ?? "5179", 10);
const server = await pickPort(startPort);
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

console.log(`open-designer viewer → ${url}`);
console.log(`  viewer:  ${VIEWER_ROOT}`);
console.log(`  data:    ${DATA_ROOT}`);

if (!process.env.OPEN_DESIGNER_NO_OPEN) openBrowser(url);
