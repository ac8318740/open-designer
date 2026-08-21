# Releasing open-designer

`open-designer` ships in two places that must stay in lock-step:

1. **Claude Code plugin** – via the `ac-agentic-coding` marketplace. Users get it by installing the plugin.
2. **npm package** – `open-designer-viewer` on the public registry. Users run `npx open-designer-viewer` from their repo root to launch the viewer.

If you bump the plugin version and forget to publish to npm, `npx open-designer-viewer` stays on the old version. Always do both together.

## Source of truth

The version lives in **`.claude-plugin/plugin.json`**. `package.json` is synced from it – never edit `package.json`'s version directly.

## Release steps

Releases publish from CI. Do not publish from your laptop.

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Run `npm run sync-version` and commit both files.
3. Tag and push:

```sh
git tag v0.7.4
git push origin v0.7.4
```

`.github/workflows/release.yml` then syncs the version, builds the viewer from
the committed lockfile, and publishes. It refuses to publish if the tag and
`plugin.json` disagree, because npm versions are immutable and a wrong one
cannot be taken back.

## Auth

There is no token. The workflow uses **trusted publishing**: GitHub mints a
short-lived OIDC credential scoped to this repository and this workflow
filename, and npm accepts it because the package names them as a trusted
publisher. Nothing long-lived exists to leak or expire.

This replaces the automation token the package used to be released with. Such
tokens lost governance permissions on 31 July 2026 and lose direct publish in
January 2027, so the old path is going away regardless.

Two consequences worth knowing:

- **Renaming `release.yml` breaks publishing** until the trusted publisher
  config on npmjs.com is updated to match. The filename is part of the identity
  npm checks.
- **Publishing by hand needs a 2FA code.** The account requires two-factor auth
  for writes, so `npm publish --otp=<code>` is the only manual path. Prefer the
  tag.

`npm run release` still works for a local publish if you have a code, and runs
the same sync and build the workflow does.

## What gets published

Controlled by the `files` allowlist in `package.json`:

- `launcher/` – the zero-dep Node server
- `viewer/dist/` – prebuilt static viewer
- `.claude-plugin/` – so the tarball is still a valid plugin dir
- `LICENSE`, `README.md`

Viewer source, node_modules, and dev configs are excluded.

`viewer/package-lock.json` is committed so CI builds the published artifact from
pinned dependencies. Do not gitignore it again.

## Sanity check before publishing

`npm pack --dry-run` from the repository root prints the exact file list that will go to npm.
