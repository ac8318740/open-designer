# Conventions sweep

Populates `briefing/voice.md`, `briefing/rules.md`, and `briefing/gaps.md` from the evidence in the codebase.

The sweep is mechanical – you read specific inputs and write specific outputs. Do not invent rules or voice conventions that don't have a concrete source in the project.

## Inputs

Read (in this order, stop if a file is absent):

1. `README.md` – project-level tone, target user, example phrasing.
2. `DESIGN_PRINCIPLES.md` if present – usually the richest source of rules.
3. `CLAUDE.md` – often has house writing-standards (the parent repo here pins "en dashes only"; LightNote pins its own; most projects have something).
4. Comment headers at the top of `globals.css`, `src/styles/*.css`, or the Tailwind config – often calls out intentional choices (dark mode, density, "cards lighter than canvas").
5. Any `THEME.md`, `STYLE.md`, `BRAND.md`, `TONE.md`.
6. Commit messages that mention "design", "theme", "color" to catch deliberate changes and their reasons.
7. ~30 sample user-facing strings from JSX / TSX (button labels, headings, toast text, empty states, error messages). Spread across routes – don't sample only the landing page.

## Output: `voice.md`

Sections, all optional – include only those supported by evidence:

- **Casing** – sentence / Title / UPPER. Cite 3 examples.
- **Punctuation** – exclamations yes/no, em vs en dashes, Oxford comma.
- **Length bias** – terse, medium, verbose. Cite a sample.
- **Voice** – warm / neutral / technical / playful.
- **Sample strings (verbatim)** – ~10 actual strings from the code, with their source file. No invented examples.

Format:

```markdown
# Voice

Stack: <one-line header from Step 1>

## Casing
Sentence case everywhere except proper nouns.
Evidence: "Add a new note" (src/components/NoteButton.tsx), "Sign in" (src/app/sign-in/page.tsx).

## Punctuation
No exclamation points in UI copy.
Evidence: 0 exclamations in 30 sampled strings. Search: `rg '!' src --type tsx` found only shell commands.

## Sample strings
- "Add a new note" – src/components/NoteButton.tsx
- "This week" – src/components/WeekHeader.tsx
- ...
```

If the sample pool is too thin to call a rule (fewer than 3 consistent examples), leave the section out. Do not guess.

## Output: `rules.md`

Rules the project **actually enforces** – structural or stylistic constraints that a design draft would break if ignored.

Each rule has three parts:

```markdown
## Cards must be brighter than the canvas
**Why:** the LightNote dark theme uses a `--bg` of `#121214` and a `--card` of `#1c1c1f` so cards read as surfaces sitting on top of the canvas. A card that matches the canvas disappears.

**How to apply:** whenever a card is rendered on a dark background, the card's background token must resolve to a value lighter than the surrounding `--bg`. For nested cards, lighten progressively.
```

Sources of rules, in order of reliability:

1. `DESIGN_PRINCIPLES.md` rules – copy verbatim, match phrasing.
2. Comment headers in `globals.css` that say "always" / "never".
3. Repeated structural patterns in the codebase (every card does X, every heading does Y) – quote two example files.
4. Explicit user direction during the create flow ("don't use gradients, ever").

If you're not sure a rule is real, it goes in `gaps.md` with a "not yet pinned" note instead.

## Output: `gaps.md`

Fragile or missing pieces – things the DS does **not** have but will need, plus anything that looks like a rule but lacks evidence.

Each entry:

```markdown
## Logo
Missing real SVG – project uses a text wordmark + lucide `Sparkles` icon. Flagged-substitution pattern.

**Why:** visual identity is incomplete; designs should not fabricate a real logo here.

**How to apply:** when a design needs a logo, use the text wordmark + icon combo. Do not generate a new logo SVG.
```

Common gaps to check:

- **Logo** – real SVG present? If not, flag the substitution pattern.
- **Fonts** – self-hosted? using CDN? falling back to system?
- **Icons** – library pinned? stroke width pinned?
- **Illustrations** – stock, generated, real?
- **Dark mode** – fully defined or partial?
- **Motion** – durations and easings pinned or ad-hoc?
- **Ad-hoc hex values** – grep for `#` hex literals outside `globals.css` / `tokens.css`. Each hit is a candidate for a missing token.
- **Accessibility primitives** – focus rings, contrast pairs, reduced-motion.

Every `gaps.md` entry must be a real gap – not a design critique. "The CTA could be bolder" is not a gap; "the CTA does not bind to a token – hardcoded `#111827` at src/components/Cta.tsx:14" is.

## Greenfield caveat

In greenfield, most inputs don't exist yet. The sweep still runs:

- `voice.md` – write it as "decide together"; pose each voice question and leave slots. The `/design-system` create flow's 30-min path filled some of these via `AskUserQuestion`; pull the user's answers verbatim.
- `rules.md` – record any rule the user specified during the create flow (no gradients, one accent hue, etc.).
- `gaps.md` – document that the DS is anchored to a reference base, not to real user code. Every token in `tokens.css` is flagged-substitution until the DS is ported into a real codebase.

The `design` skill uses `gaps.md` to know it should not over-promise – drafts generated against a greenfield DS are mock-ups, not extractions from a real system.
