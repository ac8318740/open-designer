import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let proc;
let base;
let token;
let cwd;

before(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'od-guard-'));
  mkdirSync(join(cwd, '.open-designer/designs/demo'), { recursive: true });
  writeFileSync(join(cwd, '.open-designer/designs/demo/index.json'), JSON.stringify({ variants: [{ id: 'a' }], chosen: null }));
  proc = spawn(process.execPath, [join(root, 'launcher/serve.mjs')], {
    cwd,
    env: { ...process.env, OPEN_DESIGNER_PORT: '0', OPEN_DESIGNER_NO_OPEN: '1' },
  });
  base = await new Promise((ok, fail) => {
    proc.stdout.on('data', (d) => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) ok(m[0]);
    });
    proc.once('exit', (code) => fail(new Error(`serve exited ${code}`)));
  });
  const html = await (await fetch(`${base}/`)).text();
  // Exactly one token: a second, stale one (e.g. baked in by vite build) would shadow the live one.
  const tokens = [...html.matchAll(/name="od-write-token" content="([0-9a-f]+)"/g)];
  assert.equal(tokens.length, 1);
  token = tokens[0][1];
});

after(() => {
  proc?.kill();
  rmSync(cwd, { recursive: true, force: true });
});

// node:http, not fetch, so the test can set its own Host header.
const finalize = (headers) =>
  new Promise((ok, fail) => {
    const req = request(`${base}/data/designs/demo/finalize`, { method: 'POST', headers }, (res) => {
      res.resume();
      ok(res.statusCode);
    });
    req.on('error', fail);
    req.end(JSON.stringify({ clearAll: true }));
  });

const json = 'application/json';

test('rejects a write with no token', async () => {
  assert.equal(await finalize({ origin: base, 'content-type': json }), 403);
});

test('rejects a foreign Origin', async () => {
  assert.equal(await finalize({ origin: 'http://evil.test', 'content-type': json, 'x-od-token': token }), 403);
});

test('rejects a text/plain body', async () => {
  assert.equal(await finalize({ origin: base, 'content-type': 'text/plain', 'x-od-token': token }), 415);
});

test('accepts a write from the viewer', async () => {
  assert.equal(await finalize({ origin: base, 'content-type': json, 'x-od-token': token }), 200);
});

test('accepts a loopback Host on a different port, as an SSH forward sends', async () => {
  const host = 'localhost:5179';
  assert.equal(await finalize({ host, origin: `http://${host}`, 'content-type': json, 'x-od-token': token }), 200);
});

test('rejects a non-loopback Host', async () => {
  const host = 'evil.test:5179';
  assert.equal(await finalize({ host, origin: `http://${host}`, 'content-type': json, 'x-od-token': token }), 421);
});
