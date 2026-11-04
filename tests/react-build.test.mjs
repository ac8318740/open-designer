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
write('.open-designer/design-systems/demo/tokens.css', ':root { --demo-ink: #101828; }\n');
write('.open-designer/design-systems/demo/styles.css', '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n');
write(
  '.open-designer/design-systems/demo/components/card.tsx',
  `export type CardProps = { title: string; tags: string[] };
export function Card({ title, tags }: CardProps) {
  return <article className="bg-brand p-4"><h2>{title}</h2><ul>{tags.map((t) => <li key={t}>{t}</li>)}</ul></article>;
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
  assert.doesNotMatch(html, /tailwindcss\/browser/);
  assert.match(html, /<link rel="stylesheet" href="\/data\/\.build\/designs\/home\/01-default\.css">/);
  // The project's Tailwind compiled the design system's theme over the page's classes only.
  const css = readFileSync(join(data, '.build/designs/home/01-default.css'), 'utf8');
  assert.match(css, /\.bg-brand\s*\{\s*background-color: var\(--color-brand\)/);
  assert.match(css, /--color-brand: #123456/);
  assert.doesNotMatch(css, /\.bg-red-500/);
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
  assert.doesNotMatch(html, /rel="stylesheet"/, 'a design system with no stylesheet links no CSS');
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

const bridge = join(root, 'viewer/dist/od-bridge.js');

write('.open-designer/designs/multi/index.json', {
  designSystem: 'demo',
  tweaks: [{ id: 'density', type: 'select', label: 'Density', target: '--density', options: ['compact', 'cozy'], default: 'cozy' }],
  pages: [
    {
      id: 'home',
      label: 'Home',
      tweaks: [{ id: 'empty', type: 'state', label: 'Empty', values: ['no', 'yes'] }],
      variants: [
        { id: '01', label: 'Cards', file: '01-cards.tsx' },
        { id: '02', label: 'List', file: '02-list.tsx', discardReason: 'denser' },
      ],
    },
  ],
});
write('.open-designer/designs/multi/01-cards.tsx', 'import { Card } from "@ds/card";\nexport default () => <Card title="Cards variant" tags={["a"]} />;\n');
write('.open-designer/designs/multi/02-list.tsx', 'export default () => <ul className="bg-brand"><li>List variant</li></ul>;\n');

const cli = (args) =>
  new Promise((ok) => {
    const child = spawn(process.execPath, [join(root, 'launcher/serve.mjs'), 'build', ...args], { cwd: project });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => ok({ code, stdout, stderr }));
  });

test('open-designer build writes one self-contained page with every variant', async () => {
  assert.ok(existsSync(bridge), 'run npm run build:viewer first: the single-file build inlines viewer/dist/od-bridge.js');
  const r = await cli(['multi', '--page', 'home']);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.path, join(data, '.build/single/multi/home.html'));
  assert.deepEqual({ ...out, path: undefined, size: undefined }, { path: undefined, size: undefined, design: 'multi', page: 'home', variant: '01', variants: ['01', '02'] });
  const html = readFileSync(out.path, 'utf8');
  assert.equal(out.size, Buffer.byteLength(html));
  assert.ok(out.size < 400_000, `${out.size} bytes: production React should be well under 400 KB`);
  assert.match(html, /<head><script data-od-bridge>/);
  assert.doesNotMatch(html, /<script src=|<link /, 'nothing loads from a server');
  assert.ok(!html.includes('react.development'));
  assert.match(html, /<style data-od-tokens="demo">:root \{ --demo-ink: #101828; \}/);
  assert.match(html, /<style data-od-css>[\s\S]*\.bg-brand/);
  const meta = JSON.parse(/<script type="application\/json" id="od-page">(.*?)<\/script>/.exec(html)[1]);
  assert.equal(meta.designTweaks[0].id, 'density');
  assert.equal(meta.page.tweaks[0].id, 'empty');
  assert.deepEqual(meta.variants.map((v) => [v.id, v.label, v.discardReason]), [['01', 'Cards', undefined], ['02', 'List', 'denser']]);

  // The host switches variant by rewriting <meta name="od-variant">.
  for (const [variant, text] of [['01', 'Cards variant'], ['02', 'List variant']]) {
    const window = new Window({ url: 'http://127.0.0.1/', console, settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } }); // our own build
    try {
      window.document.write(html.replace('<meta name="od-variant" content="01">', `<meta name="od-variant" content="${variant}">`));
      await window.happyDOM.waitUntilComplete();
      assert.match(window.document.getElementById('od-root').textContent, new RegExp(`^${text}`));
    } finally {
      await window.happyDOM.close();
    }
  }
});

test('open-designer build fails clearly on an HTML page and on bad arguments', async () => {
  const html = await cli(['home', '--page', 'home']);
  assert.equal(html.code, 1);
  assert.match(html.stderr, /open-designer build failed: variant 02 \(02-plain\.html\) is not a React page/);
  const missing = await cli(['multi', '--page', 'nope']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /has no page nope; pages: home/);
  assert.equal((await cli(['multi'])).code, 2);
});
