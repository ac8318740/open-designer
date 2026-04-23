---
name: design-system
description: Create, edit, and list design systems under .open-designer/design-systems/. A design system is a first-class artifact – real tokens.css, living briefing docs, preview cards, and playable pages – that designs consume via a designSystem reference. Use when the user asks to set up a design system, extract one from an existing codebase, add one to a greenfield project, extend an existing system, or tweak its tokens in the viewer.
---

## What this skill does

Turns the project's visual rules into a file-backed, multi-instance, viewable artifact.

A design system (DS) lives under `.open-designer/design-systems/<name>/` and owns:

- `manifest.json` – name, description, optional `extends: <parent-ds>`, timestamps.
- `tokens.css` – real CSS custom properties plus dark-mode and a small semantic base (`h1`, `p`, `code`, `.card`, …). This is the allow-list as runnable CSS, not a markdown list.
- `briefing/*.md` – living docs the `design` skill re-reads on every iteration. Covers components, layouts, routes, theme, extractable components, voice, rules, gaps.
- `preview/*.html` – standalone HTML token cards (colors, type, spacing, radius, shadows, motion, components) that link `tokens.css` directly.
- `pages/*.html` – playable pages – the DS's own mini-app. Tweakable in the viewer in DS mode; tweaks stay local until the user promotes them.
- `assets/` – logo and other static pieces the DS needs.
- `screenshots/` – brownfield only; source-UI captures per route, best-effort.

A DS may `extends: <parent-ds>`. The child's `tokens.css` is rendered **after** the parent's so child rules override (LightNote's app/marketing pattern).

Designs declare their DS in `index.json` as `designSystem: "<name>"` and `<link>` the resolved tokens.css chain instead of inlining tokens.

## When to invoke

- The user says "set up a design system", "extract the design system", "init open-designer", "create a design system for this project", or anything that asks for a DS artifact.
- The user says "edit the design system", "tweak the DS", "add a token", "promote this change to the DS".
- The user says "list design systems", "show design systems".
- The `/design` skill hands off when no DS exists (interactive gate).

## First-turn intent routing

1. List `.open-designer/design-systems/`.
2. If **no DS exists**: go straight into the create flow (see `CREATE.md`).
3. If **one or more exist**: ask the user via `AskUserQuestion` with `header: "Design system"`:

   - `Create a new one` – run the create flow, then offer to set it as default if multiple systems now exist.
   - `Edit an existing one` – run the edit flow (see `EDIT.md`). If multiple exist, follow up with a second question to pick which.
   - `List them` – print the table (see below).

The routing is a two-question ladder, not a single "what do you want to do" free-form parse. Follow the user's answer literally.

## Create flow

See `CREATE.md` for the full procedure – brownfield + greenfield + the 2/10/30 depth spectrum + the conventions sweep that produces `voice.md` / `rules.md` / `gaps.md`.

**Always emit** (minimum viable DS):

- `manifest.json`
- `tokens.css` (real CSS, lifted from source of truth; never invented)
- `briefing/*.md` (subset, accurate to source – missing sections are fine if the source doesn't support them)
- `preview/*.html` (one per token group)
- `pages/*.html` – at least one playable page, no maximum

The number of playable pages is flexible – the user can say "add a settings page" mid-flow at any point in the loop.

After emitting files, tell the user:

```
Design system `<name>` is ready. Open the viewer and switch to Design systems mode to iterate:

  npx open-designer-viewer
```

Run it from the repo root.

## Edit flow

See `EDIT.md`. Two entry points:

1. **Pasted selection payload** from the viewer while the user is in DS mode (the payload's lead line says "design system"): locate the DS, apply the edit to the playable page HTML or to `tokens.css` / `voice.md` / `rules.md`.
2. **Promote payload** from the viewer's Promote button: patch `:root` in `tokens.css` for the named target, bump `manifest.updatedAt`.

The user can also describe edits in plain conversation ("add an amber success token", "banish exclamation points from voice.md", "document the 1px-border rule") – apply them to the right file, bump `manifest.updatedAt`.

## List flow

Print a table:

```
| Name          | Description                  | Extends         | Updated              |
|---------------|------------------------------|-----------------|----------------------|
| lightnote     | LightNote app shell          | –               | 2026-04-22T14:10Z    |
| lightnote-mkt | LightNote marketing surface  | lightnote       | 2026-04-22T14:15Z    |
```

Pull rows from each `design-systems/*/manifest.json`. Sort by `updatedAt` descending.

## Hard rules (the "don't invent" posture)

These carry over from the original init contract and are the reason open-designer stays honest:

- **Never invent a token.** `tokens.css` only holds values that exist in the source (Tailwind config, `globals.css`, CSS modules, the named reference base for greenfield).
- **Never invent a rule.** `rules.md` captures rules the project already follows, backed by concrete evidence (files, commits, `DESIGN_PRINCIPLES.md` if present). If you're unsure, it goes in `gaps.md`, not `rules.md`.
- **Never invent voice.** `voice.md` sample strings are verbatim from the codebase (copy, JSX text, button labels). If none exist yet (greenfield), write the doc as "decide together" with slots the user fills.
- **`gaps.md` is the safety valve.** When a token, font, asset, or convention *looks* like a rule but isn't pinned in the code, it goes here with a one-line **Why:** so the `design` skill knows to treat it as a flagged substitution, not an allow-listed token.

If you're tempted to write something that isn't backed by source, stop and ask the user. That failure mode is the main way open-designer drifts toward hallucinated design systems.

## Companion files

- `CREATE.md` – brownfield + greenfield procedures, 2/10/30-minute depth spectrum, conventions sweep.
- `EDIT.md` – selection-payload handling, Promote handling, conversational edits.
- `CONVENTIONS.md` – how the conventions sweep reads README, `DESIGN_PRINCIPLES.md`, `globals.css` comments, sample JSX strings to populate `voice.md` / `rules.md` / `gaps.md`.
- `PAGES.md` – DS playable-page templates (landing, dashboard, settings, modal, empty state) and the flexible 1–N pages guidance.
- `../design/REFERENCES.md` – the vetted base list (shadcn / Material / kokonutui / Tremor / DaisyUI). Reused for greenfield depth choices; do not re-audit.
