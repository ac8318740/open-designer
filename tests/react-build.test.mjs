import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';
import { buildReactPage, typecheckChosen } from '../launcher/react-build.mjs';
import { frameCsp } from '../launcher/finalize.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = '<!doctype html><html><head></head><body><p>plain</p></body></html>';

// Inside the repo, so react resolves from the repo's node_modules.
const project = mkdtempSync(join(root, 'tests', '.tmp-react-'));
const data = join(project, '.open-designer');
const write = (path, content) => {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), typeof content === 'string' ? content : JSON.stringify(content));
};

write('.open-designer/design-systems/demo/manifest.json', { name: 'demo', framework: 'react' });
write(
  '.open-designer/design-systems/demo/components/card.tsx',
  `export type CardProps = { title: string; tags: string[] };
export function Card({ title, tags }: CardProps) {
  return <article className="p-4"><h2>{title}</h2><ul>{tags.map((t) => <li key={t}>{t}</li>)}</ul></article>;
}
`,
);
write('.acstack/maps/demo/elements/notebook/notebook.json', { title: 'Q3 revenue model', tags: ['finance'] });
write('.open-designer/designs/home/index.json', {
  designSystem: 'demo',
  pages: [
    {
      id: 'home',
      variants: [
        { id: '01', file: '01-default.tsx' },
        { id: '02', file: '02-plain.html', discardReason: 'x' },
        { id: '03', file: '03-bad.tsx', discardReason: 'x' },
      ],
    },
  ],
});
write(
  '.open-designer/designs/home/01-default.tsx',
  `import { Card } from "@ds/card";
import notebook from "../../../.acstack/maps/demo/elements/notebook/notebook.json";
export default function Page() {
  return <main><Card {...notebook} /></main>;
}
`,
);
write('.open-designer/designs/home/02-plain.html', PLAIN);
write(
  '.open-designer/designs/home/03-bad.tsx',
  `import { Card } from "@ds/card";
export default function Page() {
  return <Card title={1} tags={[]} />;
}
`,
);

after(() => rmSync(project, { recursive: true, force: true }));

test('a React page builds into .build with the vendor bundle beside it', async () => {
  const html = await buildReactPage(data, 'designs/home/01-default.tsx');
  assert.match(html, /<div id="od-root"><\/div>/);
  assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4"><\/script>/);
  assert.match(html, /<script src="\/data\/\.build\/_vendor\/demo\.js"><\/script>\s*<script src="\/data\/\.build\/designs\/home\/01-default\.js"><\/script>/);
  assert.equal(readFileSync(join(data, '.build/designs/home/01-default.html'), 'utf8'), html);
  const vendor = readFileSync(join(data, '.build/_vendor/demo.js'), 'utf8');
  const page = readFileSync(join(data, '.build/designs/home/01-default.js'), 'utf8');
  assert.match(vendor, /window\.__odVendor = /);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(data, '.build/_vendor/demo.json'), 'utf8'))).sort(), [
    'react',
    'react-dom/client',
    'react/jsx-runtime',
  ]);
  // React lives only in the vendor bundle.
  assert.ok(!page.includes('react.development'), 'page bundle inlined React');
  assert.ok(vendor.includes('react.development'));
});

test('the built page renders the data-od-* attributes and answers the props lookup', async () => {
  // Node's console: happy-dom's own lacks console.timeStamp, which React's dev build calls.
  const window = new Window({ url: 'http://127.0.0.1/', console });
  try {
    window.document.body.innerHTML = '<div id="od-root"></div>';
    window.eval(readFileSync(join(data, '.build/_vendor/demo.js'), 'utf8'));
    window.eval(readFileSync(join(data, '.build/designs/home/01-default.js'), 'utf8'));
    await window.happyDOM.waitUntilComplete(); // React's render and the runtime's animation frame
    const card = window.document.querySelector('[data-od-component]');
    assert.ok(card, 'no element carries data-od-component');
    assert.equal(card.tagName, 'ARTICLE');
    assert.equal(card.getAttribute('data-od-component'), 'Card');
    assert.equal(card.getAttribute('data-od-source'), 'components/card.tsx');
    assert.equal(card.getAttribute('data-od-fixture'), 'notebook.json');
    assert.equal(card.hasAttribute('data-od-props'), false);
    // JSON round trip: the frame's objects come from another realm.
    assert.deepEqual(JSON.parse(JSON.stringify(window.__od.props.get(card))), { title: 'Q3 revenue model', tags: ['finance'] });
    assert.equal(window.__od.props.get(window.document.querySelector('h2')), undefined);
  } finally {
    await window.happyDOM.close();
  }
});

test('shipped components resolve to the app primitives through the app tsconfig paths', async () => {
  write('app/tsconfig.json', { compilerOptions: { jsx: 'preserve', paths: { '@/*': ['./src/*'] } } });
  write('app/src/lib/label.ts', 'export const label = (s: string) => `shipped ${s}`;\n');
  write(
    'app/src/ui/primitives/card.tsx',
    'import { label } from "@/lib/label";\nexport function Card({ title }: { title: string }) {\n  return <section>{label(title)}</section>;\n}\n',
  );
  write('.open-designer/design-systems/shipped/manifest.json', {
    name: 'shipped',
    framework: 'react',
    shippedTo: project,
    shippedComponents: 'app/src/ui/primitives',
  });
  write('.open-designer/designs/live/index.json', { designSystem: 'shipped', pages: [] });
  write('.open-designer/designs/live/01-default.tsx', 'import { Card } from "@ds/card";\nexport default () => <Card title="x" />;\n');
  const html = await buildReactPage(data, 'designs/live/01-default.tsx');
  assert.doesNotMatch(html, /Build failed/);
  const page = readFileSync(join(data, '.build/designs/live/01-default.js'), 'utf8');
  assert.match(page, /shipped \$\{s\}/);
  assert.doesNotMatch(page, /<section>/, "the app tsconfig jsx: preserve leaked into the build");
  assert.match(page, /"app\/src\/ui\/primitives\/card\.tsx"/);
});

test('a failed build returns a page that shows the error', async () => {
  write('.open-designer/designs/home/04-broken.tsx', 'import { Nope } from "@ds/missing";\nexport default () => <Nope />;\n');
  const html = await buildReactPage(data, 'designs/home/04-broken.tsx');
  assert.match(html, /Build failed/);
  assert.match(html, /@ds\/missing|\.\/missing/);
});

test('finalize type-checks the chosen React variants only', async () => {
  const index = JSON.parse(readFileSync(join(data, 'designs/home/index.json'), 'utf8'));
  const chosen = (variantId) => ({ pages: { home: { variantId } } });
  assert.equal(await typecheckChosen(data, 'home', index, chosen('01')), null);
  assert.equal(await typecheckChosen(data, 'home', index, chosen('02')), null);
  assert.match(await typecheckChosen(data, 'home', index, chosen('03')), /Type check failed:[\s\S]*03-bad\.tsx[\s\S]*number/);
});

let proc;
let base;

before(async () => {
  proc = spawn(process.execPath, [join(root, 'launcher/serve.mjs')], {
    cwd: project,
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

after(() => proc?.kill());

const get = (path) =>
  new Promise((ok, fail) => {
    request(`${base}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, csp: res.headers['content-security-policy'], body }));
    })
      .on('error', fail)
      .end();
  });

test('the launcher serves a .tsx page as its sandboxed build', async () => {
  const r = await get('/data/designs/home/01-default.tsx');
  assert.equal(r.status, 200);
  assert.equal(r.csp, frameCsp(new URL(base).host));
  assert.match(r.body, /<div id="od-root"><\/div>/);
  assert.equal((await get('/data/.build/_vendor/demo.js')).status, 200);
});

test('the launcher leaves framework: html designs untouched', async () => {
  const r = await get('/data/designs/home/02-plain.html');
  assert.equal(r.status, 200);
  assert.equal(r.csp, frameCsp(new URL(base).host));
  assert.equal(r.body.replace(/<script data-od-bridge>[\s\S]*?<\/script>/, ''), PLAIN);
  assert.equal(existsSync(join(data, '.build/designs/home/02-plain.html')), false);
});
