#!/usr/bin/env node
// Release the open-designer npm package.
//
// Steps:
//   1. Sync version from .claude-plugin/plugin.json → package.json
//   2. Build the viewer (vite build)
//   3. Run `npm publish`
//
// Auth:
//   - If NPM_TOKEN is set, a temporary .npmrc is written for the publish step.
//   - Otherwise, `npm publish` uses the logged-in session from `npm login`.

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const tempNpmrc = resolve(pluginRoot, ".npmrc.release");

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: pluginRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function cleanup() {
  if (existsSync(tempNpmrc)) rmSync(tempNpmrc);
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

run("node", ["scripts/sync-version.mjs"]);
run("npm", ["--prefix", "viewer", "install", "--no-audit", "--no-fund"]);
run("npm", ["--prefix", "viewer", "run", "build"]);

const publishArgs = ["publish", "--access", "public"];
if (process.env.NPM_TOKEN) {
  writeFileSync(
    tempNpmrc,
    `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`,
  );
  publishArgs.push("--userconfig", tempNpmrc);
  console.log("Using NPM_TOKEN for publish auth.");
} else {
  console.log("No NPM_TOKEN set – using your logged-in npm session.");
}

run("npm", publishArgs);

const pkg = JSON.parse(readFileSync(resolve(pluginRoot, "package.json"), "utf8"));
console.log(`\nPublished ${pkg.name}@${pkg.version}`);
console.log("Don't forget to commit the version bump and any synced package.json changes.");
