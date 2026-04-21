import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import { dataServer } from "./vite-plugins/data-server";

const __dirname = dirname(fileURLToPath(import.meta.url));

// By default, serve drafts from the marketplace repo root's `.open-designer/`
// (three levels up from this viewer: viewer → open-designer → plugins → repo).
// Override with OPEN_DESIGNER_DATA to point at any other project's drafts.
const DATA_ROOT =
  process.env.OPEN_DESIGNER_DATA ?? resolve(__dirname, "../../../.open-designer");

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [dataServer(DATA_ROOT)],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5180,
    host: "127.0.0.1",
    strictPort: false,
  },
});
