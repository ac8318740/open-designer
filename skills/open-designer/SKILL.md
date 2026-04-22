---
name: open-designer
description: Local design loop. Scan the repo for UI context, write pixel-perfect HTML drafts plus variants under .open-designer/drafts/, and accept pasted element-selection payloads from the viewer to iterate. Use when the user asks to design, redesign, or iterate on a page or component visually.
---

## What this skill does

A loop with three actors – Claude, a folder on disk, and a static viewer in the browser.

1. Claude scans the repo once per project to capture the design system, components, and routes.
2. Claude writes a pixel-perfect replica of the target page plus a few variants as standalone HTML files under `.open-designer/drafts/<project>/`.
3. The user opens the local viewer, clicks an element, types a request, and pastes the resulting Markdown payload back into Claude Code.
4. Claude edits the target draft. Repeat until the user picks a winner, then port the chosen variant into the real codebase.

No hosted backend. No file watchers. No selection bridges. Just files and the OS clipboard.

## When to invoke

- The user says "design a …", "redesign the …", "show me variants of the …", "iterate on this layout", or anything that asks for a visual draft.
- The user pastes a Markdown block that starts with `I selected an element in draft` – that is feedback from the viewer. Find the named draft, apply the change, save in place.

## First-use init

If `.open-designer/init/` does not exist for the current repo, run init before producing any draft. See `INIT.md` for the full procedure. Output six files into `.open-designer/init/`:

- `components.md` – atomic and composite components actually used in the app, with file paths.
- `layouts.md` – shells, grids, page wrappers.
- `routes.md` – route map with the file backing each route.
- `theme.md` – tokens (colors, spacing, radii, typography). Pull from the source of truth (Tailwind config, CSS variables, theme module). Do not invent.
- `pages.md` – one-line summary of each user-facing page.
- `extractable-components.md` – patterns that look like components but live inline. Candidates for future extraction.

Also write `.open-designer/design-system.md`. This file is the fidelity contract – the only allowed source of fonts, colors, radii, spacing, shadows, motion. Pull every token from `theme.md`. Do not list anything that is not already in the codebase.

If the repo has no UI yet (greenfield), see `WORKFLOW.md` for the greenfield path.

## Producing drafts

For each design request:

1. Read `.open-designer/init/*.md` and `.open-designer/design-system.md`.
2. Trace the imports of the target page or component to load the relevant context. Stop at framework boundaries.
3. Write `00-current.html` – a pixel-perfect replica of the current state. This anchors the loop. If there is no current state, skip this file and start at `01-`.
4. Write 2 to 4 variants as `01-*.html`, `02-*.html`, etc. Use short slug names (`01-tighter-spacing.html`, `02-amber-cta.html`).
5. Each draft is a single self-contained HTML file. Styles inline, no external assets beyond CDN-safe URLs the user already uses. Same `<head>` skeleton across drafts so the viewer can swap them. The viewer injects `html, body { min-height: 100vh }` at load time, so the body's background colour always fills the frame regardless of content height – do not rely on a short body.
6. **Drive the design off CSS variables.** Anything you expect the user might want to adjust – colors, spacing, radii, font sizes, shadow depth, a variant knob that flips a section's layout – goes through a CSS custom property declared on `:root`. The viewer binds tweak controls directly to those variables, so live adjustment "just works" when the draft is built this way. Example:

   ```html
   <style>
     :root {
       --cta-bg: #111827;
       --cta-padding: 16px 36px;
       --hero-bg: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%);
     }
     .hero-cta { background: var(--cta-bg); padding: var(--cta-padding); }
     .hero { background: var(--hero-bg); }
   </style>
   ```

7. Write `.open-designer/drafts/<project>/index.json`. Each draft may declare `tweaks` – typed controls the user can adjust in the viewer. Project-level `tweaks` apply to every variant.

   ```json
   {
     "project": "library-modal",
     "updated": "2026-04-21T15:00:00Z",
     "tweaks": [
       {
         "id": "section-pad",
         "type": "slider",
         "label": "Section padding",
         "target": "--section-pad",
         "min": 32, "max": 120, "step": 4, "unit": "px",
         "default": 72
       }
     ],
     "drafts": [
       {
         "id": "01-tighter",
         "file": "01-tighter-spacing.html",
         "label": "Tighter spacing",
         "tweaks": [
           {
             "id": "cta-bg",
             "type": "color",
             "label": "CTA background",
             "target": "--cta-bg",
             "default": "#111827"
           },
           {
             "id": "hero-bg",
             "type": "select",
             "label": "Hero background",
             "target": "--hero-bg",
             "options": [
               { "label": "Solid", "value": "#0f172a" },
               { "label": "Gradient", "value": "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)" }
             ],
             "default": "#0f172a"
           }
         ]
       }
     ]
   }
   ```

   Tweak types: `slider` (min, max, step, unit), `color` (hex), `select` (options as strings or `{label, value}`), `toggle` (`on`/`off` values), `text`.

   The `target` is the CSS variable the control writes to. Keep variants as separate HTML files for structural differences; use tweaks for parametric adjustments.

7. Tell the user how to launch the viewer:

   ```
   node plugins/open-designer/launcher/serve.mjs
   ```

   The launcher serves the viewer at `/` and `.open-designer/` at `/data/`, picks a free port, and opens the browser.

## Design-system fidelity (non-negotiable)

On every draft and every iteration:

- Re-read `.open-designer/design-system.md` before writing HTML.
- Use only the tokens listed there. No invented fonts. No invented colors. No new radii or shadows.
- If the request needs a token that does not exist, stop and ask the user whether to extend the design system first.

This rule is the single biggest difference between a useful design draft and a hallucinated one.

## Iterating from a pasted selection

The viewer produces two payload shapes. Recognize both.

**Single-element** (starts with `I selected an element in draft`):

```
I selected an element in draft `01-tighter-spacing.html` (project `library-modal`).

Element selector: `.hero-cta`
Bounding box: 320x80 at (40, 120)

Outer HTML: …
Key computed styles: …

My request:
Make the padding tighter and use the amber brand gradient instead.
```

**Multi-element** (starts with `I selected N elements in draft`):

```
I selected 3 elements in draft `01-tighter-spacing.html` (project `library-modal`).

Shared request:
Tighten the hero – less padding on both the CTA and the feature cards, and raise the h1 weight.

Elements:

1. `[data-testid="hero-cta"]`
   Bounding box: …
   Outer HTML: …
   Key computed styles: …

2. `article.feature:nth-of-type(1)`
   …

3. `h1[data-testid="hero-title"]`
   …
```

Payloads may also include `Active tweaks: tweak-id=value, …` – the tweak state at the time of selection. Treat it as context, not a command.

To apply either shape:

1. Locate the named draft under `.open-designer/drafts/<project>/`.
2. For each element in the payload, find it by selector. If ambiguous, fall back to the outer HTML snippet.
3. Re-read `.open-designer/design-system.md`. Apply the shared request to every selected element (or the single request to the single element), using only allowed tokens.
4. If the change is parametric and the element already binds to a CSS variable, prefer adjusting the variable's default in `<style>:root` rather than rewriting the rule. If the change needs a new control, add a tweak entry to `index.json` for this draft.
5. Edit the draft in place. Keep the rest of the file unchanged.
6. Bump the `updated` timestamp in `index.json`.
7. Tell the user one line: which draft you edited and what changed. Do not repeat the prompt back.

If the request needs a new variant rather than an in-place edit, write a new `NN-*.html`, add its `drafts` entry to `index.json`, and copy over relevant tweaks.

## Finalizing a variant

The viewer has a **Finalize this** button at the bottom of the Tweaks panel. Clicking it writes a `chosen` block into the design's `index.json`:

```json
{
  "project": "reading-streaks",
  "drafts": [...],
  "chosen": {
    "variantId": "02-cozy",
    "tweaks": { "cta-bg": "#7c2d12", "section-pad": "96" },
    "finalizedAt": "2026-04-22T10:00:00Z"
  }
}
```

`chosen.tweaks` snapshots the user's tweak values at the moment of finalize and overrides the variant's declared defaults at integration time. The button re-reads as "Re-finalize with current tweaks" once a chosen exists; a separate "Clear chosen" button reverts the decision.

Rules when `chosen` is present:

- **Never delete the other variants** on finalize. They stay in place. Only delete drafts if the user explicitly asks.
- **The chosen variant is a spec, not production code.** Port it into real components; do not leave the draft in place.

### Conversational finalize

The user may also finalize in conversation ("use variant 02", "go with the cozy one"). In that case:

1. Write `chosen.variantId` to the design's `index.json`.
2. For `chosen.tweaks`, use the tweak values from the most recent viewer payload the user pasted (the `Active tweaks: …` line), if any. Otherwise ask the user to open the viewer and hit Finalize so the exact adjusted values are captured – or explicitly confirm that variant defaults are fine.
3. Set `finalizedAt` to the current ISO timestamp.
4. Do not touch the other variants' files.

## Approve and ship

Once a variant is finalized, hand off to the **`open-designer-integrate`** skill to port it into the codebase. The user can invoke it with phrases like "integrate the design", "implement the chosen design", or "ship the reading-streaks design".

The integration skill reads `chosen` + `chosen.tweaks`, triages whether the work needs a full pipeline or a quick path, detects whether spechub is available, and orchestrates the port. It never modifies `.open-designer/` (except to mark `chosen.shippedAt`) and never deletes drafts without explicit confirmation.

The chosen draft is a design artifact, not production code – do not leave it as the implementation.

## Reference shelf

`REFERENCES.md` lists vetted MIT/Apache-2.0 component libraries you may
consult when:

- The user explicitly asks for a particular aesthetic ("make it feel
  like shadcn", "use a Magic UI animation").
- You are working greenfield with no existing design system.

The shelf is opt-in. For existing-UI work, fidelity to
`.open-designer/design-system.md` always wins over any reference.
Re-read the shelf's preamble before pulling from it – it documents
which sources have failed audit (Aceternity, animate-ui, prebuiltui,
21st.dev community defaults) so you do not vendor them by mistake.

## Companion files

- `INIT.md` – step-by-step repo scan procedure.
- `WORKFLOW.md` – greenfield path, multi-page projects, common pitfalls.
- `REFERENCES.md` – vetted look-and-feel sources with licenses.
