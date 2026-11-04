# Changelog

## 0.8.0

- **React design systems.** A design system with `framework: "react"` builds `.tsx` pages with esbuild and the project's own Tailwind, so the winning code lifts into the app (#10).
- **Single-file builds.** `open-designer build` writes one design page, every variant, and its tweak definitions as one self-contained HTML file for hosts without an OpenDesigner server, such as ACStack design docs (#10).
- **`@acstack/` fixture imports.** `@acstack/maps/<map>/elements/<id>/<fixture>.json` resolves through `acstack project-data path`, so fixtures load whether ACStack data is tracked in the repo or kept globally.
- **Sandboxed design frames.** The viewer shows each design in a sandboxed iframe behind a frame Content Security Policy and talks to it only over a message bridge, so design scripts cannot reach the viewer (#9).
- **Write guard.** The finalize, promote, and approvals endpoints require a per-launch token and a loopback origin, which blocks cross-site writes (#8).
