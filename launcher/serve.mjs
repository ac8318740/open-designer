#!/usr/bin/env node
// Zero-dependency launcher for the open-designer viewer.
// Serves the built viewer at / and .open-designer/ at /data/.

import { createServer } from "node:http";
import { readFile, stat, readdir, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { statSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  applyApprovalsBody,
  applyFinalizeBody,
  applyPromoteBody,
  isValidDesignName,
  safeJoin,
  titlecaseId,
} from "./finalize.mjs";

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

// Serve /data/design-systems/<ds>/preview/index.json. If the DS author has
// written an index.json on disk (with tweaks + variants), return it verbatim.
// Otherwise synthesize a zero-tweak listing from *.html files. Files whose
// stem starts with `_` are skipped so shared partials like `_preview.css`
// don't show up as selectable surfaces.
async function maybeServePreviewIndex(res, urlPath) {
  const m = urlPath.match(/^\/data\/design-systems\/([^/]+)\/preview\/index\.json$/);
  if (!m) return false;
  const dsName = decodeURIComponent(m[1]);
  if (!isValidDesignName(dsName)) {
    res.writeHead(400);
    res.end("invalid ds name");
    return true;
  }
  const dir = safeJoin(DATA_ROOT, `design-systems/${dsName}/preview`);
  if (!dir || !existsSync(dir)) {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify({ previews: [] }));
    return true;
  }
  const authored = join(dir, "index.json");
  if (existsSync(authored)) {
    try {
      const body = await readFile(authored, "utf8");
      res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      res.end(body);
      return true;
    } catch (err) {
      console.warn(`Preview index read failed for ${dsName}: ${err.message}`);
    }
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const previews = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".html")) continue;
    const id = e.name.slice(0, -".html".length);
    if (!id || id.startsWith("_")) continue;
    previews.push({ id, label: titlecaseId(id), file: e.name });
  }
  previews.sort((a, b) => a.id.localeCompare(b.id));
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify({ previews }));
  return true;
}

// Serve /data/design-systems/<ds>/approvals.json, defaulting to an empty
// object shape when the file doesn't exist yet.
async function maybeServeApprovals(res, urlPath) {
  const m = urlPath.match(/^\/data\/design-systems\/([^/]+)\/approvals\.json$/);
  if (!m) return false;
  const dsName = decodeURIComponent(m[1]);
  if (!isValidDesignName(dsName)) {
    res.writeHead(400);
    res.end("invalid ds name");
    return true;
  }
  const path = safeJoin(DATA_ROOT, `design-systems/${dsName}/approvals.json`);
  if (!path) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  if (existsSync(path)) {
    res.end(await readFile(path, "utf8"));
  } else {
    res.end(JSON.stringify({ schemaVersion: 1, surfaces: {} }));
  }
  return true;
}

async function handleApprovals(req, res, dsName) {
  if (!isValidDesignName(dsName)) {
    res.writeHead(400);
    return res.end("invalid ds name");
  }
  const path = safeJoin(DATA_ROOT, `design-systems/${dsName}/approvals.json`);
  if (!path) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const current = existsSync(path)
      ? JSON.parse(await readFile(path, "utf8"))
      : { schemaVersion: 1, surfaces: {} };
    const merged = applyApprovalsBody(current, body);
    if (merged.error) {
      res.writeHead(400);
      return res.end(merged.error);
    }
    await atomicWrite(path, JSON.stringify(merged.approvals, null, 2));
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ ok: true, approvals: merged.approvals }));
  } catch (err) {
    res.writeHead(500);
    res.end(`approvals failed: ${err.message}`);
  }
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
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  } catch (err) {
    // Client disconnects or aborts mid-POST surface here. Surface them to
    // the caller as a normal error instead of an uncaught stream event.
    throw new Error(`request body read failed: ${err.message}`);
  }
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

// Hot reload over Server-Sent Events ----------------------------------------
//
// Mirrors the Vite dev plugin's `open-designer:data-changed` event name and
// `{path}` payload shape so the viewer can reuse the same handler body. The
// path is relative to DATA_ROOT, forward-slash-normalized.

const sseClients = new Set();
const debounceTimers = new Map();
const DEBOUNCE_MS = 75;
const HEARTBEAT_MS = 20000;
let manualWatchers = null; // Map<absDir, FSWatcher> when the recursive flag isn't supported.

function shouldIgnoreFilename(name) {
  if (!name) return true;
  if (name.endsWith(".tmp")) return true;
  if (name === ".DS_Store") return true;
  if (name.endsWith(".swp") || name.endsWith(".swo")) return true;
  if (name.endsWith("~")) return true;
  return false;
}

function broadcastChange(relPath) {
  const payload = `event: data-changed\ndata: ${JSON.stringify({ path: relPath })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function scheduleChange(relPath) {
  const existing = debounceTimers.get(relPath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(relPath);
    broadcastChange(relPath);
  }, DEBOUNCE_MS);
  debounceTimers.set(relPath, timer);
}

function handleWatchEvent(absPath) {
  if (!absPath.startsWith(DATA_ROOT)) return;
  const base = absPath.split(/[\\/]/).pop();
  if (shouldIgnoreFilename(base)) return;
  let rel = absPath.slice(DATA_ROOT.length).replace(/\\/g, "/");
  if (rel.startsWith("/")) rel = rel.slice(1);
  rel = "/" + rel;
  scheduleChange(rel);
}

function startManualWatcher() {
  manualWatchers = new Map();
  const addDir = (dir) => {
    if (manualWatchers.has(dir)) return;
    try {
      const w = watch(dir, (_eventType, filename) => {
        if (!filename) return;
        const abs = join(dir, String(filename));
        try {
          const s = statSync(abs);
          if (s.isDirectory() && !manualWatchers.has(abs)) {
            walkAndAdd(abs);
          }
        } catch {
          const prev = manualWatchers.get(abs);
          if (prev) {
            try { prev.close(); } catch { /* ignore */ }
            manualWatchers.delete(abs);
          }
        }
        handleWatchEvent(abs);
      });
      w.on("error", () => {
        try { w.close(); } catch { /* ignore */ }
        manualWatchers.delete(dir);
      });
      manualWatchers.set(dir, w);
    } catch {
      /* directory vanished between read and watch – ignore */
    }
  };
  const walkAndAdd = (dir) => {
    addDir(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      walkAndAdd(join(dir, e.name));
    }
  };
  walkAndAdd(DATA_ROOT);
}

function stopManualWatcher() {
  if (!manualWatchers) return;
  for (const w of manualWatchers.values()) {
    try { w.close(); } catch { /* ignore */ }
  }
  manualWatchers.clear();
  manualWatchers = null;
}

let recursiveWatcher = null;

function attachWatcher() {
  if (!existsSync(DATA_ROOT)) {
    setTimeout(attachWatcher, 2000);
    return;
  }
  try {
    recursiveWatcher = watch(DATA_ROOT, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      handleWatchEvent(join(DATA_ROOT, String(filename)));
    });
    recursiveWatcher.on("error", () => {
      try { recursiveWatcher?.close(); } catch { /* ignore */ }
      recursiveWatcher = null;
      setTimeout(attachWatcher, 2000);
    });
  } catch {
    startManualWatcher();
  }
}

attachWatcher();

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(": ping\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}, HEARTBEAT_MS).unref();

function handleSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  res.write(": hello\n\n");
  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = url.pathname;

  if (pathname === "/") pathname = "/index.html";

  if (pathname === "/__od/events") {
    return handleSse(req, res);
  }

  const designFinalize = pathname.match(/^\/data\/designs\/([^/]+)\/finalize$/);
  if (designFinalize && req.method === "POST") {
    return handleFinalize(req, res, decodeURIComponent(designFinalize[1]));
  }

  const dsPromote = pathname.match(/^\/data\/design-systems\/([^/]+)\/promote$/);
  if (dsPromote && req.method === "POST") {
    return handlePromote(req, res, decodeURIComponent(dsPromote[1]));
  }

  const dsApprovals = pathname.match(/^\/data\/design-systems\/([^/]+)\/approvals$/);
  if (dsApprovals && req.method === "POST") {
    return handleApprovals(req, res, decodeURIComponent(dsApprovals[1]));
  }

  if (await maybeServeDesignIndex(res, pathname)) return;
  if (await maybeServeDsIndex(res, pathname)) return;
  if (await maybeServePreviewIndex(res, pathname)) return;
  if (await maybeServeApprovals(res, pathname)) return;

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
