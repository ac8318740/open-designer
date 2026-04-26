---
name: design-integrate
description: Port a finalized open-designer design into the codebase. Use when the user says "integrate the design", "implement the chosen design", "port this into the codebase", "ship the reading-streaks design", or otherwise asks to turn a chosen variant into real components. Integration is two-stage – ship the design system into the codebase first (once per DS), then ship designs against it. Triages per-page, harmonizes softly with spechub if present, and always asks before executing.
---

## What this skill does

Turns a finalized design from `.open-designer/designs/<name>/` into real components, routes, and (if needed) backend plumbing in the codebase. Integration has two stages:

- **Stage 1 – ship the DS.** The first time a design system lands in a codebase, port its tokens, voice, rules, assets, and fonts. This happens once per DS; subsequent designs against the same DS skip straight to Stage 2.
- **Stage 2 – ship the design.** Per-page triage and execution, the same loop as before but now operating against a codebase that already owns the DS's tokens and rules.

The skill is a dynamic dispatcher – it resolves the DS context, explores, proposes a path, asks for approval, then executes.

It harmonizes softly with spechub: if spechub is installed it uses `/spechub:propose`, `/spechub:design`, `/spechub:implement`, or `/spechub:implement-quick`. If spechub is absent it orchestrates the same agent types (`test-writer`, `task-executor`, `task-checker`) directly.

Integration is **one design at a time**.

## When to invoke

The user says any of:

- "integrate the design"
- "implement the chosen design"
- "port this into the codebase"
- "ship the `<design>` design"
- "take the chosen variant live"

If the user names a specific design, use that. Otherwise pick the design under `.open-designer/designs/` with the most recent `chosen.finalizedAt`.

## Hard constraints

- **Never modify `.open-designer/designs/<name>/`** during integration, except to add `chosen.shippedAt` at the very end.
- **Never modify `.open-designer/design-systems/<ds>/`** during integration, except:
  - `manifest.shippedAt` + `manifest.shippedTo` after Stage 1.
  - Append-only `briefing/gaps.md` entries when a real gap is discovered during integration.
- **Never delete drafts** without explicit user confirmation.
- **Always show the path recommendation before executing.**
- **Triage must be data-driven.** The recommendation must cite specific files, missing endpoints, or missing tables.
- **Stay scoped to one design.**

## Steps

### Stage 0 – Resolve the DS context

Run on every integration, before any exploration agents fire.

1. Read `designs/<name>/index.json`. Pull `designSystem: <ds-name>` and `chosen.pages`. Legacy designs without a `designSystem` field: ask the user which DS governs this design.
2. Walk the `extends:` chain from leaf to root in `.open-designer/design-systems/`. Build a single **resolved DS bundle** in memory:
   - **Resolved `tokens.css`** – concatenate parent → child (child rules win at `:root`).
   - **Merged `briefing/voice.md`, `briefing/rules.md`, `briefing/gaps.md`** – child overrides parent on rule conflicts; voice/gaps are union with a "from <DS>" tag per entry.
   - **`briefing/components.md`, `briefing/routes.md`, `briefing/layouts.md`, `briefing/theme.md`** from each level, tagged by DS.
   - **`pages/*.html`** matched against the design's chosen pages (best-effort filename or intent match) – one match per design page.
3. Write the bundle to `/tmp/od-resolved-<design>-<ts>/` so subagents read by path, not by paste:

   ```
   /tmp/od-resolved-<design>-<ts>/
     tokens.css
     voice.md    rules.md    gaps.md
     components.md   routes.md   layouts.md   theme.md
     pages/<pageId>.html      ← matched playable page, per design page
     resolved/<pageId>.html   ← the design's chosen variant, tweaks applied
   ```

4. **Multi-DS detection.** If the DS has a `shippedTo` that points to a codebase folder, and that folder does not match the current integration target, stop and ask via `AskUserQuestion`:
   - `This is a new surface – ship the DS to a different folder` – default.
   - `Migrate the codebase to this DS` – only if the user really wants to replace.
   - `Cancel`.

   The most common case is the first – e.g. marketing DS ships to `marketing/`, app DS to `app/`. Don't assume.

### Stage 1 – Ship the DS (once per DS)

If `manifest.shippedAt` is absent or `shippedTo` is missing, run Stage 1 before any per-design work. Otherwise skip to Stage 2.

Use `AskUserQuestion` to confirm Stage 1 should run. Then run a clarification round specifically for porting the DS:

- **Where does `tokens.css` land?** Suggest a location inferred from the codebase:
  - Next.js / Tailwind – merge into `globals.css`, or into `src/styles/tokens.css` imported from `globals.css`.
  - Vite + plain CSS – `src/styles/tokens.css`.
  - Component library using CSS-in-JS – ask; this may need a Tailwind preset or a theme module.
- **Font setup.** `gaps.md` lists font substitutions and self-host needs. Confirm the framework's font-loading mechanism (`next/font`, `@font-face` + `woff2`, link tags). Wire accordingly.
- **Voice + rules destination.** Where should `voice.md` + `rules.md` content live in the project's docs? Suggest `THEME.md`, `docs/design-system.md`, or append to an existing `DESIGN_PRINCIPLES.md`.
- **Icon library.** If `rules.md` pins an icon library (e.g., Lucide), confirm the dep is installed; if not, offer to add it.
- **Asset placement.** `assets/` ports to the project's static asset folder (`public/`, `src/assets/`, etc.).

Execute Stage 1 with the full resolved bundle + the clarification answers as input to the executor (same spechub/no-spechub split as Stage 2 below, but tuned: test-writer is typically unnecessary for a DS port – no new behavior, only tokens + docs).

After Stage 1 succeeds:

- Write `manifest.shippedAt = <now ISO>` and `manifest.shippedTo = <absolute path to project>` to the DS's `manifest.json`. These are the only DS writes this skill is allowed to make.

### Stage 2 – Ship the design

Per-page triage and execution. The design's chosen variants + tweaks are the spec; the DS bundle already lives in the codebase after Stage 1.

#### Step 1 – Read the chosen design

1. Find the target design. If the user named one, use that. Otherwise scan `.open-designer/designs/*/index.json` and pick the most recent `chosen.finalizedAt`.
2. If no `chosen` exists, stop and say: "Pick a variant in the viewer first (click **Finalize this** in the Tweaks panel), then re-run."
3. Read `chosen.pages` – each entry maps a page id to `{ variantId, tweaks, state? }`. For each page:
   - Look up the page in `pages` by id.
   - Match `variantId` to the page's `variants[].id` and read that variant's `file`.
   - Apply the merged tweaks (design-level + page-level + variant-declared), overriding with the chosen `tweaks` snapshot. For each tweak, replace the default at its `target` CSS variable in the HTML's `:root`.
   - **Do NOT bake `state` values into `:root` overrides.** State entries are runtime conditions (loading/empty/errored/streaming/etc.) that the production component must dispatch on, not designer decisions. If the chosen page has any `state` entries, surface a clarification question to the user via `AskUserQuestion`: *"This page has a `state` tweak with options X. Wire the production component to dispatch on the API state machine. Confirm or describe the dispatch."* Use the answer in the executor brief.
   - Write the resolved HTML to `/tmp/od-resolved-<design>-<ts>/resolved/<pageId>.html`.
4. **Legacy designs** (no `chosen.pages`, only `chosen.variantId`): treat as a single implicit page `main`.

#### Step 2 – Quick exploration

Agent 1 (DS context) runs **once** per integration.

**Agents 2 and 3 run per page.** Launch one Agent 2 + one Agent 3 per page, all in parallel with Agent 1 in a single Agent tool batch.

- **Agent 1 – DS context** (one run). Reads the resolved bundle from `/tmp/od-resolved-<design>-<ts>/`. Reports: tokens by name (not value), voice rules, structural rules, gaps to avoid.
- **Agent 2 – codebase overlap** (per page). Cross-references DS `briefing/components.md` against actual codebase components. Reports: "design uses a button matching `preview/components.html#primary` → reuse `src/components/ui/button.tsx`."
- **Agent 3 – backend gap** (per page). Uses DS `briefing/routes.md` to better infer existing endpoints/tables.

See `EXPLORE.md` for prompt text.

#### Step 3 – Triage per page

Score each page independently along the three axes. See `PATHS.md`.

- **Backend gap** – high if this page needs new tables / actions / endpoints Agent 3 couldn't find.
- **Component novelty** – high if Agent 2 found no meaningful overlap.
- **Cross-cutting impact** – high if this page touches routing, auth, layout shells, or shared state.

Map each page to **full pipeline** or **quick path**. Paths are heterogeneous across pages – don't force one path on the whole design.

#### Step 4 – Spechub awareness check

Look for `spechub/project.yaml`, the `/spechub:*` slash commands, or the plugin cache. If found → soft integration mode. See `SPECHUB-MAP.md`.

#### Step 5 – Propose to the user

Use `AskUserQuestion` with one paragraph per page, citing concrete evidence (files, missing endpoints, missing tables). Close with the decision options.

If the user picks "show findings", dump the Explore summaries (one per page for Agent 2/3, plus the single Agent 1), then re-ask.

#### Step 6 – Clarification round

Always run clarification before executing. Batch related questions into a single `AskUserQuestion` call. Ask one cluster per page.

Typical per-page questions:

- **Route**: which route should this page land at?
- **New vs existing**: new component or extend existing `<X />`?
- **Token mapping**: the draft uses `--<prefix>-amber-500` – confirm this maps to the codebase's current token after Stage 1.
- **Copy**: lorem-ipsum placeholder or real data?
- **Data**: real data from a new table, or hard-coded for first cut?
- **Navigation mapping**: for each `data-od-page="<pageId>"` in this page's draft, what's the real-app equivalent? (Next.js `<Link>`, React Router `<Link>`, router action.) List them and confirm.
- **Scrollbar** (ask once per design, not per page): should the viewer's thin/overlay scrollbar ship in the real app?

#### Step 7 – Execute per page

See `SPECHUB-MAP.md`. Execute page by page, in the order the user confirmed.

For each page, feed the executor:

- **Resolved DS bundle path** – `/tmp/od-resolved-<design>-<ts>/`.
- **Resolved page HTML path** – `resolved/<pageId>.html`.
- **Matched DS playable page path** – `pages/<pageId>.html` (so the executor can see how the DS expresses the layout language).
- **Clarification answers for this page** – route, copy, data, navigation mapping.

**Executor authoring rules** (mirror the `/design` rules so ported code stays honest):

- Use the project's tokens by name, never reintroduce hex literals.
- Apply `voice.md` to every string – use `rules.md` as a checklist before any heading / button / error label.
- Reuse components Agent 2 identified before creating new ones.
- Honour structural rules from `rules.md` (cards brighter than canvas, 1px borders always visible, etc.).
- Drop `data-od-page` attributes from shipped code; replace with the framework's nav primitive per the clarification answers.

Do NOT paste the whole HTML into the prompt. Point to paths.

#### Step 8 – Verify (extended)

`agent-browser` snapshot per route **plus a rules-lint pass**:

- Compare each shipped surface against `rules.md`. Flag obvious violations (gradient where rules forbid; emoji in chrome where banned; second accent hue where rule says one).
- Report any `voice.md` violations in shipped strings (Title Case where sentence case is required, etc.).

These are warnings, not failures – the user decides whether to fix.

#### Step 9 – Feedback loop into the DS

If integration discovered a real gap, **append-only** write a `briefing/gaps.md` entry on the DS. Example: "no `--<prefix>-tag-bg` token – ad-hoc value used in `src/components/tag.tsx`; consider promoting." Do not rewrite `gaps.md`; only append. This is the only DS write Stage 2 is allowed to make.

#### Step 10 – Mark shipped

Stamp `chosen.shippedAt` via the launcher's finalize endpoint:

```
POST /data/designs/<name>/finalize
{ "markShipped": "<ISO timestamp>" }
```

The launcher writes the timestamp atomically and returns the updated chosen block. This is the ONLY write to `designs/<name>/` this skill is allowed to make.

Do NOT delete drafts.

#### Step 11 – Report

End with a short report:

- **DS shipped** (if Stage 1 ran): where tokens.css landed, font setup, doc location.
- **Pages shipped**: each page, its target route, full or quick path.
- **Files modified**: in the codebase, not the design folder.
- **Verification**: screenshots if produced, rules-lint warnings if any.
- **Gaps appended** (if any): the specific `gaps.md` entries you added.
- **Cleanup offer**: "Want me to delete the other variants now? They're at `.open-designer/designs/<name>/`. Default: keep them."

## Companion files

- `EXPLORE.md` – the three exploration agent prompts (updated for DS bundle).
- `PATHS.md` – the triage matrix with examples of each path.
- `SPECHUB-MAP.md` – spechub-vs-self-contained command mapping.
