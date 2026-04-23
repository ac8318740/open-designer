# Releasing open-designer

`open-designer` ships in two places that must stay in lock-step:

1. **Claude Code plugin** – via the `ac8318740-plugins` marketplace. Users get it by installing the plugin.
2. **npm package** – `open-designer` on the public registry. Users run `npx open-designer` from their repo root to launch the viewer.

If you bump the plugin version and forget to republish to npm, `npx open-designer` stays on the old version. Always do both together.

## Source of truth

The version lives in **`.claude-plugin/plugin.json`**. `package.json` is synced from it – never edit `package.json`'s version directly.

## Release steps

From `plugins/open-designer/`:

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Run `npm run release`.
   - Syncs `package.json` version from `plugin.json`.
   - Installs viewer deps and runs `vite build` (the tarball ships `viewer/dist/`).
   - Publishes to npm (`npm publish --access public`).
3. Commit the version bump + synced `package.json` via `/commit`.

## Auth

- **Locally**: run `npm login` once. The release script uses your session.
- **CI / automation**: export `NPM_TOKEN` (an npm automation token). The release script writes a temporary `.npmrc` scoped to the publish step and cleans it up after. Automation tokens bypass 2FA.

## What gets published

Controlled by the `files` allowlist in `package.json`:

- `launcher/` – the zero-dep Node server
- `viewer/dist/` – prebuilt static viewer
- `.claude-plugin/` – so the tarball is still a valid plugin dir
- `LICENSE`, `README.md`

Viewer source, node_modules, and dev configs are excluded.

## Sanity check before publishing

`npm pack --dry-run` from `plugins/open-designer/` prints the exact file list that will go to npm.
