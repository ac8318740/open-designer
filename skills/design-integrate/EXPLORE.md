# Exploration agents

Explore subagents run in parallel before triage. Each one returns a short, structured summary – not a dump of raw search output.

Agent 1 runs **once per design**. Agents 2 and 3 run **once per page** – each page of a multi-page design is an independent integration target and needs its own overlap and backend analysis.

Launch everything in a single Agent tool batch (1 × Agent 1 + N × Agent 2 + N × Agent 3, where N is the number of pages in `chosen.pages`).

## Agent 1 – init context (one run)

**Goal**: refresh memory of what the codebase thinks it looks like, according to the design loop's own init files.

**Prompt**:

```
Read .open-designer/init/*.md and .open-designer/design-system.md in this
repo. Produce a compact summary (under 300 words) of:

1. Component inventory – the atomic and composite components listed,
   with file paths. Prioritize ones relevant to a <design name> design.
2. Layouts and shells – how pages are wrapped.
3. Theme tokens – colors, spacing, radii, typography. Cite the source
   of truth file (Tailwind config, CSS module, etc.).
4. Route map – how routes are defined and where files for new routes go.

Also flag anything in the init files that seems stale (files referenced
that no longer exist, tokens that the code no longer uses).
```

Substitute `<design name>` with the target design's name before launching.

## Agent 2 – codebase overlap (per page)

**Goal**: find existing UI that overlaps with what this page does.

**Prompt** (one per page):

```
I am about to integrate page "<page id>" of design "<design name>"
whose resolved HTML is at <temp path for this page>. Without reading
that HTML (it is only a hint), search the codebase for existing UI
that could be reused or extended for this page.

Specifically:

1. Components whose names suggest overlap (e.g. for a "log" page:
   List*, Row*, TimelineItem*).
2. Routes / pages that already render something similar. Give the route
   path and the file backing it.
3. Primitives safe to reuse (Button, Card, Badge, etc.) – list by name
   and file path.
4. Anything that looks like a duplicate waiting to happen if we add
   this page naively.

Return a ranked list of reuse candidates (top 5) with one-line rationale
each, and a ranked list of candidate host routes (top 3) for this page.
```

## Agent 3 – backend gap (per page)

**Goal**: detect whether this page needs data or actions the codebase doesn't yet have.

**Prompt** (one per page):

```
I am about to integrate page "<page id>" of design "<design name>".
The resolved HTML is at <temp path for this page>. Skim the HTML for
data-bearing surfaces – numbers, lists, user-specific text, buttons
that imply actions.

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

In SKILL.md step 2, invoke all agents with a single Agent tool batch. Example for a two-page design (`log`, `detail`):

```
Agent(description="Init context", subagent_type="Explore", prompt=<Agent 1 prompt>)
Agent(description="Overlap – log",     subagent_type="Explore", prompt=<Agent 2 prompt, pageId=log>)
Agent(description="Overlap – detail",  subagent_type="Explore", prompt=<Agent 2 prompt, pageId=detail>)
Agent(description="Backend – log",     subagent_type="Explore", prompt=<Agent 3 prompt, pageId=log>)
Agent(description="Backend – detail",  subagent_type="Explore", prompt=<Agent 3 prompt, pageId=detail>)
```

Keep all summaries in working memory for triage (step 3) and the proposal message (step 5). Quote concrete files/tokens/tables from them when justifying the recommended path per page.
