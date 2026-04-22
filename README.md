# open-designer

A local design loop for Claude Code. Claude writes HTML drafts to a folder in your repo. A small static viewer renders the drafts side by side. You click any element in the viewer, type what you want changed, hit copy, and paste the result back into Claude Code. Claude edits the draft and the loop continues.

No hosted backend. No API key billed by a third party. No cloud canvas. Just files on disk and your existing Claude Code session.

## What you get

- A skill (`design`) that teaches Claude how to gather UI context, write pixel-perfect HTML drafts, and iterate based on pasted feedback. A companion skill (`design-integrate`) ports a finalized variant into the real codebase.
- A static viewer that renders the drafts in an iframe grid.
- An element picker overlay that captures a stable selector, the outer HTML, and key computed styles, then puts a Markdown payload on your clipboard.
- A zero-dependency Node launcher that serves the viewer and the drafts folder from the same origin.

## Install

This plugin ships through the `ac8318740-plugins` marketplace. After adding the marketplace to Claude Code, install it with the standard plugin install flow.

## Use

1. Ask Claude to design or iterate on a page. The skill triggers automatically.
2. Claude writes drafts to `.open-designer/drafts/<project>/` and an `index.json` listing them.
3. Run the viewer:

   ```
   node plugins/open-designer/launcher/serve.mjs
   ```

   It picks a free port, serves the viewer at `/`, exposes `.open-designer/` at `/data/`, and opens your browser.
4. Click any element in any draft. Type your intent. Hit copy. Paste into Claude Code. Claude edits the target draft.

## Layout

```
.claude-plugin/plugin.json   – manifest
skills/design/               – the design-loop workflow Claude follows
skills/design-integrate/     – port a finalized variant into the codebase
viewer/                      – static viewer (Vite build)
launcher/serve.mjs           – zero-dep static server
LICENSE                      – MIT
```

## License

MIT. See `LICENSE`.
