#!/usr/bin/env node
// Local staging is explicit; CI is the normal OIDC release path.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, capture = false) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

try {
  run('node', ['scripts/sync-version.mjs', '--check']);
  run('npm', ['test']);
  run('npm', ['run', 'build:viewer']);
  run('npm', ['--prefix', 'viewer', 'test', '--', '--run']);
  run('npm', ['--prefix', 'viewer', 'exec', '--', 'tsc', '--noEmit', '-p', 'viewer/tsconfig.json']);
  const [{ filename }] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json'], true));
  run('node', ['scripts/check-packed.mjs', filename]);
  run('npm', ['stage', 'publish', filename, '--access', 'public']);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  console.log(`\nStaged ${pkg.name}@${pkg.version}. Not published until a maintainer approves with npm 2FA.`);
} catch (error) {
  console.error(`Staging failed: ${error.message}`);
  process.exitCode = 1;
}
