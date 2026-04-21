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
5. Each draft is a single self-contained HTML file – styles inline, no external assets beyond CDN-safe URLs the user already uses (e.g. existing font CDNs). Same `<head>` skeleton across drafts so the viewer can swap them.
6. Write `.open-designer/drafts/<project>/index.json`:

   ```json
   {
     "project": "library-modal",
     "updated": "2026-04-21T15:00:00Z",
     "drafts": [
       { "id": "00-current", "file": "00-current.html", "label": "Current" },
       { "id": "01-tighter", "file": "01-tighter-spacing.html", "label": "Tighter spacing" },
       { "id": "02-amber-cta", "file": "02-amber-cta.html", "label": "Amber CTA" }
     ]
   }
   ```

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

When the user pastes a block that looks like:

```
I selected an element in draft `01-tighter-spacing.html`.

Element selector: `.hero-cta`
Bounding box: 320x80 at (40, 120)

Outer HTML:
​```html
<button class="hero-cta" data-variant="primary">Book demo</button>
​```

Key computed styles:
- padding: 12px 24px
- font-family: Inter, sans-serif
- ...

My request:
Make the padding tighter and use the amber brand gradient instead.
```

Do this:

1. Locate the named draft under `.open-designer/drafts/<project>/`.
2. Find the element by selector. If the selector is ambiguous, fall back to the outer HTML snippet.
3. Re-read `.open-designer/design-system.md`. Apply the request using only allowed tokens.
4. Edit the draft in place. Keep the rest of the file unchanged.
5. Bump the `updated` timestamp in `index.json`.
6. Tell the user one line: which draft you edited and what changed. Do not repeat the prompt back.

If the request needs a new variant rather than an in-place edit, write a new `NN-*.html` and update `index.json`.

## Approve and ship

When the user picks a variant, switch out of design mode and treat the chosen HTML as a spec. Port the markup and styles into the real components. Do not leave the chosen draft as the implementation – it is a design artifact, not production code.

## Companion files

- `INIT.md` – step-by-step repo scan procedure.
- `WORKFLOW.md` – greenfield path, multi-page projects, common pitfalls.
