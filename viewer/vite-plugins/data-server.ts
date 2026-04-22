// Dev-time middleware: serves /data/* from the configured .open-designer folder.
// Matches the production launcher's routing so the viewer behaves identically
// under `vite dev` and `node launcher/serve.mjs`.

import { createReadStream, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Plugin } from "vite";
// Shared with serve.mjs via a .mjs module + .d.ts sidecar (zero-dep launcher
// can't consume TS). Single source of truth for finalize + promote merge logic.
import { applyFinalizeBody, applyPromoteBody, isValidDesignName } from "../../launcher/finalize.mjs";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export const DATA_CHANGED_EVENT = "open-designer:data-changed";

function atomicWriteSync(path: string, content: string): void {
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function handleFinalize(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  root: string,
  design: string,
): void {
  if (!isValidDesignName(design)) {
    res.statusCode = 400;
    res.end("invalid design name");
    return;
  }
  const indexPath = join(root, "designs", design, "index.json");
  if (!indexPath.startsWith(join(root, "designs") + sep)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  if (!existsSync(indexPath)) {
    res.statusCode = 404;
    res.end("index.json not found");
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const current = JSON.parse(readFileSync(indexPath, "utf8"));
      const merged = applyFinalizeBody(current.chosen, body);
      if (merged.error) {
        res.statusCode = 400;
        res.end(merged.error);
        return;
      }
      if (merged.chosen === null) {
        delete current.chosen;
      } else {
        current.chosen = merged.chosen;
      }
      atomicWriteSync(indexPath, JSON.stringify(current, null, 2));
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, chosen: current.chosen ?? null }));
    } catch (err) {
      res.statusCode = 500;
      res.end(`finalize failed: ${(err as Error).message}`);
    }
  });
}

function handlePromote(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  root: string,
  ds: string,
): void {
  if (!isValidDesignName(ds)) {
    res.statusCode = 400;
    res.end("invalid ds name");
    return;
  }
  const tokensPath = join(root, "design-systems", ds, "tokens.css");
  const manifestPath = join(root, "design-systems", ds, "manifest.json");
  if (!tokensPath.startsWith(join(root, "design-systems") + sep)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  if (!existsSync(tokensPath)) {
    res.statusCode = 404;
    res.end("tokens.css not found");
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const css = readFileSync(tokensPath, "utf8");
      const patched = applyPromoteBody(css, body);
      if (patched.error) {
        res.statusCode = 400;
        res.end(patched.error);
        return;
      }
      atomicWriteSync(tokensPath, patched.css!);
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          manifest.updatedAt = new Date().toISOString();
          atomicWriteSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch (err) {
          console.warn(`Promote: failed to bump manifest: ${(err as Error).message}`);
        }
      }
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.end(`promote failed: ${(err as Error).message}`);
    }
  });
}

export function dataServer(dataRoot: string): Plugin {
  const root = resolve(dataRoot);

  return {
    name: "open-designer-data",
    configureServer(server) {
      server.watcher.add(root);
      const notify = (absPath: string) => {
        if (!absPath.startsWith(root)) return;
        const rel = absPath.slice(root.length).replace(/\\/g, "/");
        server.ws.send({
          type: "custom",
          event: DATA_CHANGED_EVENT,
          data: { path: rel },
        });
      };
      server.watcher.on("change", notify);
      server.watcher.on("add", notify);
      server.watcher.on("unlink", notify);

      server.middlewares.use("/data", (req, res, next) => {
        const url = (req.url || "/").split("?")[0];

        // POST /designs/<name>/finalize
        const designFinalize = url.match(/^\/designs\/([^/]+)\/finalize$/);
        if (designFinalize && req.method === "POST") {
          handleFinalize(req, res, root, decodeURIComponent(designFinalize[1]));
          return;
        }

        // POST /design-systems/<name>/promote
        const dsPromote = url.match(/^\/design-systems\/([^/]+)\/promote$/);
        if (dsPromote && req.method === "POST") {
          handlePromote(req, res, root, decodeURIComponent(dsPromote[1]));
          return;
        }

        if (url === "/designs/" || url === "/designs/index.json") {
          const designsRoot = join(root, "designs");
          res.setHeader("content-type", MIME[".json"]);
          res.setHeader("cache-control", "no-store");
          if (!existsSync(designsRoot)) {
            res.end(JSON.stringify({ designs: [] }));
            return;
          }
          const names = readdirSync(designsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
          res.end(JSON.stringify({ designs: names }));
          return;
        }

        if (url === "/design-systems/" || url === "/design-systems/index.json") {
          const dsRoot = join(root, "design-systems");
          res.setHeader("content-type", MIME[".json"]);
          res.setHeader("cache-control", "no-store");
          if (!existsSync(dsRoot)) {
            res.end(JSON.stringify({ designSystems: [] }));
            return;
          }
          const out: Array<{ name: string; description: string | null; extends: string | null; updatedAt: string | null }> = [];
          for (const e of readdirSync(dsRoot, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const manifestPath = join(dsRoot, e.name, "manifest.json");
            if (!existsSync(manifestPath)) continue;
            try {
              const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
              out.push({
                name: String(manifest.name ?? e.name),
                description: manifest.description ?? null,
                extends: manifest.extends ?? null,
                updatedAt: manifest.updatedAt ?? null,
              });
            } catch {
              console.warn(`Skipping DS ${e.name}: unreadable manifest.`);
            }
          }
          res.end(JSON.stringify({ designSystems: out }));
          return;
        }

        const rel = decodeURIComponent(url.startsWith("/") ? url.slice(1) : url);
        const abs = normalize(join(root, rel));
        if (!abs.startsWith(root + sep) && abs !== root) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        if (!existsSync(abs)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const stat = statSync(abs);
        if (stat.isDirectory()) {
          const indexPath = join(abs, "index.html");
          if (existsSync(indexPath)) {
            res.setHeader("content-type", MIME[".html"]);
            createReadStream(indexPath).pipe(res);
            return;
          }
          res.statusCode = 404;
          res.end("not found");
          return;
        }

        res.setHeader(
          "content-type",
          MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
        );
        res.setHeader("cache-control", "no-store");
        createReadStream(abs).pipe(res);
      });
    },
  };
}
