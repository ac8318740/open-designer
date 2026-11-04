import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, test } from 'node:test';
import { buildReactPage, typecheckChosen } from '../launcher/react-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Inside the repo, so react and typescript resolve from the repo's node_modules.
const project = mkdtempSync(join(root, 'tests', '.tmp-acstack-'));
const data = join(project, '.open-designer');
const globalData = join(project, 'global-acstack');
const stubDir = join(project, 'bin');
const log = join(project, 'acstack.log');
const target = join(project, 'acstack.target');
const write = (path, content) => {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), typeof content === 'string' ? content : JSON.stringify(content));
};

// A stub acstack on PATH, and a HOME without ~/.claude/acstack/bin/acstack.
write('bin/acstack', `#!/bin/sh\necho "$(pwd) $*" >> "${log}"\ncat "${target}"\n`);
chmodSync(join(stubDir, 'acstack'), 0o755);
process.env.HOME = join(project, 'home');
process.env.PATH = `${stubDir}${delimiter}${process.env.PATH}`;

write('global-acstack/maps/demo/elements/notebook/notebook.json', { title: 'Global notebook' });
write('.open-designer/design-systems/demo/manifest.json', { name: 'demo', framework: 'react' });
write('.open-designer/designs/home/index.json', {
  designSystem: 'demo',
  pages: [{ id: 'home', variants: [{ id: '01', file: '01-alias.tsx' }, { id: '02', file: '02-plain.tsx' }] }],
});
write(
  '.open-designer/designs/home/01-alias.tsx',
  `import notebook from "@acstack/maps/demo/elements/notebook/notebook.json";
import again from "@acstack/maps/demo/elements/notebook/notebook.json";
export default function Page() {
  return <main>{notebook.title}{again.title}</main>;
}
`,
);
write('.open-designer/designs/home/02-plain.tsx', 'export default function Page() {\n  return <main>plain</main>;\n}\n');

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const js = (name) => readFileSync(join(data, '.build/designs/home', `${name}.js`), 'utf8');
const chosen = (variantId) => ({ pages: { home: { variantId } } });
const index = JSON.parse(readFileSync(join(data, 'designs/home/index.json'), 'utf8'));

beforeEach(() => {
  rmSync(log, { force: true });
  writeFileSync(target, `${globalData}\n`);
});
after(() => rmSync(project, { recursive: true, force: true }));

test('@acstack/ imports resolve through acstack project-data path, run once per build from the project root', async () => {
  const html = await buildReactPage(data, 'designs/home/01-alias.tsx');
  assert.doesNotMatch(html, /Build failed/);
  assert.match(js('01-alias'), /Global notebook/);
  assert.deepEqual(calls(), [`${project} project-data path`]);
});

test('a page without @acstack/ imports never runs acstack', async () => {
  writeFileSync(target, '');
  const html = await buildReactPage(data, 'designs/home/02-plain.tsx');
  assert.doesNotMatch(html, /Build failed/);
  assert.deepEqual(calls(), []);
});

test('an @acstack/ import fails clearly when the project has no data', async () => {
  writeFileSync(target, `${join(project, 'missing')}\n`);
  const html = await buildReactPage(data, 'designs/home/01-alias.tsx');
  assert.match(html, /Build failed[\s\S]*ACStack project data, but .*missing does not exist/);
});

test('an @acstack/ import fails clearly when acstack is not installed', async () => {
  const path = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const html = await buildReactPage(data, 'designs/home/01-alias.tsx');
    assert.match(html, /Build failed[\s\S]*acstack is not installed/);
  } finally {
    process.env.PATH = path;
  }
});

test('finalize type-checks @acstack/ imports against the same folder', async () => {
  assert.equal(await typecheckChosen(data, 'home', index, chosen('01')), null);
  assert.equal(calls().length, 1);
  writeFileSync(target, `${join(project, 'missing')}\n`);
  assert.match(await typecheckChosen(data, 'home', index, chosen('01')), /Type check failed:\n.*does not exist/);
});
