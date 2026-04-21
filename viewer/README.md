# open-designer viewer

Static viewer for HTML drafts written by the open-designer skill.

## Develop

```
npm install
npm run dev
```

The dev server runs at `http://localhost:5180`. It expects `.open-designer/`
to be served at `/data/`. The simplest way is to run the launcher in another
terminal pointing at the same folder, or use the build output below.

## Build

```
npm run build
```

Outputs to `dist/`. The launcher (`../launcher/serve.mjs`) picks up the
build automatically.

## Architecture

- `index.html` – shell with header and grid container.
- `src/main.ts` – fetches `/data/drafts/index.json`, renders an iframe per draft.
- `src/picker.ts` – injects hover outline, click selection, and a side panel into each iframe.
- `src/clipboard.ts` – builds the Markdown payload that the user pastes back into Claude Code.
- `src/styles.css` – viewer chrome plus picker panel styles.

The viewer and the drafts are served from the same origin, so the picker
can read into iframes directly via `iframe.contentDocument`. No
`postMessage` bridge.
