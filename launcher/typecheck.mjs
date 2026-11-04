#!/usr/bin/env node
// `tsc --noEmit` for React designs at finalize. The launcher runs this as a
// child process, so the compiler's memory goes back when it exits. It uses
// the project's own TypeScript and, once components ship, the compiler
// options of the tsconfig.json nearest the shipped components.
//
// Usage: node typecheck.mjs '{"projectRoot", "componentsDir", "shipped", "files"}'
// Exits 1 with diagnostics on stdout when the check fails.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const { projectRoot, componentsDir, shipped, files } = JSON.parse(process.argv[2]);

// A monorepo app keeps its TypeScript beside its components, not at the root.
let ts;
let nodeModules;
for (const dir of [projectRoot, componentsDir].filter(Boolean)) {
  try {
    const require = createRequire(join(dir, "package.json"));
    ts = require("typescript");
    nodeModules = dirname(dirname(require.resolve("typescript/package.json")));
    break;
  } catch {
    /* try the next place */
  }
}
if (!ts) {
  console.log("Skipped the type check: typescript is not installed in this project.");
  process.exit(0);
}

let base = {};
const config = shipped && ts.findConfigFile(componentsDir, ts.sys.fileExists);
if (config) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  base = ts.getParsedCommandLineOfConfigFile(config, {}, host)?.options ?? {};
}

const options = {
  strict: true,
  skipLibCheck: true,
  ...base,
  noEmit: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolveJsonModule: true,
  allowImportingTsExtensions: true,
  pathsBasePath: base.pathsBasePath ?? projectRoot,
  paths: {
    // Design files sit outside the app, so they find React's types where TypeScript was found.
    "*": [join(nodeModules, "@types", "*"), join(nodeModules, "*")],
    ...base.paths,
    ...(componentsDir ? { "@ds/*": [join(componentsDir, "*")] } : {}),
  },
};

const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options));
if (diagnostics.length > 0) {
  process.stdout.write(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => projectRoot,
      getNewLine: () => "\n",
    }),
  );
  process.exit(1);
}
