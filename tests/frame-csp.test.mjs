import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { FRAME_CSP, frameCsp, injectBridge } from '../launcher/finalize.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('FRAME_CSP is the sandbox plus the protocol frame policy', () => {
  assert.equal(
    FRAME_CSP,
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob:; connect-src https:; form-action 'none'; base-uri 'none'",
  );
});

test('frameCsp adds the launcher origin to script, style, font, and img sources only', () => {
  assert.equal(
    frameCsp('127.0.0.1:5179'),
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https: http://127.0.0.1:5179; style-src 'unsafe-inline' https: http://127.0.0.1:5179; font-src https: data: http://127.0.0.1:5179; img-src https: data: blob: http://127.0.0.1:5179; connect-src https:; form-action 'none'; base-uri 'none'",
  );
});

test('frameCsp falls back to FRAME_CSP for a non-loopback or missing Host', () => {
  assert.equal(frameCsp('evil.test:5179'), FRAME_CSP);
  assert.equal(frameCsp('127.0.0.1.evil.test'), FRAME_CSP);
  assert.equal(frameCsp(undefined), FRAME_CSP);
});

test('injectBridge puts the script first in <head>', () => {
  assert.equal(
    injectBridge('<!doctype html><html><head lang="en"><link rel="stylesheet" href="a.css"></head></html>', 'go()'),
    '<!doctype html><html><head lang="en"><script data-od-bridge>go()</script><link rel="stylesheet" href="a.css"></head></html>',
  );
});

test('injectBridge falls back to after the doctype and ignores <header>', () => {
  assert.equal(injectBridge('<!DOCTYPE html><p>hi</p>', 'go()'), '<!DOCTYPE html><script data-od-bridge>go()</script><p>hi</p>');
  assert.equal(injectBridge('<header></header>', 'go()'), '<script data-od-bridge>go()</script><header></header>');
});

test('injectBridge escapes a closing script tag and skips a missing build', () => {
  assert.match(injectBridge('<head></head>', 'x("</script>")'), /x\("<\\\/script>"\)/);
  assert.equal(injectBridge('<head></head>', null), '<head></head>');
});

let proc;
let base;
let cwd;

before(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'od-csp-'));
  mkdirSync(join(cwd, '.open-designer/designs/demo'), { recursive: true });
  writeFileSync(join(cwd, '.open-designer/designs/demo/a.html'), '<!doctype html><html><head></head><body>A</body></html>');
  writeFileSync(join(cwd, '.open-designer/designs/demo/index.html'), '<!doctype html><html><head></head><body>I</body></html>');
  writeFileSync(join(cwd, '.open-designer/designs/demo/index.json'), JSON.stringify({ pages: [] }));
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
});

after(() => {
  proc?.kill();
  rmSync(cwd, { recursive: true, force: true });
});

// node:http, not fetch, so the test can set its own Host header.
const get = (path, headers = {}) =>
  new Promise((ok, fail) => {
    const req = request(`${base}${path}`, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, csp: res.headers['content-security-policy'], body }));
    });
    req.on('error', fail);
    req.end();
  });

test('the launcher sends the frame CSP for its own origin on a design document', async () => {
  const r = await get('/data/designs/demo/a.html');
  assert.equal(r.status, 200);
  assert.equal(r.csp, frameCsp(new URL(base).host));
  assert.match(r.body, /<body>A<\/body>/);
});

test('the launcher sends it on a directory index.html too', async () => {
  assert.equal((await get('/data/designs/demo/')).csp, frameCsp(new URL(base).host));
});

test('the launcher sends the plain frame CSP for a non-loopback Host', async () => {
  assert.equal((await get('/data/designs/demo/a.html', { host: 'evil.test' })).csp, FRAME_CSP);
});

test('the launcher leaves data files and the viewer page without a CSP', async () => {
  assert.equal((await get('/data/designs/demo/index.json')).csp, undefined);
  assert.equal((await get('/')).csp, undefined);
});
