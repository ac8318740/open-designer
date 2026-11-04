import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env, execPath } from "node:process";
import { request } from "node:http";

const SERVE = fileURLToPath(new URL("../../../launcher/serve.mjs", import.meta.url));

let proc: ChildProcess;
let base: string;
let token: string;
let cwd: string;

beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), "od-guard-"));
  mkdirSync(join(cwd, ".open-designer/designs/demo"), { recursive: true });
  writeFileSync(
    join(cwd, ".open-designer/designs/demo/index.json"),
    JSON.stringify({ variants: [{ id: "a" }], chosen: null }),
  );
  proc = spawn(execPath, [SERVE], {
    cwd,
    env: { ...env, OPEN_DESIGNER_PORT: "0", OPEN_DESIGNER_NO_OPEN: "1" },
  });
  base = await new Promise<string>((ok, fail) => {
    proc.stdout!.on("data", (d: unknown) => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) ok(m[0]);
    });
    proc.once("exit", (code: unknown) => fail(new Error(`serve exited ${code}`)));
  });
  const html = await (await fetch(`${base}/`)).text();
  token = html.match(/name="od-write-token" content="([0-9a-f]+)"/)![1];
});

afterAll(() => {
  proc?.kill();
  rmSync(cwd, { recursive: true, force: true });
});

// node:http, not fetch, so the test can set its own Host header.
const finalize = (headers: Record<string, string>) =>
  new Promise<{ status: number }>((ok, fail) => {
    const req = request(`${base}/data/designs/demo/finalize`, { method: "POST", headers }, (res: any) => {
      res.resume();
      ok({ status: res.statusCode });
    });
    req.on("error", fail);
    req.end(JSON.stringify({ clearAll: true }));
  });

describe("launcher write guard", () => {
  it("rejects a write with no token", async () => {
    const r = await finalize({ origin: base, "content-type": "application/json" });
    expect(r.status).toBe(403);
  });

  it("rejects a foreign Origin", async () => {
    const r = await finalize({ origin: "http://evil.test", "content-type": "application/json", "x-od-token": token });
    expect(r.status).toBe(403);
  });

  it("rejects a text/plain body", async () => {
    const r = await finalize({ origin: base, "content-type": "text/plain", "x-od-token": token });
    expect(r.status).toBe(415);
  });

  it("accepts a write from the viewer", async () => {
    const r = await finalize({ origin: base, "content-type": "application/json", "x-od-token": token });
    expect(r.status).toBe(200);
  });

  it("accepts a loopback Host on a different port, as an SSH forward sends", async () => {
    const host = "localhost:5179";
    const r = await finalize({ host, origin: `http://${host}`, "content-type": "application/json", "x-od-token": token });
    expect(r.status).toBe(200);
  });

  it("rejects a non-loopback Host", async () => {
    const host = "evil.test:5179";
    const r = await finalize({ host, origin: `http://${host}`, "content-type": "application/json", "x-od-token": token });
    expect(r.status).toBe(421);
  });
});
