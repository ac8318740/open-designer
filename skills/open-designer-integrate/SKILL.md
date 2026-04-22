---
name: open-designer-integrate
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
2. If no `chosen` field exists in any design, stop and say: "Pick a variant in the viewer first (click **Finalize this** in the Tweaks panel), then re-run."
3. Read the chosen variant's HTML file (`chosen.variantId` → match to `drafts[].id` → `drafts[].file`).
4. Apply `chosen.tweaks` to the HTML:
   - For each tweak, look up its `target` CSS variable and replace the default value in `:root` with the chosen value.
   - Write the resolved HTML to a temp file (e.g. `/tmp/od-resolved-<design>-<ts>.html`). Never write inside the user's repo.
5. Remember: the resolved HTML is the **visual contract** for the rest of this run.

### 2. Quick exploration

Run three Explore subagents in parallel. See `EXPLORE.md` for the exact prompts.

- **Agent 1 – init context**: scan `.open-designer/init/*.md` and `.open-designer/design-system.md`. Report: component inventory, theme tokens, route map, layout shells.
- **Agent 2 – codebase overlap**: search the codebase for existing UI that overlaps with the chosen design. Report: components that look similar, routes that might host this, primitives safe to reuse.
- **Agent 3 – backend gap**: detect whether the design implies data or actions the codebase doesn't have yet. Report: referenced entities, likely tables/endpoints, whether they already exist.

### 3. Triage and pick a path

Score the work along three axes. See `PATHS.md` for the full matrix.

- **Backend gap** – high if the design needs new tables, server actions, or API endpoints that Agent 3 couldn't find.
- **Component novelty** – high if Agent 2 found no meaningful overlap with existing components.
- **Cross-cutting impact** – high if the change touches routing, auth, layout shells, or shared state.

Map to one of:

| Signal | Path |
|---|---|
| Any axis is high | **Full pipeline** – proposal, design, tasks, implementation |
| All axes low, scoped to one route/component, or pure visual update | **Quick path** – skip proposal/design |

### 4. Spechub awareness check

Look for any of:

- `spechub/project.yaml` in the working directory tree
- A marker that the spechub plugin is installed (e.g. `~/.claude/plugins/cache/.../spechub/`)
- The slash commands `/spechub:propose`, `/spechub:implement-quick` being available

If found → **soft integration mode**: use spechub commands. See `SPECHUB-MAP.md` for which command to call when, with ready-to-use prompts.

If absent → **self-contained mode**: orchestrate `test-writer`, `task-executor`, `task-checker` directly from this skill.

### 5. Propose to the user

Use `AskUserQuestion` with:

- **Header**: "Integration path"
- **Question**: one paragraph with the recommendation plus cited evidence (specific files, missing endpoints, missing tables).

Example:

```
Recommended: full pipeline (high backend gap – the streaks counter needs
a new `reading_streaks` table and a `logReadingEvent` server action,
neither of which exists under src/db or src/app/actions). Spechub
detected; will run /spechub:propose → /spechub:design → /spechub:implement.

1. Proceed with full pipeline (recommended)
2. Use quick path instead (skip proposal/design)
3. Show me the exploration findings first
```

Honor whatever the user picks. If they pick "show findings", dump the three Explore agents' summaries, then re-ask.

### 6. Clarification round

Always run a clarification round before executing. Use `AskUserQuestion` for each ambiguous mapping decision. Typical questions:

- Which route should this land at? (Offer the top-scoring candidates from Agent 2.)
- Should this become a new component, or extend existing `<X />`?
- The draft uses Tailwind class `text-amber-600` – should this map to the existing `--accent` token or a new one?
- The draft contains lorem-ipsum text in the product card – is that a placeholder, or should it read from the `products` table?
- Is the streak count real data from the new table, or a hard-coded number for the first cut?

Batch related questions into a single `AskUserQuestion` call when possible – one call per thematic cluster (routing, data, copy).

### 7. Execute

See `SPECHUB-MAP.md` for the exact command/prompt for each combination.

- **Full pipeline + spechub**: hand off to `/spechub:propose` with a synthesized request that bundles the resolved HTML reference, the init files, the chosen tweaks, and the answers from Step 6. Stay in the loop to feed context to `/spechub:design` and `/spechub:implement`.
- **Quick path + spechub**: invoke `/spechub:implement-quick` directly with the same bundled context.
- **Full pipeline + no spechub**: orchestrate `test-writer` → `task-executor` → `task-checker` subagents. Same discipline as spechub, just driven from this skill.
- **Quick path + no spechub**: skip test-writing for the visual portion. Use `task-executor` + `task-checker`. Frontend-verifier if available.

Feed the resolved HTML path + init files + chosen.tweaks + clarification answers into whichever executor you're using. Do NOT paste the whole HTML into the prompt – point to the path.

### 8. Verify visually

If the project is a frontend app and a dev server can be started, kick off `agent-browser` (per `spechub:browser-verify` if available, else call it directly). Navigate to the integrated route and snapshot. Compare visually against the resolved chosen HTML – same layout, same colors, same copy structure.

If the dev server can't start or the project is not frontend, report that and skip.

### 9. Mark shipped

Update the design's `index.json`:

```json
"chosen": {
  "variantId": "02-cozy",
  "tweaks": { ... },
  "finalizedAt": "2026-04-22T10:00:00Z",
  "shippedAt": "2026-04-22T14:23:00Z"
}
```

This is the ONLY write to `.open-designer/` the skill is allowed to make. Do it via the finalize POST endpoint (include `shippedAt` in the `chosen` body) so the write is atomic.

Do NOT delete drafts.

### 10. Report

End with a short report:

- **Files modified**: list the files in the codebase, not the design folder.
- **Path taken**: full pipeline vs quick path, spechub vs self-contained, and why.
- **Verification**: screenshot path if produced, else explain why skipped.
- **Cleanup offer**: one-liner like "Want me to delete the other variants now? They're at `.open-designer/drafts/<project>/`. Default: keep them."

## Companion files

- `EXPLORE.md` – the three exploration agent prompts.
- `PATHS.md` – the triage matrix with examples of each path.
- `SPECHUB-MAP.md` – spechub-vs-self-contained command mapping with ready-to-use prompts.
