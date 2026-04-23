# open-designer

A local design loop for Claude Code. Claude writes HTML drafts to a folder in your repo. A small static viewer renders the drafts side by side. You click any element in the viewer, type what you want changed, hit copy, and paste the result back into Claude Code. Claude edits the draft and the loop continues.

No hosted backend. No API key billed by a third party. No cloud canvas. Just files on disk and your existing Claude Code session.

## What you get

- A `design-system` skill that captures the project's tokens, voice, rules, and gaps as a first-class artifact under `.open-designer/design-systems/<name>/` with a runnable `tokens.css` and playable pages.
- A `design` skill that teaches Claude how to consume the DS on every iteration, write pixel-perfect HTML designs, and iterate based on pasted feedback.
- A `design-integrate` skill that ports a finalized design into the real codebase – DS first, then per-page surfaces.
- A static viewer with two modes (Designs / Design systems). Iterate on designs or on the DS itself by selecting elements and pasting feedback.
- An element picker overlay that captures a stable selector, the outer HTML, and key computed styles, then puts a Markdown payload on your clipboard.
- A zero-dependency Node launcher that serves the viewer and the data folder from the same origin.

## Install

This plugin ships through the `ac8318740-plugins` marketplace. After adding the marketplace to Claude Code, install it with the standard plugin install flow.

## Use

1. Run `/design-system` once per project to capture the design system (or point at an existing one).
2. Ask Claude to design or iterate on a page. The `design` skill triggers automatically and reads from the active DS.
3. Claude writes designs to `.open-designer/designs/<name>/` and an `index.json` listing them.
4. Run the viewer from your repo root:

   ```
   npx open-designer-viewer
   ```

   It picks a free port, serves the viewer at `/`, exposes `.open-designer/` at `/data/`, and opens your browser. Override the port with `OPEN_DESIGNER_PORT=5200 npx open-designer-viewer`. Skip auto-open with `OPEN_DESIGNER_NO_OPEN=1 npx open-designer-viewer`.
5. Click any element in any design. Type your intent. Hit copy. Paste into Claude Code. Claude edits the target design.
6. In Design systems mode, tweak tokens and click Promote to write values back to `tokens.css`.

## Layout

```
.claude-plugin/plugin.json   – manifest
skills/design-system/        – create / edit / list design systems
skills/design/               – the design-loop workflow Claude follows
skills/design-integrate/     – port a finalized design into the codebase
viewer/                      – static viewer (Vite build)
launcher/serve.mjs           – zero-dep static server
package.json                 – also published to npm as `open-designer-viewer` (for `npx open-designer-viewer`)
RELEASING.md                 – how to publish a new version
LICENSE                      – MIT
```

## Releasing

See [RELEASING.md](./RELEASING.md). Short version: bump `.claude-plugin/plugin.json` version, then `npm run release` from this directory. The plugin and the npm package must stay in lock-step.

## License

MIT. See `LICENSE`.
