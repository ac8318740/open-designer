import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const failPacked of [false, true]) {
  test(`local release ${failPacked ? 'refuses staging after a failed packed check' : 'stages only the tested tarball'}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open-designer-release-'));
    try {
      const log = join(dir, 'commands.jsonl');
      // Every child executable is replaced. This test cannot stage a real package.
      const mock = `#!${process.execPath}\n` + `
        const fs = require('node:fs');
        const path = require('node:path');
        const command = path.basename(process.argv[1]);
        const args = process.argv.slice(2);
        fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify([command, ...args]) + '\\n');
        if (command === 'npm' && args[0] === 'pack') {
          console.log(JSON.stringify([{ filename: 'exact-verified-artifact.tgz' }]));
        }
        if (command === 'node' && args[0] === 'scripts/check-packed.mjs' && process.env.FAIL_PACKED === '1') {
          process.exit(17);
        }
      `;
      for (const name of ['npm', 'node']) await writeFile(join(dir, name), mock, { mode: 0o755 });
      const result = spawnSync(process.execPath, [join(root, 'scripts/release.mjs')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: dir, RELEASE_TEST_LOG: log, FAIL_PACKED: failPacked ? '1' : '0' },
      });
      assert.equal(result.status, failPacked ? 17 : 0, result.stderr);
      const commands = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(commands.slice(0, 2), [
        ['node', 'scripts/sync-version.mjs', '--check'],
        ['npm', 'test'],
      ]);
      const packed = commands.findIndex((command) => command[1] === 'scripts/check-packed.mjs');
      assert.deepEqual(commands[packed], ['node', 'scripts/check-packed.mjs', 'exact-verified-artifact.tgz']);
      const stages = commands.filter((command) => command[1] === 'stage');
      assert.deepEqual(stages, failPacked ? [] : [
        ['npm', 'stage', 'publish', 'exact-verified-artifact.tgz', '--access', 'public'],
      ]);
      assert.equal(packed, failPacked ? commands.length - 1 : commands.length - 2);
      assert.ok(commands.every((command) => command[1] !== 'publish'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
