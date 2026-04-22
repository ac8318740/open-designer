# Exploration agents

Explore subagents run in parallel before triage. Each one returns a short, structured summary – not a dump of raw search output.

Agent 1 runs **once per integration** (the DS bundle is shared). Agents 2 and 3 run **once per page**.

Launch everything in a single Agent tool batch (1 × Agent 1 + N × Agent 2 + N × Agent 3, where N is the number of pages in `chosen.pages`).

**All agents read from the resolved bundle at `/tmp/od-resolved-<design>-<ts>/`** – not from the raw `.open-designer/` folders. The bundle is already extends-resolved and tweak-applied, so every agent sees the same, concrete view.

## Agent 1 – DS context (one run)

**Goal**: refresh memory of what the DS says the codebase should look like.

**Prompt**:

```
Read the resolved design-system bundle at <bundle path>. Produce a
compact summary (under 400 words) of:

1. Token inventory (by name – not value). List colors, typography scale,
   spacing scale, radii, shadows, motion. If this DS extends a parent,
   note which tokens were overridden by the child (the bundle's
   tokens.css is already flattened; extended-from tags are in the
   briefing files).
2. Voice rules from voice.md – casing, punctuation, tone, forbidden
   patterns (e.g. no exclamations). List the rules tagged by DS.
3. Structural rules from rules.md – the "do not break" list. List each
   rule with its **Why:** line verbatim.
4. Gaps from gaps.md – fragile substitutions and missing assets. Include
   the one-line **How to apply:** for each.
5. Component inventory – the components listed in briefing/components.md,
   with file paths. Prioritize ones relevant to a <design name> design.
6. Layouts, shells, and routes from the other briefing files – just the
   ones relevant to <design name>.

Also flag anything in the bundle that seems stale (files referenced
that no longer exist, tokens that the code no longer uses).
```

Substitute `<design name>` and `<bundle path>` before launching.

## Agent 2 – codebase overlap (per page)

**Goal**: find existing UI that overlaps with what this page does, and cross-reference DS components against actual codebase components.

**Prompt** (one per page):

```
I am about to integrate page "<page id>" of design "<design name>".

Resolved design HTML: <bundle>/resolved/<page id>.html
Matched DS playable page (how the DS expresses this layout language):
  <bundle>/pages/<page id>.html  (may be absent – skip if missing)
DS component inventory: <bundle>/components.md

Without deep-reading the HTML (it is only a hint), search the codebase
for existing UI that could be reused or extended for this page.

Specifically:

1. Cross-reference every component in <bundle>/components.md against the
   actual codebase. For each row in components.md, confirm it still
   exists at the cited file path. Flag any that moved or were deleted.
2. Map the design's visible primitives (buttons, cards, inputs, badges)
   to the existing codebase components. Example: "the design's primary
   button matches briefing/preview/components.html#primary → reuse
   src/components/ui/button.tsx with variant='primary'."
3. Routes / pages that already render something similar. Give the route
   path and the file backing it.
4. Anything that looks like a duplicate waiting to happen if we add
   this page naively.

Return:
- A ranked list of reuse candidates (top 5) with one-line rationale each,
  and the DS component they match.
- A ranked list of candidate host routes (top 3) for this page.
- A short "cross-reference" list – DS component → codebase file, with
  any discrepancies flagged.
```

## Agent 3 – backend gap (per page)

**Goal**: detect whether this page needs data or actions the codebase doesn't yet have.

**Prompt** (one per page):

```
I am about to integrate page "<page id>" of design "<design name>".

Resolved design HTML: <bundle>/resolved/<page id>.html
DS route context: <bundle>/routes.md  (describes existing routes and
what users do there – useful for inferring existing endpoints/tables)

Skim the HTML for data-bearing surfaces – numbers, lists, user-specific
text, buttons that imply actions. Use routes.md to infer what endpoints
or tables likely already exist for similar surfaces.

Then search the codebase for:

1. Tables or schemas that would back each data surface. Cite the file
   (prisma schema, drizzle schema, SQL migration, etc.). If a relevant
   table exists, say so. If not, flag the gap.
2. API endpoints / server actions / route handlers that would produce
   or mutate this data. Cite the file.
3. Existing state stores (zustand, redux, context) that might already
   hold related state.

Return a table:

| Data surface in page | Existing support | Gap? |
|---|---|---|

Plus a one-line verdict: high/medium/low backend gap, with the
specific missing pieces named.
```

## Wiring

In SKILL.md Stage 2 Step 2, invoke all agents with a single Agent tool batch. Example for a two-page design (`log`, `detail`):

```
Agent(description="DS context",        subagent_type="Explore", prompt=<Agent 1 prompt>)
Agent(description="Overlap – log",     subagent_type="Explore", prompt=<Agent 2 prompt, pageId=log>)
Agent(description="Overlap – detail",  subagent_type="Explore", prompt=<Agent 2 prompt, pageId=detail>)
Agent(description="Backend – log",     subagent_type="Explore", prompt=<Agent 3 prompt, pageId=log>)
Agent(description="Backend – detail",  subagent_type="Explore", prompt=<Agent 3 prompt, pageId=detail>)
```

Keep all summaries in working memory for triage (Step 3) and the proposal message (Step 5). Quote concrete files/tokens/tables from them when justifying the recommended path per page.
