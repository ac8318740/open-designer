# Init – repo scan

Run once per repo, then refresh on demand. Output goes to `.open-designer/init/` plus the design-system contract at `.open-designer/design-system.md`.

## Goal

Capture enough of the existing UI surface that any later design draft can stay faithful to the codebase without re-reading half the repo.

## Steps

1. **Detect the stack.**
   - Look for `package.json`, `pyproject.toml`, `composer.json`, etc.
   - Look for framework markers – `next.config.*`, `vite.config.*`, `nuxt.config.*`, `app/` vs `pages/` directories, Tailwind config, plain CSS.
   - Note the result in a one-line header at the top of every init file.

2. **Routes (`routes.md`).**
   - For Next.js / Remix / Nuxt, walk the routes directory and list each route with the file backing it.
   - For SPA setups (React Router, Vue Router), find the router config and list each `path` with its component.
   - Output as a table: route, file, one-line purpose.

3. **Layouts (`layouts.md`).**
   - Find layout shells, page wrappers, app shells, navigation chrome.
   - For each, capture the file path and a sentence on what it wraps.

4. **Components (`components.md`).**
   - List components actually imported somewhere – ignore unused exports.
   - Group atomic (Button, Input, Badge) vs composite (Modal, Dialog, Card grids).
   - One row per component: name, file, props that matter for layout (variant, size, intent).

5. **Theme (`theme.md`).**
   - Find the source of truth for design tokens – Tailwind config, CSS custom properties, a theme module, a Figma-exported tokens file.
   - Capture: colors (with names and hex values), font families, type scale, spacing scale, radii, shadows, motion timings.
   - Do not list any token that is not already in the codebase.

6. **Pages (`pages.md`).**
   - Pair each route with a one-line summary of what the user does there. Pull from page-level comments, the route's main component, or commit history if needed.

7. **Extractable components (`extractable-components.md`).**
   - Scan for repeated inline blocks that look like components but were never extracted (e.g. the same card markup three times, the same form-row pattern in five files).
   - List each candidate with the files that use it. This is feedback for future refactors – not used by the design loop directly, but useful when porting a chosen draft back into the codebase.

8. **Design-system contract (`.open-designer/design-system.md`).**
   - Distill `theme.md` into a tight allow-list. Format:

     ```
     # Design system – allow-list

     Colors:
     - brand-amber-500: #F59E0B
     - brand-ink-900: #0F172A
     ...

     Typography:
     - font-display: "Inter", sans-serif
     - font-mono: "JetBrains Mono", monospace
     - scale: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48

     Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
     Radii: 4 / 8 / 12 / 9999
     Shadows: sm / md / lg (definitions inline)
     Motion: 120ms / 200ms / 320ms ease-out
     ```

   - Every later draft must use only what is listed here.

## When to refresh

Re-run init when:

- A new route or major component lands.
- The theme changes (new tokens, renamed tokens, removed tokens).
- The user asks ("re-init the design skill", "re-init open-designer").

Refresh in place. Do not append history files – the init folder is always the current snapshot.
