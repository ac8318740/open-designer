---
name: design
description: Local design loop. Write pixel-perfect HTML designs plus variants under .open-designer/designs/, accept pasted element-selection payloads from the viewer to iterate, and consume the project's design system (tokens, voice, rules, gaps) on every iteration. Use when the user asks to design, redesign, or iterate on a page or component visually.
---

## What this skill does

A loop with three actors – Claude, a folder on disk, and a static viewer in the browser.

1. Claude reads the project's active **design system** under `.open-designer/design-systems/<ds>/` (tokens, briefing docs, playable pages) and uses it as the allow-list + voice + rules contract for every design.
2. Claude writes a pixel-perfect replica of the target page plus a few variants as standalone HTML files under `.open-designer/designs/<design-name>/`.
3. The user opens the local viewer, clicks an element, types a request, and pastes the resulting Markdown payload back into Claude Code.
4. Claude edits the target design. Repeat until the user picks a winner, then port the chosen variant into the real codebase via `/design-integrate`.

No hosted backend. No file watchers. No selection bridges. Just files and the OS clipboard.

## When to invoke

- The user says "design a …", "redesign the …", "show me variants of the …", "iterate on this layout", or anything that asks for a visual draft.
- The user pastes a Markdown block that starts with `I selected an element in design` – that is feedback from the viewer. Find the named design, apply the change, save in place.

## First-turn gate – a design system must exist

Before producing any design, list `.open-designer/design-systems/`. Three cases:

1. **No DS exists** – use `AskUserQuestion` with `header: "Design system"`:
   - `Run /design-system now (recommended)` – hand off to the design-system skill, wait for it to finish, then resume.
   - `Point at an existing one outside this repo` – the user may have a DS in a sibling repo; ask for the path and copy it in.
   - `Cancel` – stop. Designs cannot be produced without a DS.
2. **One DS exists** – use it. Record its name as the active DS for this design.
3. **Multiple DS exist** – check `.open-designer/config.json` for `defaultDesignSystem`. If set, use it (the viewer reads the same file and loads that DS first; falls back to the first DS alphabetically if unset). Otherwise ask which DS applies (`AskUserQuestion`, one option per DS plus a "cancel"). After the answer, offer: "Make `<name>` the default for new designs?" – if yes, write `config.json`.

The chosen DS name lands in the new design's `index.json` as `designSystem: "<name>"`.

## How this skill LEVERAGES the design system

The DS is not a decoration. Every draft and every edit re-reads it, and the authoring rules below enforce that tokens and voice come from the DS, not from invention.

### Per-iteration context load (mandatory)

Before writing or editing any HTML:

1. **Resolve the active DS chain.** Walk `extends:` from child to root; child wins on conflict. In memory, the chain is: parent's `tokens.css` + briefing + playable pages, then child's on top.
2. **Re-read the full briefing, in this order:**
   - `manifest.json` (name, description)
   - `tokens.css` (the runnable allow-list)
   - `briefing/voice.md` (copy rules, casing, sample strings)
   - `briefing/rules.md` (structural "do not break" – each rule has a **Why:**)
   - `briefing/gaps.md` (do NOT lean on flagged-substitution tokens or assets)
   - `briefing/components.md` + `briefing/extractable-components.md` (prefer reuse over invention)
   - `briefing/routes.md`, `briefing/layouts.md`, `briefing/theme.md` (for structural context)
3. **Skim DS `pages/*.html`.** If the user's request matches the intent of any existing playable page, treat that page as the **structural reference** for the new design's layout language.
4. **Skim `preview/components.html`** for the project's button/card/badge styling rather than inventing.

### Authoring rules (enforced by this skill on every write)

- **Use DS token names, not hex values.** A design writes `color: var(--<prefix>-fg)`, never `#0F172A`. Exception: tokens listed in `gaps.md` as "not yet expressed" – use the literal value AND add a one-line note in the draft's `<head>` flagging it for promotion later.
- **Use DS font + spacing scales by token, not by literal.** `padding: var(--<prefix>-space-4)`, not `padding: 16px`.
- **Apply `voice.md` to every string** – casing, punctuation rules, length bias, sample-string flavor for placeholders.
- **Honour `rules.md`.** Before writing card markup, check the cards rules. Before writing a destructive button, check the danger rules.
- **Avoid flagged-substitution assets.** If `gaps.md` says no real logo, use the placeholder pattern; if Geist Mono isn't available, fall back per gaps.md guidance.
- **Variants render realistic scenes, not single states or modes.** When a page has state-revealing components in the briefing (skeleton, error, empty, populated, streaming, diffed), each variant renders the interesting states simultaneously – a populated row next to a skeleton row next to an empty row – so the variant's treatment is visible across states. Derive the state set from `briefing/components.md` + `briefing/extractable-components.md` + `gaps.md`, not from a checklist. Don't produce separate files just to show state differences; that is what the `state` tweak is for (see step 8). User-selectable **runtime modes** – view mode (cards/list/tree), sidebar shown/hidden, light/dark, user-toggleable density – belong as sibling **pages**, not tweaks: production needs all of them at runtime, so they fail the finalize-discard test. Wire mode-switch controls with `data-od-page`. See `PAGES.md` worked example #6.

### Iteration from a pasted selection

When a clipboard payload arrives (it now carries the active DS name):

- If the change fits within DS tokens – apply it and tell the user which token values changed.
- If the change **needs a token the DS doesn't have** – stop and ask via `AskUserQuestion`:
  - `Use an existing DS token that's close` – pick one; apply it; note the trade-off.
  - `Hand off to /design-system to add the new token` – stop. Instruct the user to run `/design-system` with the suggested token name + value; resume after.
  - `Make the change inline as a one-off` – write the literal value, add a `<!-- TODO: promote to DS -->` comment in `<head>` so it isn't silently lost.

Never silently invent a token mid-iteration. That discipline is why open-designer stays honest.

### When the user wants to change tokens mid-design

A clipboard payload may target a DS token (e.g., "make this primary lighter"). Recognise this and offer:

- `Promote this change to the DS` – affects all designs using the DS. Best once the user is confident.
- `Override locally in this design only` – inline style in this design's HTML.
- `Make it a tweak so we can keep iterating` – default for color/spacing early in the loop.

Default recommendation is the third option (tweak) early, shifting to promotion once the user signals confidence.

## Pages vs variants

Every design has one or more **pages**; every page has one or more **variants**.

- A **page** is a distinct screen or route – the meeting log, the note detail, the settings view. Different pages render different *content structures*.
- A **variant** is an alternative **direction** the user picks ONE of and ships; the others are discarded by `finalize`. Tighter spacing as the page's default, brand-led vs ops-led emphasis, serif vs sans treatment. Variants share the page's content structure and differ in styling.

**Rule of thumb**: if clicking something in the real app would change the URL or swap the main content region (tab switch, view-mode swap, list → detail), it's a different page. If it's the same screen laid out differently as a one-time direction the designer commits to, it's a variant.

**The finalize-discard test (covers variants AND `select`/`toggle` tweaks)**: every variant past the first AND every `select`/`toggle` tweak is a designer decision. When the user finalizes, the unselected alternatives drop from the production design. Encode the reason as data, not prose: every non-first variant MUST set `discardReason` in `index.json`, and every `select`/`toggle` tweak MUST set `discardReason` too. The viewer reads these and shows them in the finalize confirmation modal. State tweaks are exempt – they're runtime conditions, not designer decisions. If you can't write a true `discardReason`, the alternatives must stay live in production – so they are pages or states, not variants and not tweaks. Wire them with `data-od-page`.

```jsonc
{
  "id": "02-amber-cta",
  "label": "Amber CTA",
  "discardReason": "production picks one CTA treatment and ships it; this is the alt direction."
}
```

See `PAGES.md` for the decision tree and worked examples.

## Producing designs

For each request:

1. Resolve the active DS chain and load the briefing (see above).
2. Trace the imports of the target page or component to load the relevant code context. Stop at framework boundaries.
3. Decide the **page set**: list the distinct screens the request covers. A single-page request is one page called e.g. `main`. A multi-page request (log + detail, tabs, wizard steps) gets one page entry per screen.
4. For each page, write `00-current.html` (pixel-perfect replica of the current state, if any) plus 2 to 4 variants as `01-*.html`, `02-*.html`, etc. Use short slug names (`01-tighter-spacing.html`, `02-amber-cta.html`). When the page has state-revealing components in the briefing, declare a `state` tweak listing those states and use selector-based hiding so the variant filters to one state at a time. The variant boots in the first listed state. See step 8.
5. Each HTML file `<link>`s the DS tokens chain. Relative path from the design file:

   ```html
   <!-- Parent DS first, then child. The viewer also injects this at load
        time using the resolved extends chain – the direct links keep each
        file openable on its own. -->
   <link rel="stylesheet" href="../../design-systems/<parent>/tokens.css" />
   <link rel="stylesheet" href="../../design-systems/<child>/tokens.css" />
   ```

   The viewer is extends-aware: when it loads a design, it walks the DS chain and injects every `tokens.css` in parent→child order into the iframe. The `<link>`s above are for file-open-in-browser compatibility.

6. **Drive the design off DS tokens and a few draft-local CSS variables.** Anything the user might want to adjust that isn't already a DS token – a density preset (cozy/comfy/roomy), whether a decorative ornament is shown, a variant knob that flips a section's layout – goes through a draft-local CSS custom property declared on `:root`. The viewer binds tweak controls directly to those variables, so live adjustment "just works". Example:

   ```html
   <style>
     :root {
       --cta-padding: 16px 36px;
       --hero-bg: var(--<prefix>-surface);
     }
     .hero-cta { background: var(--<prefix>-primary); padding: var(--cta-padding); }
     .hero     { background: var(--hero-bg); }
   </style>
   ```

   Prefer DS tokens for color and spacing; keep draft-local vars for geometry and toggle-able axes.

7. Lay the files out on disk with **one subfolder per page**:

   ```
   designs/
     meeting-notes/
       index.json
       log/
         01-default.html
         02-compact.html
       detail/
         01-default.html
   ```

   Single-page designs still use a subfolder (`main/01-default.html`) – the schema is page-first.

8. Write `.open-designer/designs/<design-name>/index.json`. Record the active DS so the viewer and integrate skill know which tokens govern this design:

   ```json
   {
     "design": "meeting-notes",
     "designSystem": "lightnote",
     "updated": "2026-04-22T15:00:00Z",
     "tweaks": [ /* design-level tweaks */ ],
     "pages": [
       {
         "id": "log",
         "label": "Meeting log",
         "tweaks": [],
         "variants": [
           {
             "id": "01-default",
             "file": "log/01-default.html",
             "label": "Default",
             "tweaks": [
               {
                 "id": "section-pad",
                 "type": "slider",
                 "label": "Section padding",
                 "target": "--section-pad",
                 "min": 32, "max": 120, "step": 4, "unit": "px",
                 "default": 72
               }
             ]
           },
           {
             "id": "02-compact",
             "file": "log/02-compact.html",
             "label": "Compact",
             "discardReason": "production ships one density default; this is the alt direction."
           }
         ]
       }
     ]
   }
   ```

   Tweak types: `slider` (min, max, step, unit), `color` (hex), `select` (options + `discardReason`), `toggle` (`on`/`off` + `discardReason`), `state` (options as strings or `{label, value}` – flips `data-state` on `:root`, use `[data-state="errored"]` selectors in CSS), `text`. Merge order at render time: design → page → variant.

   **Pick by the shape of the axis, not by habit:**
   - Continuous numeric range → `slider` (padding, radius, font size, shadow blur).
   - Open color choice → `color` (accent, surface, CTA bg).
   - Categorical preset, 3+ named options → `select` (corner style square/soft/pill, designer-chosen density default cozy/comfy/roomy where production locks the choice, any other designer-picked preset that ships as a single value). **Do NOT use `select` for runtime modes the user toggles in production**: view mode (cards/list/tree), sidebar shown/hidden, light/dark, user-toggleable density. Those fail the finalize-discard test (production needs all options live) and belong as sibling **pages**, wired with `data-od-page`. See `PAGES.md` worked example #6.
   - Binary on/off flip → `toggle` (show ornament, dark section, underline links, gradient background).
   - Categorical runtime conditions → `state` – derive from briefing for the page. Common shapes: populated/loading/empty/errored; streaming, diffed, connecting, deploying, etc. all qualify. Writes to `data-state` on `:root`. The variant boots in the first listed state and the dropdown switches between them. There is no unfiltered mode – every render shows exactly one named state. Sketch:

     ```css
     /* Each state-card declares its state; only the active one stays visible. */
     :root[data-state="populated"] [data-state-card]:not([data-state-card="populated"]) { display: none; }
     :root[data-state="loading"]   [data-state-card]:not([data-state-card="loading"])   { display: none; }
     :root[data-state="errored"]   [data-state-card]:not([data-state-card="errored"])   { display: none; }
     /* …one rule per declared state. */
     ```

     The viewer warns in the console when a `state` tweak is declared but no `[data-state=…]` selector exists.
   - Free-form string → `text` (rare).

   The `target` is the CSS variable the control writes to (ignored for `state`, which always writes `data-state`). Keep variants as separate HTML files for structural differences; use tweaks for parametric adjustments.

   `select` and `toggle` MUST set `discardReason: "<one short sentence>"` so the finalize confirmation modal can show why the un-picked options drop from production. `state` does not need one (it isn't a designer decision).

   **Legacy shape**: designs written before pages existed used a flat `drafts: []` array at the top level. The viewer still reads those, normalized to a single implicit `main` page. Do not write that shape.

9. Wire in-draft navigation. For any element a user would click to move between screens in the real app, add `data-od-page="<pageId>"`. The viewer intercepts the click and swaps the iframe to the target page.

   ```html
   <a href="#" data-od-page="detail">Team sync – Tuesday</a>
   <button data-od-page="detail">Open note</button>
   <a href="#" data-od-page="log">← Back to meetings</a>
   ```

   - `data-od-page="pageId"` → jumps to the target page's last-active (or first) variant.
   - `data-od-page="pageId:variantId"` → jumps to a specific variant.

   **Do NOT write an inline `<script>` that listens for `data-od-page` clicks and posts to `window.parent`.** The viewer auto-injects the navigation handler at iframe load. Inline duplicates fire a second message with a stale shape, double-bump the back-button history, AND swallow clicks during element-select mode (their handlers race with the picker). Other inline scripts (state observers, chevron toggles, mutation observers) are fine – just leave the `data-od-page` plumbing to the viewer.

   Wire obvious connections by default – the user should not have to ask. See `PAGES.md` for patterns (list → detail, tabs, modal open, auth flow).

10. Tell the user how to launch the viewer (from their repo root):

    ```
    npx open-designer-viewer
    ```

    Picks a free port, serves the viewer at `/` and `.open-designer/` at `/data/`, and opens the browser. Override the port with `OPEN_DESIGNER_PORT=5200 npx open-designer-viewer`. Skip auto-open with `OPEN_DESIGNER_NO_OPEN=1 npx open-designer-viewer`.

## Design-system fidelity (non-negotiable)

On every draft and every iteration:

- Re-read the DS chain's `tokens.css` + `voice.md` + `rules.md` + `gaps.md` before writing HTML.
- Use only tokens in the resolved `tokens.css`. No invented fonts. No invented colors. No new radii or shadows.
- If the request needs something the DS cannot express, stop and ask: promote to DS, use the closest existing token, or inline one-off (see the iteration-from-selection section above).

This rule is the single biggest difference between a useful design draft and a hallucinated one.

## Iterating from a pasted selection

The viewer produces two payload shapes. Both include the DS name.

**Single-element** (starts with `I selected an element in design`):

```
I selected an element in design `meeting-notes` (page `log`, variant `01-tighter-spacing`, design system `lightnote`).

Element selector: `.hero-cta`
Bounding box: 320x80 at (40, 120)

Outer HTML: …
Key computed styles: …

Active tweaks: cta-bg=#111827

My request:
Make the padding tighter and use the amber brand gradient instead.
```

**Multi-element** (starts with `I selected N elements in design`): same shape as before; includes the DS name in the lead sentence.

Payloads may include `Active tweaks: tweak-id=value, …` – treat as context, not a command.

To apply either shape:

1. Locate the named design under `.open-designer/designs/<name>/`.
2. For each element, find it by selector. If ambiguous, fall back to the outer HTML snippet.
3. Re-read the DS chain. Apply the request using only allowed tokens. If you'd need a new token, follow the mid-iteration token-gap procedure above.
4. If the change is parametric and the element already binds to a CSS variable, prefer adjusting the variable's default in `<style>:root` rather than rewriting the rule. If the change needs a new control, add a tweak entry to `index.json`.
5. Edit the design in place. Keep the rest of the file unchanged.
6. Bump the `updated` timestamp in `index.json`.
7. One line back to the user: which file, what changed. Do not repeat the prompt.

If the request needs a new variant rather than an in-place edit, write a new `NN-*.html`, add its entry to `index.json`, and copy over relevant tweaks.

## Finalizing a variant

Finalize is **per page**. Each page has its own chosen variant + chosen tweaks. A multi-page design can ship one page at a time or all at once.

The viewer's Tweaks panel has three buttons at the bottom:

- **Finalize this** – writes `chosen.pages[<activePageId>] = { variantId, tweaks }`.
- **Finalize all pages** – appears only when the design has 2+ pages. Writes `chosen.pages` for every page using each page's currently-selected variant + its current tweak values.
- **Clear chosen** – appears when the active page already has a chosen entry. Clears just that page.

```json
{
  "design": "meeting-notes",
  "designSystem": "lightnote",
  "pages": [...],
  "chosen": {
    "finalizedAt": "2026-04-22T10:00:00Z",
    "pages": {
      "log":    { "variantId": "02-compact", "tweaks": { "accent": "#7c2d12" } },
      "detail": { "variantId": "01-default", "tweaks": {} }
    }
  }
}
```

Each page's `tweaks` snapshots the merged (design + page + variant) tweak values at the moment of finalize, and overrides the defaults at integration time.

Rules when `chosen` is present:

- **Never delete the other variants** on finalize. Only delete if the user explicitly asks.
- **The chosen variant is a spec, not production code.** Port it into real components via `/design-integrate`.

### Conversational finalize

The user may also finalize in conversation ("use variant 02 for the log page"). In that case:

1. Identify which page and which variant. If ambiguous, ask.
2. Write `chosen.pages[<pageId>] = { variantId, tweaks }`.
3. For `tweaks`, use the values from the most recent viewer payload the user pasted (the `Active tweaks: …` line), if any. Otherwise ask the user to hit Finalize in the viewer so the exact adjusted values are captured.
4. Update `chosen.finalizedAt`.
5. Do not touch the other variants' files.

## Approve and ship

Once a variant is finalized, hand off to the **`design-integrate`** skill. The user invokes it with "integrate the design", "implement the chosen design", or "ship the reading-streaks design".

`design-integrate` reads `chosen` + `chosen.tweaks` + the DS chain, triages per page, detects whether spechub is available, and orchestrates the port. It never modifies `.open-designer/` (except to mark `chosen.shippedAt`, `manifest.shippedAt`, and append-only `gaps.md` entries) and never deletes drafts without explicit confirmation.

The chosen draft is a design artifact, not production code.

## Reference shelf

`REFERENCES.md` lists vetted MIT/Apache-2.0 component libraries you may consult when:

- The user explicitly asks for a particular aesthetic.
- You are working greenfield with no existing design system (rare after the gate – the gate offers `/design-system` first).

The shelf is opt-in. For existing-UI work, DS fidelity wins over any reference. Re-read the shelf's preamble – it documents sources that failed audit (Aceternity, animate-ui, prebuiltui, 21st.dev community defaults).

## Companion files

- `WORKFLOW.md` – existing-UI SOP, multi-page projects, common pitfalls.
- `PAGES.md` – page-vs-variant decision tree, navigation patterns.
- `REFERENCES.md` – vetted look-and-feel sources with licenses.
