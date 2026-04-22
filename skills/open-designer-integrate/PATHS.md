# Triage paths

Two paths. The goal is to match discipline to actual risk, not to run every design through the full pipeline.

## Scoring axes

From the three exploration agents, score each axis **low / medium / high**:

### Backend gap

| Score | What it looks like |
|---|---|
| **Low** | All data surfaces have an existing table and a matching action/endpoint |
| **Medium** | A table exists but needs a new field, or an action exists but needs a new parameter |
| **High** | New table, new schema, or new server action that doesn't exist anywhere |

### Component novelty

| Score | What it looks like |
|---|---|
| **Low** | Agent 2 found strong overlap – existing components cover most of the design |
| **Medium** | Some primitives reusable, but the main surface is a new component |
| **High** | No meaningful overlap. The design is a brand-new UI surface |

### Cross-cutting impact

| Score | What it looks like |
|---|---|
| **Low** | Scoped to one route or one component. No shared shells touched |
| **Medium** | Touches a layout shell or shared header/footer, or adds one new route |
| **High** | Touches routing, auth, global state, or the page shell in a way other features will inherit |

## Mapping

| Axis profile | Path |
|---|---|
| Any axis high | **Full pipeline** |
| All axes low, pure visual update (colors, spacing, copy only) | **Quick path** |
| All axes low or medium, scoped to one route/component | **Quick path** |
| Mostly low, one axis medium | **Quick path**, but flag the medium axis in the proposal so the user can upgrade |

## Paths

### Full pipeline

Use when backend or architectural risk is real. The pipeline writes down the problem, agrees on a design, breaks into tasks, writes tests, then implements.

With spechub:
1. `/spechub:propose` – synthesized proposal citing the design intent, cited backend gaps, and the clarification answers from Step 6.
2. `/spechub:design` – technical design informed by the chosen HTML + tweaks + init files.
3. `/spechub:implement` – runs the test-writer / task-executor / task-checker loop.

Without spechub:
- Spawn `test-writer` agent → writes failing tests encoding the new behavior.
- Spawn `task-executor` agent → implements to make tests pass.
- Spawn `task-checker` agent → verifies.

### Quick path

Use when the change is a visual update or a scoped UI swap with no backend risk. Skips proposal and design; keeps verification.

With spechub:
- `/spechub:implement-quick` with the design context bundled in.

Without spechub:
- Skip test-writing for purely visual pieces.
- `task-executor` writes the code.
- `task-checker` runs the usual verification (typecheck, lint, existing tests).
- Frontend-verifier if available.

## Examples

### Example A – full pipeline

Design: "reading-streaks counter on the dashboard".

- Backend gap: **high**. No `reading_streaks` table; no `logReadingEvent` action.
- Component novelty: **medium**. `StatsCard` exists but doesn't do streak math.
- Cross-cutting: **low**. Lands in one dashboard widget slot.

Recommendation: full pipeline, driven by the backend gap.

### Example B – quick path

Design: "amber brand refresh for hero CTA".

- Backend gap: **low**. No data changes.
- Component novelty: **low**. `HeroCTA` exists; swap colors and padding.
- Cross-cutting: **low**. One component.

Recommendation: quick path. Visual swap, small blast radius.

### Example C – quick path with flag

Design: "library modal redesign".

- Backend gap: **low**. Existing `books` query covers it.
- Component novelty: **medium**. New grid card layout.
- Cross-cutting: **low**. Modal is self-contained.

Recommendation: quick path. Flag the medium novelty so the user can upgrade to full pipeline if they want tests first.

## What NOT to do

- Don't default to full pipeline "to be safe". The user will stop using this skill if every visual tweak turns into a proposal.
- Don't default to quick path when a backend gap is hiding. Cite the missing table or endpoint explicitly in the recommendation so the user sees it.
