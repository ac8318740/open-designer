import assert from 'node:assert/strict';
import { mkdtemp, readFile, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');
const skills = ['design-system', 'design', 'design-integrate'];

test('npm exposes the extension and all three shared skills without bundling Pi', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.deepEqual(pkg.pi, { extensions: ['./extensions/open-designer.js'], skills: ['./skills'] });
  assert.ok(pkg.files.includes('extensions/'));
  assert.ok(pkg.files.includes('skills/'));
  assert.equal(pkg.engines.node, '>=18');
  assert.equal(pkg.dependencies?.['@earendil-works/pi-coding-agent'], undefined);
  assert.equal(pkg.bin['open-designer'], 'launcher/serve.mjs');
});

test('namespaced commands dispatch installed resources from paths with spaces, including busy sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open designer commands '));
  try {
    await cp(join(root, 'extensions'), join(dir, 'extensions'), { recursive: true });
    await cp(join(root, 'skills'), join(dir, 'skills'), { recursive: true });
    // Keep ESM semantics without depending on a parent checkout.
    await cp(join(root, 'package.json'), join(dir, 'package.json'));
    const { default: extension } = await import(pathToFileURL(join(dir, 'extensions/open-designer.js')));
    const commands = new Map();
    const messages = [];
    extension({
      registerCommand: (name, command) => commands.set(name, command),
      sendUserMessage: (...args) => messages.push(args),
    });
    assert.deepEqual([...commands.keys()], skills.map((name) => `open-designer:${name}`));
    for (const [i, name] of skills.entries()) {
      const file = join(dir, 'skills', name, 'SKILL.md');
      await access(file);
      const request = 'a header with "quotes"; $(do-not-execute)';
      await commands.get(`open-designer:${name}`).handler(request, { isIdle: () => i === 0 });
      const [text, options] = messages.at(-1);
      assert.ok(text.includes(JSON.stringify(file)), text);
      assert.ok(text.includes(JSON.stringify(join(dir, 'launcher/serve.mjs'))), text);
      assert.ok(text.endsWith(request), 'arguments remain plain prompt text');
      assert.deepEqual(options, i === 0 ? undefined : { deliverAs: 'followUp' });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('shared workflows read host rules before relying on Claude-only tools', async () => {
  for (const name of skills) {
    assert.match(await read(`skills/${name}/SKILL.md`), /Read `\.\.\/HOST\.md`/);
  }
  const host = await read('skills/HOST.md');
  assert.match(host, /Pi/);
  assert.match(host, /independent/);
  assert.match(host, /approval/);
  assert.match(host, /launcher\/serve\.mjs/);
  assert.match(await read('skills/design-system/IMPECCABLE.md'), /Pi/);
  assert.match(await read('skills/design-integrate/SPECHUB-MAP.md'), /Pi/);
});

test('release workflow stages a verified tarball, never directly publishes or approves', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm stage publish "\$\{packages\[0\]\}"/);
  assert.doesNotMatch(workflow, /run: npm publish|npm stage approve/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /actions\/download-artifact@/);
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  const beforeJobs = workflow.split('jobs:')[0];
  assert.doesNotMatch(beforeJobs, /id-token: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm@11\.19\.0/);
  assert.doesNotMatch(await read('scripts/release.mjs'), /NPM_TOKEN|\.npmrc\.release/);
});
