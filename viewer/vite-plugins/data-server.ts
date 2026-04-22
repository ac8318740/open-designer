// Dev-time middleware: serves /data/* from the configured .open-designer folder.
// Matches the production launcher's routing so the viewer behaves identically
// under `vite dev` and `node launcher/serve.mjs`.

import { createReadStream, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Plugin } from "vite";

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

// Merge a `chosen` payload into the design's index.json. Writes through a
// temp file + rename so a concurrent reader never sees a half-written JSON.
// `chosen: null` in the body clears the field.
function handleFinalize(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  root: string,
  design: string,
): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const indexPath = join(root, "drafts", design, "index.json");
      if (!indexPath.startsWith(root + sep)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }
      if (!existsSync(indexPath)) {
        res.statusCode = 404;
        res.end("index.json not found");
        return;
      }
      const current = JSON.parse(readFileSync(indexPath, "utf8"));
      if (body.chosen === null) {
        delete current.chosen;
      } else if (body.chosen && typeof body.chosen === "object") {
        current.chosen = {
          variantId: String(body.chosen.variantId ?? ""),
          tweaks:
            body.chosen.tweaks && typeof body.chosen.tweaks === "object"
              ? body.chosen.tweaks
              : {},
          finalizedAt: String(body.chosen.finalizedAt ?? new Date().toISOString()),
          ...(body.chosen.shippedAt ? { shippedAt: String(body.chosen.shippedAt) } : {}),
        };
      } else {
        res.statusCode = 400;
        res.end("missing chosen");
        return;
      }
      const tmp = indexPath + ".tmp";
      writeFileSync(tmp, JSON.stringify(current, null, 2));
      renameSync(tmp, indexPath);
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, chosen: current.chosen ?? null }));
    } catch (err) {
      res.statusCode = 500;
      res.end(`finalize failed: ${(err as Error).message}`);
    }
  });
}

export function dataServer(dataRoot: string): Plugin {
  const root = resolve(dataRoot);

  return {
    name: "open-designer-data",
    configureServer(server) {
      // Watch the data folder and broadcast changes over Vite's HMR socket.
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

        // Finalize endpoint: POST /drafts/<design>/finalize
        const finalizeMatch = url.match(/^\/drafts\/([^/]+)\/finalize$/);
        if (finalizeMatch && req.method === "POST") {
          handleFinalize(req, res, root, decodeURIComponent(finalizeMatch[1]));
          return;
        }

        // Synthesize project list from directory structure.
        if (url === "/drafts/" || url === "/drafts/index.json") {
          const draftsRoot = join(root, "drafts");
          res.setHeader("content-type", MIME[".json"]);
          res.setHeader("cache-control", "no-store");
          if (!existsSync(draftsRoot)) {
            res.end(JSON.stringify({ projects: [] }));
            return;
          }
          const projects = readdirSync(draftsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
          res.end(JSON.stringify({ projects }));
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
