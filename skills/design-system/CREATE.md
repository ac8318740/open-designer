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

`preview/*.html` – one file per token group. Each page links **only** `tokens.css`. The viewer auto-injects canonical chrome styles (layout, typography, button group, swatch grid) when rendering previews, so do **not** emit a `_preview.css` or any preview-local stylesheet – chrome is owned by open-designer, not the DS.

Emit at minimum: `colors.html`, `type.html`, `spacing.html`, `radius.html`, `shadows.html`, `motion.html`, `components.html`. `diff.html` and `charts.html` are optional – emit if the codebase has those primitives.

Preview pages serve one goal: **a designer who has never seen this DS should understand, from a single page, what the token does in a real UI – not just what value it has.** A preview that renders a number as a coloured rectangle teaches nothing. A preview that renders the same number as padding on the actual component that consumes it teaches everything.

**Audience is a designer, not a developer.** Copy on preview pages reads like a style guide, not a README. Describe tokens by *feel* ("the breathing room on either side of every page's top row") rather than by implementation ("horizontal padding on the Row primitive at `packages/ui/src/row/`"). Drop file paths, drop "primitive" / "composes" / "flex container" jargon, drop code-font references to source files. Keep component names a designer would recognise (Row, AppHeader, Toast) – just drop the path. Implementation detail belongs in `briefing/*.md`, not here.

**Tone is measured, not casual.** Avoid flourishes ("pick a winner", "nothing ships taller than reality", "heads up"), colloquialisms, and first-person asides. Plain descriptive sentences. Warning banners especially should read like a product-doc footnote, not a Slack message.

The sections below are the spine of this step. The class-hook appendix at the end is reference material, not a recipe.

#### Per-token-kind rubric

Each token family has a different authentic shape. Use this table; if the token doesn't fit one of the rows, ask which family it belongs to before improvising.

| Kind | Viz shape | Real-consumer mock required? | Anti-pattern |
|---|---|---|---|
| Colors | Swatch grid grouped by role (brand / surface / text / border / state). | No – the swatch *is* the context. | A single huge swatch with no role labels. |
| Radius | The radius applied to one bare tile **and** one real component (button, card, input). | Yes | Bare tiles only – the designer can't tell which radius the buttons use. |
| Border-width | The border applied to a real-shaped card, not a bare rectangle. | Yes (lightweight card is enough) | Freestanding rectangles whose width is `var(--token)`. |
| Spacing / padding | Render the token as **padding or gap on a mock of a named consumer** from `briefing/components.md` (e.g. Row, AppHeader, Card). If the preview has a matching density/scale slider, the slider is the comparison – do not stack a second zeroed-out copy. | Yes – mandatory | `width: calc(var(--token) * N)` on a coloured bar. The value grows; the user learns nothing. |
| Heights | The token applied as the height of a mock of the named consumer (e.g. AppHeader with nav items inside). Surface any `gaps.md` drift as a warning. | Yes | A tile whose height is the token with no context around it. |
| Type | The token applied to realistic copy of the right kind – headings for heading tokens, body copy for body tokens, captions for caption tokens. | No – the glyphs are the context. | Lorem ipsum or "the quick brown fox" regardless of what the token is for. |
| Shadows | The shadow applied to the surface the token is *intended* for (card, popover, modal). Name the intended surface in the label. The shape *and* the area it sits on must contrast – if the real surface is white and the preview card is also white, the shadow is invisible. Tint the grid background (the canvas the cards sit on) with a soft grey – ideally the DS's own canvas token (`--<prefix>-bg-canvas` or equivalent) – or, if no such token exists, give the shapes themselves a light/medium grey fill. The LLM or user can override if the DS's real cards aren't white. | Yes (surface mock, not just a bare rectangle) | An unlabelled rectangle with a shadow on grey canvas. White card on white section – invisible shadow. |
| Motion | The animation applied to a realistic in-product trigger – a toast sliding in, a modal fading in, a button press scaling. Replay button under each trigger. | Yes | A generic `.demo-box` replay stage with no product context. |
| Components | One mini route rendered from `briefing/routes.md` using cross-family tokens. | Yes | A loose grid of primitives (button, input, badge) with no layout. |

Good example – spacing, rendered on a Row:

```html
<div class="token-card" data-token="--plane-padding-page">
  <div class="name">--plane-padding-page</div>
  <div class="value"></div>
  <!-- Mock of the top Row: breathing room on either side -->
  <div class="consumer-mock row-mock" style="padding: 0 var(--plane-padding-page);">
    <span>Projects</span>
    <span>/</span>
    <span>Altas</span>
  </div>
</div>
```

Bad example (do not emit):

```html
<!-- Freestanding bar sized by the token. The user has no way to connect
     this shape to what the token does in the real UI. -->
<div class="demo" style="width: calc(var(--plane-padding-page) * 4); height: 32px; background: var(--odp-preview-accent);"></div>
```

**Scale ladders – when a DS exposes a stepped scale (the spacing scale, the type scale, a radius scale, a motion duration scale), render each step as a row in a visual ladder: the size label, a bar at that literal size, and a one-line "feels like" usage drawn from the codebase.** A table of numbers alone ("4 px", "8 px"...) doesn't teach a designer anything their calculator couldn't. The bars make the ratio palpable: 4 px is a speck, 32 px is a real gap. This applies whether the scale is authored by the DS or inherited from an underlying library (e.g. Tailwind's default 4 px scale) – if it's load-bearing for the app, render it visually.

#### Consumer-grounding rule

Before writing any preview page for **spacing, heights, motion, shadows, radius, or components**, open `briefing/components.md` and pick at least one real consumer of the token family. The preview must render a minimal mock of that consumer using the token.

If no consumer exists for a token, write the preview page but add an entry to `gaps.md` under an "untraceable tokens" heading. Do **not** fabricate a consumer.

Keep consumer mocks minimal – a Row mock is two spans in a flex container, not a rebuild of the real Row component. The mock exists to show the token doing work, not to rebuild the product.

#### Mandatory dynamic labels (`data-token` hydration)

Every numeric or textual token value rendered on a preview page must come from `getComputedStyle`, not be hard-coded. The viewer lets the user tweak tokens live – a `Roundness` slider that scales every `--<prefix>-radius-*`, a `Density` slider that scales spacing. A preview whose label says "4px" while the token is now 6px is a lie.

Canonical pattern – tag each token-demo element with `data-token="--<prefix>-whatever"`, leave its display cell (`.value`, `.demo-meta`, etc.) empty in HTML, and wire a tiny render loop that reads the live value and observes mutations on `<head>`:

```html
<div class="token-card" data-token="--plane-padding-page">
  <div class="name">--plane-padding-page</div>
  <div class="value"></div>
  <div class="consumer-mock" style="padding: 0 var(--plane-padding-page);">…</div>
</div>

<script>
  (function () {
    function render() {
      for (const el of document.querySelectorAll("[data-token]")) {
        const token = el.getAttribute("data-token");
        const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        const out = el.querySelector(".value") || el.querySelector(".demo-meta");
        if (out) out.textContent = v || "(unset)";
      }
    }
    render();
    // The viewer writes a `<style id="od-tweaks-vars">` into <head> on every
    // tweak change. Observing <head> catches both the initial insert and
    // subsequent text mutations.
    new MutationObserver(render).observe(document.head, { childList: true, subtree: true, characterData: true });
  })();
</script>
```

Purely decorative literals (section headings, explanatory prose, the token *name* itself next to a demo) stay static. Only numeric / colour values that reflect token state need this treatment.

Trim numeric noise before display – 4+ decimal places in `oklch(...)` / `rgb(...)` / `hsl(...)` read as clutter. A one-line replace is enough: `v.replace(/(-?\d*\.\d{3})\d+/g, "$1")` keeps 3 decimals max.

#### Surface `gaps.md` findings inline

For each `gaps.md` entry that names a token shown on this preview page, render a visible warning banner (`<p class="warning">⚠ …</p>`) next to the relevant demo. Page-by-page: a motion-token gap belongs in `motion.html`; a radius gap in `radius.html`. Don't dump the whole gaps file on every page.

Write the banner in the same designer tone as the rest of the page – **not** the clinical wording from `gaps.md` itself. A banner that says "`--plane-height-header` is 52px but `AppHeader` renders `h-11` (44px); flag any design relying on this token" assumes the reader already knows there's a mismatch and can parse file references. A designer reads it and asks "what does this mean?"

**What drift is:** a token's value and the component that consumes it have moved on different timelines. Someone tweaked the token without updating the code, or tweaked the code without updating the token. It's worth flagging, but it's an annotation on the token – not the main event. Keep the banner **smaller than the token demo it annotates**. A drift block that looms over its token inverts the visual hierarchy.

The banner carries three compact parts, stacked – no sprawling visual-diff block by default.

1. **Head row** – an eyebrow (`Drift`, consistent across DSes so designers recognise the pattern) next to a short status line that verdicts the token (`Token doesn't match the app`). One line.
2. **Comparison row** – both values inline with labels: `Design system: 52 px · In the app: 44 px`. **Keep every word on this row at the same font size.** Distinguish the label from the value by weight or colour, not by size. Include an explicit colon after each label and real whitespace around the separator – otherwise the label and value butt up and the eye reads them as two different fonts.
3. **Action row** – a single sentence telling the designer what to do now, plus the neutral note that either side can reconcile. Don't mandate which reconciles (`Design to 44 px until reconciled – either side can update to close the gap`).

Canonical structure (HTML is not prescriptive – style inline so the DS fixture is self-contained):

```html
<div class="drift" role="note">
  <div class="drift__head">
    <span class="drift__eyebrow">Drift</span>
    <span class="drift__status">Token doesn't match the app</span>
  </div>
  <div class="drift__values">
    <em>Design system:</em> 52 px <span class="drift__sep">·</span> <em>In the app:</em> 44 px
  </div>
  <div class="drift__action">Design to 44 px until reconciled – either side can update to close the gap.</div>
</div>
```

**Adding a visual diff is an exception, not the default.** Only add side-by-side samples (two bars, two chips, two timing dots) when the demo above doesn't already give the reader a visual reference. For a height token whose demo is a mock at that height, the mock *is* the reference – re-rendering bars underneath duplicates visual weight and pushes the drift past the size of its own token. For a colour-token drift where the preview doesn't paint both values anywhere else, two chips inside the comparison row earn their space.

**Suppress the chrome's row divider on token-cards that sit above a drift.** The viewer chrome draws a 1 px bottom border on every `.token-card` to separate rows inside a section. When a drift banner sits directly beneath a token-card, that divider reads as an extra horizontal rule between two things that belong together. Add a scoped override in the preview page's own `<style>` block:

```css
.token-card:has(+ .drift) {
  border-bottom: none;
  padding-bottom: 10px;
}
```

And keep the drift's own `margin-top` small (~8 px) so the banner reads as annotation of the token above it, not a new row.

For gaps that **aren't** drift (missing assets, accessibility gaps, ambiguous conventions with no single-source-of-truth value to compare), fall back to the simple `<p class="warning">⚠ …</p>` banner with the three-part shape: **(1) what's really happening, (2) what to do in a design, (3) a one-phrase reason**.

Bad examples (do not emit):

> ⚠ Mismatch flagged in `gaps.md`: `AppHeader` uses `h-11` (44px), not this 52px token. Designs should use 44px.

*(Dev jargon, silently mandates one reconcile path.)*

> ⚠ The design system and the app disagree: the token is 52 px, but the app's header is 44 px. Two ways to resolve this – update the token to 44 px, or update the app's header to 52 px.

*(Neutral but flat – numbers buried in prose, no status verdict, no immediate action.)*

#### Brand colour for sample shapes

The chrome uses `var(--odp-preview-accent)` for all demoed shapes. Declare the mapping **once** in the DS's `tokens.css`, inside the base `:root` block, pointing at whatever token the DS considers its canonical brand colour – usually the one shown first on the Colors page under "Brand" (e.g. `--<prefix>-brand-default` or `--<prefix>-brand-500`), not a derived semantic token buried in the "derived" section:

```css
:root {
  /* ... DS tokens ... */

  /* open-designer preview hook */
  --odp-preview-accent: var(--<prefix>-brand-default);
}
```

If the DS exposes theme variants (`[data-theme="dark"]`, etc.), redeclare `--odp-preview-accent` in each theme block if the brand colour differs per mode. If the mapping is omitted entirely, samples fall back to a neutral slate.

#### Class-hook appendix

Required class hooks (styled by the injected chrome):

- Header + sections: `.preview-header`, `.preview-section`, `.mode-toggle`.
- Colors: `.swatch-grid`, `.swatch`, `.swatch-chip`, `.swatch-meta`, `.swatch-name`, `.swatch-value`.
- Type / shadows / spacing / heights: `.token-card` with children `.name`, `.value`, and a visualization child (`.demo` for bare shapes, or a custom `.consumer-mock` for real-component mocks – style inline, the chrome leaves custom classes alone).
- Radius / border widths: `.demo-grid`, `.demo-item`, `.demo-tile` (use `class="demo-tile circle"` for the full-round pill).
- Motion: `.demo-grid`, `.demo-item`, `.demo-stage`, `.demo-box`, `.demo-label`, `.demo-meta`, `.replay` – but prefer consumer mocks (toast, modal, button) over bare `.demo-box` stages per the rubric above.
- Intro / caption paragraphs inside a section card: plain `<p>`; add `class="warning"` for the amber-tinted gap-note variant.

Minimal preview scaffold (structure only – fill in the rubric-appropriate body):

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../tokens.css" />
    <title>Spacing – <name></title>
  </head>
  <body>
    <header class="preview-header">
      <h1>Spacing</h1>
      <p>One-line source-of-truth note. Source: <code>...</code>.</p>
    </header>
    <section class="preview-section">
      <h2>Page padding</h2>
      <!-- token-card with consumer-mock per the rubric -->
    </section>
    <script>/* data-token hydration loop */</script>
  </body>
</html>
```

**Preview tweaks – `preview/index.json`.** Preview pages may carry their own tweaks so the user can explore the token scale live (drag a roundness slider, pick a new brand accent, scale page density). When authored, `preview/index.json` overrides the launcher's synthesized listing. If you emit no `preview/index.json`, every preview page becomes a zero-tweak surface – same as today.

Preview tweaks are **in-memory only** until the user either approves the current values (stored in `approvals.json`) or asks Claude to adopt them as new DS defaults. The viewer flags out-of-sync tweaks against `tokens.css` and offers a "Copy update prompt" button – the resulting prompt tells Claude to patch `tokens.css` and the relevant briefing docs (`theme.md`, `gaps.md`). Approvals let users mark a surface as "blessed as-is" without rewriting the DS.

Canonical tweak set, one per card. These are suggestions – pick the ones that fit the DS's token shape; omit cards the DS doesn't parameterize:

- `colors` – single `color` tweak targeting the DS's brand-accent token (e.g. `--<prefix>-brand-default`). Label "Brand accent".
- `radius` – single `slider` with `transform: "add"` (or `"scale"`) across all radius tokens. Label "Roundness". If the DS uses Tailwind's default scale (no custom radius tokens), skip this card's tweak.
- `spacing` – single `slider` with `transform: "scale"` across core spacing tokens. Label "Density".
- `type` – single `select` targeting the body-font token (e.g. `--<prefix>-font-body`); options are current + 1-2 alternates.
- `shadows`, `motion`, `components` – leave `tweaks: []`. These cards are preview-only today.

Shape – mirrors `pages/index.json`. `variants` is optional; when omitted, a default variant pointing at `file` is synthesized:

```json
{
  "designSystem": "<name>",
  "previews": [
    {
      "id": "radius",
      "label": "Radius",
      "file": "radius.html",
      "tweaks": [
        {
          "id": "roundness",
          "type": "slider",
          "label": "Roundness",
          "targets": ["--<prefix>-radius-sm", "--<prefix>-radius-md", "--<prefix>-radius-lg"],
          "transform": "add",
          "unit": "px",
          "min": -4, "max": 8, "step": 1, "default": 0
        }
      ]
    },
    { "id": "colors", "label": "Colors", "file": "colors.html",
      "tweaks": [{ "id": "brand", "type": "color", "label": "Brand accent", "target": "--<prefix>-brand-default" }] }
  ]
}
```

Transforms:
- `"set"` (default) – every target gets the raw tweak value.
- `"add"` – slider only; for each target, `tokens.css value + slider value + unit`.
- `"scale"` – slider only; for each target, `tokens.css value × slider value + unit`.

#### Post-emit self-check

For each `preview/*.html` you just wrote, answer yes to every question below before declaring 2b.6 done. Rewrite the preview if any answer is no. The check is cheap; re-running a DS extraction because the first pass shipped bar-as-spacing demos is not.

**Teaches the token:**

1. Would a designer who has never used this DS understand from this page **what this token does in a real UI**, not just what value it has?
2. If the token family has a real consumer in `briefing/components.md`, does the preview render a minimal mock of it? (Colors and type are exempt – see the rubric.)
3. If the page shows a stepped scale (spacing, type, radius, motion duration), is each step rendered as a visual ladder row (size + bar at literal size + "feels like") rather than as a table of numbers?

**Correctness:**

4. Is every visible token value computed at runtime (via `data-token`), not hard-coded in the HTML?
5. Do component names in the copy drop file paths and implementation taxonomy (no `packages/ui/src/...`, no "primitive", no "flex container")?

**Tone:**

6. Does every sentence read like a measured style-guide footnote, not a Slack message? No "heads up", no "pick a winner", no flourishes.

**Drift annotations (if any):**

7. Is every drift banner **smaller** than the token demo it annotates, and does it use the `.token-card:has(+ .drift)` override so no grey divider floats between the two?
8. Does the drift comparison row keep labels and values at the **same font size** (differentiating only by weight or colour), with explicit colons and whitespace around the separator?
9. Does the drift action sentence name both reconcile paths without mandating one?

### 2b.7 – Emit playable pages (2–3 normally, 1 if `routes.md` forces it)

Pick 2–3 real routes from `routes.md` that together exercise the breadth of the DS. Start with the primary surface (entry point, dashboard, or the first route), then add one or two more that pull on different token families – e.g. a list/table page plus a form/settings page plus a modal or detail surface. For each, write `pages/<slug>/01-default.html` and add the entry to `pages/index.json` (same shape as the `design` skill's index, without `chosen`).

When you emit two or more playables, link them with `data-od-page="<otherPageId>"` so the user can navigate between them inside the viewer – every playable should reach at least one sibling.

Each page uses only DS tokens and components from `briefing/components.md`. Each page must render the stacked states derived from briefing evidence per `PAGES.md` – one surface showing the interesting states side-by-side (running + errored + empty, etc.), not a single happy-path state. Each page must also meet the interactivity rubric in `PAGES.md` so the surface feels alive when the user clicks into it.

If `routes.md` only supports one meaningful surface, ship one – honest shallowness beats fabricated depth. Skip the sibling-link rule in this case. Note the reason in `gaps.md`.

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
