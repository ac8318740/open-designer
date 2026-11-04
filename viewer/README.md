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

- `index.html` – shell with header, the design frame, and panels.
- `src/main.ts` – loads designs and design systems from `/data/`, drives the frame, the tweaks panel, and the sync panel.
- `src/bridge/` – the message bridge between the viewer and the design frame (protocol version 1).
    - `protocol.ts` – message shapes and limits
    - `host.ts` – the viewer side: trust checks, rate limit, load tracking, and coalescing
    - `frame.ts` – the in-frame script: picker, token and tweak styles, marks, scroll, and key forwarding
- `src/picker.ts` – the viewer's copy of the selections the frame reports.
- `src/clipboard.ts` – builds the Markdown payload that the user pastes back into Claude Code. Frame-supplied fields go in a fence labelled as untrusted page content.
- `src/styles.css` – viewer chrome.

### The design frame

Designs load in `<iframe sandbox="allow-scripts">`, so each design has an
opaque origin: no cookies, no storage, and no access to the viewer. The
viewer never reads `iframe.contentDocument`; everything goes through
`postMessage`.

- **The server enforces the sandbox too.** The launcher and the Vite dev server send `Content-Security-Policy: sandbox allow-scripts` plus the frame CSP on every `.html` file under `/data/` (`frameCsp` in `launcher/finalize.mjs`). Because designs link their own CSS, scripts, and images, the server's own loopback origin is allowed for those; `connect-src` stays `https:` only, so a design cannot call the launcher. Fonts and other assets from any other `http:` origin are blocked.
- **The bridge script is inlined into every design document** as the first element of `<head>`. The build emits it as `dist/od-bridge.js`, one standalone classic script; the dev server builds it per request. ACStack vendors a pinned copy.
- **Handshake.** The frame sends `ready`; the viewer answers `init` with the token sheets, tweak values, picker state, and forwarded key combos; the frame applies them, waits for its stylesheets (300 ms cap), and sends `applied`. The viewer keeps the frame faded until then.
- **Edits never reload.** Tweak changes send `tweaks`; a `tokens.css` edit sends `tokens`. A reload (refresh button, design edit) first asks for a `snapshot` and hands scroll and selections back in `init.restore`.
- **Self-navigation stops the bridge.** If the frame loads a document the viewer did not start, the viewer blanks it and shows a notice.
