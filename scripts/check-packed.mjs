#!/usr/bin/env node
// Exercise the tarball, never the source checkout or an npm registry install.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv[2], 'usage: npm run test:packed -- <tarball.tgz>');
const tarball = resolve(process.argv[2]);
const temp = await mkdtemp(join(tmpdir(), 'open designer packed '));
let child;
try {
  execFileSync('tar', ['-xzf', tarball, '-C', temp]);
  const root = join(temp, 'package');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.pi, { extensions: ['./extensions/open-designer.js'], skills: ['./skills'] });
  const expected = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  assert.equal(pkg.version, expected.version);
  async function checkTree(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await checkTree(file);
      else {
        const path = relative(source, file);
        assert.deepEqual(await readFile(join(root, path)), await readFile(file), path);
      }
    }
  }
  // All companions, not just the three entry points, must survive npm's allowlist.
  await checkTree(join(source, 'skills'));
  await access(join(root, 'viewer/dist/index.html'));
  await access(join(root, 'viewer/dist/od-bridge.js'));
  await access(join(root, 'launcher/finalize.mjs'));
  await access(join(root, 'launcher/react-build.mjs'));
  await access(join(root, 'launcher/react-runtime.js'));
  await access(join(root, 'launcher/typecheck.mjs'));
  await access(join(root, '.claude-plugin/plugin.json'));
  const commands = new Map();
  const messages = [];
  const { default: extension } = await import(pathToFileURL(join(root, pkg.pi.extensions[0])));
  extension({
    registerCommand: (name, command) => commands.set(name, command),
    sendUserMessage: (text) => messages.push(text),
  });
  assert.equal(commands.size, 3);
  for (const name of ['design-system', 'design', 'design-integrate']) {
    await commands.get(`open-designer:${name}`).handler('packed fixture', { isIdle: () => true });
    assert.ok(messages.at(-1).includes(JSON.stringify(join(root, 'skills', name, 'SKILL.md'))));
  }

  const project = join(temp, 'user project');
  await mkdir(join(project, '.open-designer'), { recursive: true });
  await writeFile(join(project, '.open-designer/fixture.json'), '{"packed":true}');
  // Reviewed launcher binds only 127.0.0.1; port 0 requests an ephemeral port.
  assert.match(await readFile(join(root, 'launcher/serve.mjs'), 'utf8'), /server\.listen\(port, "127\.0\.0\.1"/);
  child = spawn(process.execPath, [join(root, 'launcher/serve.mjs')], {
    cwd: project,
    env: { ...process.env, OPEN_DESIGNER_PORT: '0', OPEN_DESIGNER_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const url = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error(`launcher timeout: ${output}`)); }, 10000);
    const poll = setInterval(() => {
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timer); clearInterval(poll); accept(match[0]); }
    }, 25);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(new Error(`launcher exited ${code}: ${output}`));
    });
  });
  const listeners = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' })
    .split('\n').filter((line) => line.includes(`pid=${child.pid},`));
  assert.equal(listeners.length, 1, listeners.join('\n'));
  const localAddress = listeners[0].trim().split(/\s+/)[3];
  assert.equal(localAddress, `127.0.0.1:${new URL(url).port}`, listeners[0]);
  const index = await fetch(url);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<html/i);
  const fixture = await fetch(new URL('data/fixture.json', url));
  assert.deepEqual(await fixture.json(), { packed: true });
  const designs = await fetch(new URL('data/designs/index.json', url));
  assert.deepEqual((await designs.json()).designs, []);
  console.log(`Packed ${pkg.name}@${pkg.version}: all skills/companions, three commands, viewer HTTP, loopback listener PASS`);
  console.log(listeners[0]);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  await rm(temp, { recursive: true, force: true });
}
