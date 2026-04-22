# Create flow

Two branches depending on what the repo has: **brownfield** (existing UI, code is the source of truth) and **greenfield** (no UI yet, a named reference base is the source of truth).

Always start by detecting the surface.

## Step 1 – detect surface

Run a quick scan:

- `package.json`, `pyproject.toml`, `composer.json` – stack.
- `tailwind.config.*`, `postcss.config.*` – Tailwind setup.
- `globals.css`, `src/styles/*.css`, `app/globals.css` – CSS var source of truth.
- `git branch -a` – sibling UI branches that might indicate a multi-surface repo (marketing vs app, internal vs external).
- Route tree under `app/`, `pages/`, `src/pages/`, `routes/`.

Write the one-line stack header into every `briefing/*.md` you produce (same as the old INIT header).

If the scan finds **zero UI under source control** and **zero imports of a UI framework**, go to the greenfield branch. Otherwise, brownfield.

## Brownfield branch

### 2b.1 – Run the codebase scan

Produce `briefing/*.md` and `tokens.css` from the source of truth. Do not invent.

- **`routes.md`** – route table. For Next.js / Remix / Nuxt, walk the routes directory; for SPAs, find the router config. Columns: route, file, **what the user does there** (one line). This column merges the old `pages.md` into this file. Pull the activity summary from the page's main component, its JSX text, or a one-line code comment – never guess.
- **`layouts.md`** – shells, grids, page wrappers. One row: file path, what it wraps.
- **`components.md`** – components actually imported somewhere. Ignore unused exports. Group atomic (Button, Input) vs composite (Modal, Card grids). Columns: name, file, layout-relevant props.
- **`theme.md`** – colors, font families, type scale, spacing, radii, shadows, motion. Pull from the source of truth (Tailwind config → CSS vars → theme module). No token appears here unless it's in the code.
- **`extractable-components.md`** – repeated inline patterns that look like components but live inline. Feedback for future refactors.

### 2b.2 – Run the conventions sweep

This is what produces `voice.md`, `rules.md`, `gaps.md`. See `CONVENTIONS.md` for the exact inputs and outputs. Summary:

- Read `README.md`, `DESIGN_PRINCIPLES.md`, `CLAUDE.md`, comments at the top of `globals.css`, commit messages relevant to design.
- Read ~30 sample user-facing strings from JSX (button labels, headings, toast messages, empty states).
- Use them to fill:
  - `voice.md` – casing (sentence / Title / UPPER), punctuation rules (no exclamations?), length bias, ~10 verbatim sample strings.
  - `rules.md` – structural "do not break" – each rule has a **Why:** with concrete evidence.
  - `gaps.md` – missing or fragile assets: no real logo, fonts not self-hosted, icon stroke not pinned, ad-hoc hex values not in `tokens.css`.

### 2b.3 – Produce `tokens.css`

Lift values from the code source of truth. Layout:

```css
/* tokens.css – design system `<name>` */

:root {
  /* Colors */
  --<prefix>-bg: #…;
  --<prefix>-fg: #…;
  --<prefix>-primary: #…;
  /* … every color in the source of truth, prefixed with the DS name */

  /* Typography */
  --<prefix>-font-sans: "…", system-ui, sans-serif;
  --<prefix>-font-mono: "…", ui-monospace, monospace;
  --<prefix>-text-xs: 12px;
  /* … full type scale */

  /* Spacing */
  --<prefix>-space-1: 4px;
  /* … full spacing scale */

  /* Radius, shadow, motion … */
}

@media (prefers-color-scheme: dark) {
  :root { /* dark overrides present in code only */ }
}

/* Semantic base styles – only for primitives the codebase already styles
   globally (h1, p, code, .card). Never invent a class that isn't in the
   codebase. */
h1 { font: 600 var(--<prefix>-text-3xl) / 1.2 var(--<prefix>-font-sans); }
p  { color: var(--<prefix>-fg); }
code { font-family: var(--<prefix>-font-mono); }
```

Prefix every custom property with the DS name (`--lightnote-bg`, not `--bg`) so two DSes can co-exist without clashing in the shared viewer.

### 2b.4 – Multi-surface check

If Step 1 detected **more than one surface family** (e.g. `app/` and `marketing/`, or sibling branches `main` and `marketing-site`), ask via `AskUserQuestion`:

- `header: "Surfaces"`
- Options (single-select unless the user wants multiple):
  - `One DS covering all surfaces` – default; simpler.
  - `One DS per surface` – e.g. `<name>` for app, `<name>-mkt` for marketing.
  - `Skip a surface` – create for the primary only.

If the user picks "one per surface", ask a follow-up: **should the secondary DS `extends: <primary>`?** Default recommendation is yes – marketing usually inherits app tokens with a handful of overrides.

### 2b.5 – Screenshots (best-effort)

If a dev server can start and `agent-browser` or similar infra is available, capture one screenshot per route from `routes.md` into `screenshots/<route-slug>.png`. Best-effort – if the dev server won't start or tooling is missing, skip silently and add a `gaps.md` entry noting that visual source-of-truth captures are missing.

### 2b.6 – Emit preview cards

`preview/*.html` – one file per token group. Each page:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../tokens.css" />
    <title>Colors – <name></title>
  </head>
  <body>
    <!-- render every --<prefix>-color-* as a swatch with its variable name
         and hex value; pull the hex from the :root block by parsing
         tokens.css so the card stays in sync. -->
  </body>
</html>
```

Emit at minimum: `colors.html`, `type.html`, `spacing.html`, `radius.html`, `shadows.html`, `motion.html`, `components.html`. `diff.html` and `charts.html` are optional – emit if the codebase has those primitives.

### 2b.7 – Emit one playable page

Pick the most-visited real route (heuristic: entry point, dashboard, or the first route in `routes.md`) and write `pages/<slug>/01-default.html`. The page uses only DS tokens and the components from `briefing/components.md`. Add `pages/index.json` in the DS's `pages/` folder listing the page and its variants (same shape as the `design` skill's index, without `chosen`).

The playable must render the stacked states derived from the briefing evidence per `PAGES.md` – one surface showing the interesting states side-by-side (running + errored + empty, etc.), not a single happy-path state.

## Greenfield branch

Skip the codebase scan – there's nothing to scan. Ask for the depth via `AskUserQuestion`:

- `header: "Depth"`
- Options:
  - `2 min – take a known base` – pick from `../design/REFERENCES.md`. Follow-up: which one (shadcn / Material / kokonutui / Tremor / DaisyUI). Generate `tokens.css` + one token-showcase playable page. Done.
  - `10 min – base + customization` – same base pick, then three follow-up questions: accent colour, density preset (cozy/comfy/roomy), font pairing. Emit two default playable pages (one marketing-style, one app-style).
  - `30–60 min – co-design from scratch` – run a voice/rules capture before anything else:
    - **Voice**: casing (sentence / Title), length bias, tone (terse / warm / playful), punctuation (exclamations? em dashes? "–" vs "—" – open-designer's own house style is en dashes).
    - **Rules**: density, motion budget, allowed primitives (gradients yes/no, shadows yes/no, borders 1px always visible yes/no).
    - Then generate tokens, preview cards, and 3–5 playable pages picked from the template menu in `PAGES.md` (landing, dashboard, settings, modal, empty state).

In every greenfield depth, `gaps.md` records that the system is anchored to a **reference base**, not to user code – so the `design` skill knows to loosen its "extract, don't invent" rule slightly for tokens until the user has ported the DS into a real codebase.

### Greenfield `tokens.css` source

The token values come from the reference base:

- shadcn – the project's default `:root` CSS vars from `components.json` + `globals.css`.
- Material – Material 3 baseline tokens.
- kokonutui – kokonutui's token file.
- Tremor – Tremor's Tailwind preset values.
- DaisyUI – the default theme's CSS custom properties.

For "take a known base" and "base + customization", prefix with the DS name exactly the same way as brownfield. For "co-design from scratch", the user's answers dictate the prefix and values.

## `extends: <parent-ds>` support

If the user is creating a new DS that should inherit from an existing one, set `manifest.extends: "<parent-name>"`. The child's `tokens.css` only needs to declare the overrides – the parent's tokens are rendered first at load time.

Document the override surface: at the top of the child's `tokens.css`, list the parent's token names that are being overridden with a comment explaining why.

## manifest.json shape

```json
{
  "name": "lightnote-mkt",
  "description": "LightNote marketing surface",
  "extends": "lightnote",
  "createdAt": "2026-04-22T14:00:00Z",
  "updatedAt": "2026-04-22T14:00:00Z"
}
```

`shippedAt` and `shippedTo` are written only by `/design-integrate`. Do not set them here.

## After emit

One line to the user:

```
Design system `<name>` ready under .open-designer/design-systems/<name>/.
Open the viewer in Design systems mode to iterate on the playable pages and tweak tokens.
```

If this is the first DS in the project, also tell the user that `/design` now knows to reference it. If it's the second, offer to set it as default:

> Want `lightnote-mkt` to be the default design system for new designs? (writes `.open-designer/config.json`)
