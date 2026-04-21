#!/usr/bin/env node
// Zero-dependency launcher for the open-designer viewer.
// Serves the built viewer at / and .open-designer/ at /data/.

import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const REPO_CWD = process.cwd();

// Viewer build lives next to the launcher. Fall back to source dir if no build.
const VIEWER_DIST = join(PLUGIN_ROOT, "viewer", "dist");
const VIEWER_SRC = join(PLUGIN_ROOT, "viewer");
const VIEWER_ROOT = existsSync(join(VIEWER_DIST, "index.html")) ? VIEWER_DIST : VIEWER_SRC;

// Drafts live in the repo's working directory.
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

// Synthesize /data/drafts/index.json by listing project subdirectories.
async function maybeServeProjectIndex(res, urlPath) {
  if (urlPath !== "/data/drafts/index.json" && urlPath !== "/data/drafts/") return false;
  const draftsRoot = join(DATA_ROOT, "drafts");
  if (!existsSync(draftsRoot)) {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ projects: [] }));
    return true;
  }
  const entries = await readdir(draftsRoot, { withFileTypes: true });
  const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify({ projects }));
  return true;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = url.pathname;

  if (pathname === "/") pathname = "/index.html";

  if (await maybeServeProjectIndex(res, pathname)) return;

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

  // Serve viewer root.
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
console.log(`  drafts:  ${DATA_ROOT}`);

if (!process.env.OPEN_DESIGNER_NO_OPEN) openBrowser(url);
