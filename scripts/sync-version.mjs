#!/usr/bin/env node
// Single source of truth for the plugin version is .claude-plugin/plugin.json.
// This script copies that version into package.json so `npm publish` ships the right tag.
// Run manually with `npm run sync-version`. Also runs automatically via `prepublishOnly`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const pluginJsonPath = resolve(pluginRoot, ".claude-plugin/plugin.json");
const packageJsonPath = resolve(pluginRoot, "package.json");

const plugin = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (!plugin.version) {
  console.error("plugin.json is missing a version field");
  process.exit(1);
}

if (pkg.version === plugin.version) {
  console.log(`package.json already at ${pkg.version}`);
  process.exit(0);
}

// --check verifies instead of writing. prepublishOnly uses it because npm reads
// package.json into memory BEFORE running the hook, so syncing there is too
// late to change the version being published - a bare `npm publish` would
// silently ship the previous version. Failing loudly is the only useful thing
// a hook can do at that point. release.mjs still runs the real sync first.
if (process.argv.includes("--check")) {
  console.error(
    `package.json is ${pkg.version} but plugin.json is ${plugin.version}.\n` +
      "Run `npm run release` rather than `npm publish` - it syncs the version " +
      "before npm reads it. Publishing now would ship " + pkg.version + ".",
  );
  process.exit(1);
}

pkg.version = plugin.version;
writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`package.json synced to ${plugin.version}`);
