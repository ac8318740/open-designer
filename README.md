# open-designer

A local design loop for Claude Code and Pi. Your coding assistant writes HTML drafts to a folder in your repo. A small static viewer renders the drafts side by side. Click an element, describe the change, copy the feedback, and paste it into your coding session.

No hosted backend or cloud canvas. Just files on disk and your existing coding session.

## What you get

- A `design-system` skill that captures the project's tokens, voice, rules, and gaps as a first-class artifact under `.open-designer/design-systems/<name>/` with a runnable `tokens.css` and playable pages.
- A `design` skill that teaches Claude how to consume the DS on every iteration, write pixel-perfect HTML designs, and iterate based on pasted feedback.
- A `design-integrate` skill that ports a finalized design into the real codebase – DS first, then per-page surfaces.
- Optional use of the [impeccable](https://github.com/pbakaus/impeccable) plugin. With it present, `design-system` imports `tokens.css` from impeccable's `DESIGN.md`. `design-integrate` re-ships tokens after a viewer promote, and runs impeccable's detector on ported pages when spechub is absent. Without impeccable every skill runs as before.
- A static viewer with two modes (Designs / Design systems). Iterate on designs or on the DS itself by selecting elements and pasting feedback.
- An element picker overlay that captures a stable selector, the outer HTML, and key computed styles, then puts a Markdown payload on your clipboard.
- A zero-dependency Node launcher that serves the viewer and the data folder from the same origin.

## Install

### Claude Code

This plugin ships through the `ac-agentic-coding` marketplace. After adding the marketplace to Claude Code, install it with the standard plugin install flow.

### Pi

Install the viewer and native Pi workflows together:

```sh
pi install npm:open-designer-viewer
```

Add `--local` to install only for the current project. Restart Pi or run `/reload`, then use:

- `/open-designer:design-system` to create, edit, or list design systems
- `/open-designer:design` to draft or iterate on a page
- `/open-designer:design-integrate` to port a finalized design after approval

The package also exposes `/skill:design-system`, `/skill:design`, and `/skill:design-integrate`. No separate npm package or Claude installation is needed. Pi commands resolve skills and the viewer from the installed package, not a global checkout. Questions use the host's question tool or pause for a conversational answer. Delegation requires authorization; sequential checks are never claimed as independent review. Optional integrations are used only when available in the current host session.

## Use

The steps below use Claude Code command names. On Pi, use the namespaced commands above; they provide the absolute bundled viewer launcher path. Run that launcher with `node` from your project root instead of fetching another version with `npx`.

1. Run `/design-system` once per project to capture the design system (or point at an existing one).
2. Ask Claude to design or iterate on a page. The `design` skill triggers automatically and reads from the active DS.
3. Claude writes designs to `.open-designer/designs/<name>/` and an `index.json` listing them.
4. Run the viewer from your repo root:

   ```
   npx open-designer-viewer
   ```

   It binds only to `127.0.0.1`, picks a free port, serves the viewer at `/`, exposes `.open-designer/` at `/data/`, and opens your browser. The viewer auto-refreshes when Claude edits files under `.open-designer/` – no manual reload. Override the port with `OPEN_DESIGNER_PORT=5200 npx open-designer-viewer`. Skip auto-open with `OPEN_DESIGNER_NO_OPEN=1 npx open-designer-viewer`.
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
extensions/open-designer.js  – Pi namespaced command dispatch
skills/HOST.md               – host tools, approvals, and bundled-resource paths
package.json                 – npm viewer launcher and native Pi package
RELEASING.md                 – how to publish a new version
LICENSE                      – MIT
```

## Releasing

See [RELEASING.md](./RELEASING.md). Bump `.claude-plugin/plugin.json`, run `npm run sync-version`, and merge the verified changes to `main` before tagging. CI builds, tests, packs, and stages the exact verified tarball with OIDC. A maintainer reviews and approves the npm stage with 2FA before the package becomes public.

## License

MIT. See `LICENSE`.
