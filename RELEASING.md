# Releasing open-designer

`open-designer` ships as a Claude Code marketplace plugin and as the npm package `open-designer-viewer`. The npm package contains the standalone viewer and, starting with 0.7.8, native Pi commands and shared skills. Keep their versions aligned. A merged plugin update does not make the npm version available until a maintainer approves its stage.

## Version source

The version lives in `.claude-plugin/plugin.json`. Run `npm run sync-version` to update `package.json`; never edit the root version independently. CI checks the sync without modifying it.

## Stage from CI, then approve as a human

1. Bump `.claude-plugin/plugin.json`, run `npm run sync-version`, and commit both files with the release changes.
2. Open a PR to `main`. `.github/workflows/release.yml` runs the Node package tests, builds the viewer from its lockfile, runs viewer tests and TypeScript checks, packs the npm artifact, and tests the extracted tarball's commands, resources, and loopback viewer. PR jobs have read-only repository permissions and cannot stage.
3. After merge, tag that commit and push the tag:

    ```sh
    git tag v0.7.8
    git push origin v0.7.8
    ```

    Alternatively, dispatch the Release workflow on `main`. Tag runs reject a version mismatch or a commit outside `main` history.
4. CI uploads the tested tarball. A separate job downloads that same immutable workflow artifact, verifies its SHA-256 against the build job's output, and runs `npm stage publish <tarball> --access public`. Only this job receives `id-token: write`; it never rebuilds or directly publishes the package.
5. An npm maintainer reviews and approves the stage in npm's web interface, or with a logged-in CLI and 2FA:

    ```sh
    npm stage list open-designer-viewer
    npm stage view <stage-id>
    npm stage approve <stage-id>
    ```

    Review package contents, version, source commit, and provenance before approval. OIDC can stage, but cannot approve. A successful CI stage is not a public release; installation instructions for the new version work only after approval. If a stage already exists for the version, inspect it before retrying or changing the version.

## Trusted-publisher setup

The workflow uses Node 24 and npm 11.19.0. Staging requires npm 11.15.0 or later and Node 22.14.0 or later; the standalone viewer keeps its Node 18 minimum.

On npmjs.com, verify that the existing `open-designer-viewer` trusted publisher names this repository and the exact `.github/workflows/release.yml` workflow filename, and allows **staged publishing**. Prefer disabling direct publishing for that identity. Do not rename the workflow without updating npm's configuration. No long-lived token or secret fallback is used.

The package already exists, so reusing it requires no first-package bootstrap. The repository cannot prove or change npm account permissions: an owner must verify the trusted publisher and human maintainer's 2FA access before the first staging run. A new package would require separate npm setup; this release does not create one.

See npm's [staged publishing guide](https://docs.npmjs.com/staged-publishing/) and [`npm stage` reference](https://docs.npmjs.com/cli/v11/commands/npm-stage/).

## Local checks and exceptional local staging

From the repository root:

```sh
npm test
npm run build:viewer
npm --prefix viewer test -- --run
npm --prefix viewer exec -- tsc --noEmit -p viewer/tsconfig.json
npm pack --ignore-scripts
npm run test:packed -- open-designer-viewer-0.7.8.tgz
```

The packed smoke requires Linux with `tar` and `ss`. It extracts into a temporary path containing spaces, checks every skill companion, invokes all three Pi command handlers, and starts only the packed viewer on an ephemeral `127.0.0.1` port with fixture data. It verifies the actual listener and HTTP responses, then stops its process and removes its fixture. This is not a real Pi or browser smoke; perform those separately before claiming end-to-end host support.

Prefer CI. `npm run release` is an explicit exceptional local **staging** command: it checks versions, runs the same build/tests/pack smoke, and stages that tarball using your logged-in npm session. It needs the staging CLI versions above and is not a dry run. It neither writes temporary credentials nor approves a stage.

## Package contents

The `package.json` allowlist ships:

- `extensions/` and `skills/`, including every companion and `HOST.md`
- `launcher/`, the zero-dependency Node viewer server
- `viewer/dist/`, the prebuilt static viewer
- `.claude-plugin/`, the plugin manifest
- `LICENSE` and `README.md`

Viewer source, `node_modules`, tests, and dev configuration are excluded. Keep `viewer/package-lock.json` committed so CI builds from pinned dependencies.
