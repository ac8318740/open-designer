import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function npmParserPath() {
  assert.ok(process.env.npm_execpath, 'run with npm test to use the installed npm parser');
  return createRequire(process.env.npm_execpath).resolve('npm-package-arg');
}

test('the actual staging shell passes its verified tarball as a local file to npm', async () => {
  const workflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8');
  const step = workflow.split('- name: Stage exactly the verified tarball with OIDC')[1];
  const script = step.split('        run: |\n')[1].replace(/^          /gm, '');
  const dir = await mkdtemp(join(tmpdir(), 'open-designer-stage-path-'));
  try {
    await mkdir(join(dir, 'release'));
    await mkdir(join(dir, 'bin'));
    const tarball = join(dir, 'release/open-designer-viewer-0.7.8.tgz');
    const contents = 'parser fixture, never sent to the registry';
    await writeFile(tarball, contents);
    // Exercise npm's own parser, not a hand-written classification or registry call.
    const shim = `#!${process.execPath}\n` + `
      const assert = require('node:assert/strict');
      const npa = require(${JSON.stringify(npmParserPath())});
      const args = process.argv.slice(2);
      assert.deepEqual(args.slice(0, 2), ['stage', 'publish']);
      const parsed = npa(args[2]);
      assert.equal(parsed.type, 'file', JSON.stringify({ spec: args[2], type: parsed.type }));
      assert.equal(parsed.fetchSpec, process.env.EXPECTED_TARBALL);
      assert.deepEqual(args.slice(3), ['--access', 'public']);
    `;
    await writeFile(join(dir, 'bin/npm'), shim, { mode: 0o755 });
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        EXPECTED_SHA256: createHash('sha256').update(contents).digest('hex'),
        EXPECTED_TARBALL: tarball,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\.tgz: OK/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('npm interprets the local release pack filename as a file without a directory prefix', () => {
  const require = createRequire(import.meta.url);
  const npa = require(npmParserPath());
  const filename = 'open-designer-viewer-0.7.8.tgz';
  const parsed = npa(filename, root);
  assert.equal(parsed.type, 'file');
  assert.equal(parsed.fetchSpec, join(root, filename));
});
