---
name: design-integrate
description: Port a finalized open-designer variant into the codebase. Use when the user says "integrate the design", "implement the chosen design", "port this into the codebase", "ship the reading-streaks design", or otherwise asks to turn a chosen variant into real components. Triages the work into full pipeline vs quick path, harmonizes softly with spechub if present, and always asks before executing.
---

## What this skill does

Turns a finalized variant from `.open-designer/drafts/<design>/` into real components, routes, and (if needed) backend plumbing in the codebase. The skill is a dynamic dispatcher – it explores first, proposes a path, asks for approval, then executes.

It harmonizes softly with spechub: if spechub is installed it uses `/spechub:propose`, `/spechub:design`, `/spechub:implement`, or `/spechub:implement-quick`. If spechub is absent it orchestrates the same agent types (`test-writer`, `task-executor`, `task-checker`) directly.

Integration is **one design at a time**. Multi-project batch integration is out of scope.

## When to invoke

The user says any of:

- "integrate the design"
- "implement the chosen design"
- "port this into the codebase"
- "ship the `<project>` design"
- "take the chosen variant live"
- "integrate `<project>`"

If the user names a specific design (e.g. "ship reading-streaks"), use that. Otherwise pick the design under `.open-designer/drafts/` with the most recent `chosen.finalizedAt`.

## Hard constraints

- **Never modify `.open-designer/`** during integration, except to add `chosen.shippedAt` at the very end.
- **Never delete drafts** without explicit user confirmation. The default at the end of the run is to keep them.
- **Always show the path recommendation before executing.** The user's chance to override is non-negotiable.
- **Triage must be data-driven.** The recommendation must cite specific files, missing endpoints, or missing tables. No hand-wavy guesses.
- **Stay scoped to one design.** If the user asks for multi-project integration, stop and ask which one to ship first.

## Steps

### 1. Read the chosen design

1. Find the target design:
   - If the user named one, use that.
   - Otherwise scan `.open-designer/drafts/*/index.json` and pick the one with the most recent `chosen.finalizedAt`.
2. If no `chosen` exists in any design, stop and say: "Pick a variant in the viewer first (click **Finalize this** in the Tweaks panel), then re-run."
3. **A design is now a set of pages.** Read `chosen.pages` – each entry maps a page id to `{ variantId, tweaks }`. Iterate over every page present in `chosen.pages`:
   - Look up the page in the index's `pages` array by id.
   - Match `variantId` to the page's `variants[].id` and read that variant's `file`.
   - Apply the merged tweaks (design-level + page-level + the variant's declared tweaks), overriding with the chosen `tweaks` snapshot. For each tweak, replace the default value at its `target` CSS variable in the HTML's `:root`.
   - Write each resolved HTML to its own temp file: `/tmp/od-resolved-<design>-<pageId>-<ts>.html`. Never write inside the user's repo.
4. **Legacy designs** (no `chosen.pages`, only `chosen.variantId`): treat as a single implicit page `main` whose variant is `chosen.variantId`.
5. Remember: the set of resolved HTMLs is the **visual contract** for the rest of this run – one file per page.

Do **not** merge all pages into a single artifact for the executor. Keep them separate; each page is a distinct integration target.

### 2. Quick exploration

Agent 1 (init context) runs **once** – the design system is shared across pages.

**Agents 2 and 3 run per page.** Each page can have a different overlap profile and a different backend gap, so they need independent triage. Launch one Agent 2 + one Agent 3 per page, all in parallel with Agent 1 in a single Agent tool batch.

- **Agent 1 – init context** (one run): scan `.open-designer/init/*.md` and `.open-designer/design-system.md`. Report: component inventory, theme tokens, route map, layout shells.
- **Agent 2 – codebase overlap** (per page): search the codebase for existing UI that overlaps with this page's chosen design. Report: components that look similar, routes that might host this page, primitives safe to reuse.
- **Agent 3 – backend gap** (per page): detect whether this page implies data or actions the codebase doesn't yet have. Report: referenced entities, likely tables/endpoints, whether they already exist.

See `EXPLORE.md` for the exact prompts and how to template the per-page ones.

### 3. Triage and pick a path, per page

Score each page independently along the three axes. See `PATHS.md` for the full matrix.

- **Backend gap** – high if this page needs new tables, server actions, or API endpoints Agent 3 couldn't find.
- **Component novelty** – high if Agent 2 found no meaningful overlap with existing components for this page.
- **Cross-cutting impact** – high if this page touches routing, auth, layout shells, or shared state.

Map each page to one of:

| Signal | Path |
|---|---|
| Any axis is high | **Full pipeline** – proposal, design, tasks, implementation |
| All axes low, scoped to one route/component, or pure visual update | **Quick path** – skip proposal/design |

**Paths are heterogeneous across pages.** A list page may qualify for the quick path while the detail page needs full pipeline because it introduces a new table. Don't force one path on the whole design.

In the proposal (step 5), recommend one path per page and cite the evidence for each.

### 4. Spechub awareness check

Look for any of:

- `spechub/project.yaml` in the working directory tree
- A marker that the spechub plugin is installed (e.g. `~/.claude/plugins/cache/.../spechub/`)
- The slash commands `/spechub:propose`, `/spechub:implement-quick` being available

If found → **soft integration mode**: use spechub commands. See `SPECHUB-MAP.md` for which command to call when, with ready-to-use prompts.

If absent → **self-contained mode**: orchestrate `test-writer`, `task-executor`, `task-checker` directly from this skill.

### 5. Propose to the user

Use `AskUserQuestion` with:

- **Header**: "Integration plan"
- **Question**: one paragraph per page with the recommended path and cited evidence (specific files, missing endpoints, missing tables). Close with the top-level decision options.

Example (multi-page design):

```
Recommended paths per page:

• log – quick path. No backend gap (reads from existing `meetings` table
  in src/db/schema.ts). Component overlap is high (reuse ListRow,
  DayHeading from src/components/list/).

• detail – full pipeline. High backend gap – the note body needs a new
  `meeting_notes` table and a `saveMeetingNote` server action, neither
  of which exists under src/db or src/app/actions.

Spechub detected; will run /spechub:implement-quick for log, then
/spechub:propose → /spechub:design → /spechub:implement for detail.

1. Proceed with the per-page plan (recommended)
2. Use the same path for both pages – which one?
3. Show me the exploration findings first
```

Honor whatever the user picks. If they pick "show findings", dump the Explore summaries (one per page for Agent 2/3, plus the single Agent 1), then re-ask.

### 6. Clarification round

Always run a clarification round before executing. Batch related questions into a single `AskUserQuestion` call. **Ask one cluster of questions per page**, since routing/data/mapping decisions are page-specific.

Typical per-page questions:

- **Route**: which route should this page land at? (Offer the top-scoring candidates from Agent 2.) For a brand-new page, propose a path and confirm.
- **New vs existing**: should this become a new component, or extend existing `<X />`?
- **Token mapping**: the draft uses Tailwind class `text-amber-600` – should this map to the existing `--accent` token or a new one?
- **Copy**: the draft contains lorem-ipsum text in the product card – is that a placeholder, or should it read from the `products` table?
- **Data**: is the streak count real data from the new table, or a hard-coded number for the first cut?
- **Navigation mapping**: for each `data-od-link="<pageId>"` in this page's draft, what's the corresponding real-app navigation? (E.g. Next.js `<Link href="/notes/[id]">`, React Router `<Link to="/notes/...">`, or a router action.) List the `data-od-link`s present in the draft and confirm the target route for each.
- **Scrollbar**: should the viewer's default thin/overlay scrollbar behavior ship in the real app? The viewer injects `scrollbar-gutter: stable`, `scrollbar-width: thin`, and `::-webkit-scrollbar` thumb styling. If the user wants that in production, port it into the app's global stylesheet (e.g. Tailwind `@layer base` in `globals.css`) or reach for `OverlayScrollbars` for fully cross-browser overlay behavior including Firefox. (Ask once per design, not per page.)

### 7. Execute

See `SPECHUB-MAP.md` for the exact command/prompt for each combination.

Execute **page by page**, in the order the user confirmed. Pages with a full-pipeline path go first if any later page's implementation will want to link to them.

- **Full pipeline + spechub**: hand off to `/spechub:propose` with a synthesized request that bundles the page's resolved HTML reference, the init files, the chosen tweaks, and the clarification answers for that page. Stay in the loop to feed context to `/spechub:design` and `/spechub:implement`.
- **Quick path + spechub**: invoke `/spechub:implement-quick` directly with the same bundled context.
- **Full pipeline + no spechub**: orchestrate `test-writer` → `task-executor` → `task-checker` subagents.
- **Quick path + no spechub**: skip test-writing for the visual portion. Use `task-executor` + `task-checker`. Frontend-verifier if available.

For each page, feed the **resolved HTML path for that page** + init files + chosen tweaks for that page + the clarification answers (including the `data-od-link` → real-route mapping) into the executor. Do NOT paste the whole HTML into the prompt – point to the path.

When a page's executor is writing navigation elements, translate each `data-od-link="<pageId>"` in the draft into the framework's navigation primitive using the mapping confirmed in step 6. Drop the `data-od-link` attribute from the shipped code.

### 8. Verify visually

For each page that shipped to a route, if the project is a frontend app and a dev server can be started, kick off `agent-browser` (per `spechub:browser-verify` if available, else call it directly). Navigate to each integrated route and snapshot. Compare visually against the page's resolved HTML – same layout, same colors, same copy structure.

Also verify the in-draft navigation mapped correctly: click the element that was `data-od-link="<otherPage>"` and confirm it routes to the real page's route.

If the dev server can't start or the project is not frontend, report that and skip.

### 9. Mark shipped

Update the design's `index.json` once all pages are shipped:

```json
"chosen": {
  "finalizedAt": "2026-04-22T10:00:00Z",
  "shippedAt": "2026-04-22T14:23:00Z",
  "pages": {
    "log":    { "variantId": "02-compact", "tweaks": {...} },
    "detail": { "variantId": "01-default", "tweaks": {...} }
  }
}
```

This is the ONLY write to `.open-designer/` the skill is allowed to make. POST the whole `chosen` object (with `shippedAt` added) to the finalize endpoint so the write is atomic.

Do NOT delete drafts.

### 10. Report

End with a short report:

- **Pages shipped**: each page, its target route, and whether it took the full or quick path.
- **Files modified**: list the files in the codebase, not the design folder.
- **Verification**: screenshot path per page if produced, else explain why skipped.
- **Cleanup offer**: one-liner like "Want me to delete the other variants now? They're at `.open-designer/drafts/<project>/`. Default: keep them."

## Companion files

- `EXPLORE.md` – the three exploration agent prompts.
- `PATHS.md` – the triage matrix with examples of each path.
- `SPECHUB-MAP.md` – spechub-vs-self-contained command mapping with ready-to-use prompts.
