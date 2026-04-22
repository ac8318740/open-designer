# Workflow – SOPs

## Path A – existing UI with a design system

This is the default. A DS exists (either already there or freshly created via `/design-system`), and the user has a real app to redesign or extend.

1. Resolve the active DS chain – walk `extends:` from child to root.
2. Re-read the briefing in full: `manifest.json`, `tokens.css`, `voice.md`, `rules.md`, `gaps.md`, `components.md`, `extractable-components.md`, and – when structural context is needed – `routes.md`, `layouts.md`, `theme.md`.
3. Identify the target. One clarifying question only if the target is ambiguous.
4. Trace imports starting at the route or component file. Pull in the full dependency tree of UI it touches. Stop at framework boundaries.
5. Write `00-current.html` – a faithful replica of the current page using only DS tokens. This is the anchor.
6. Write 2 to 4 variants. Each variant explores a different axis (layout density, visual emphasis, interaction pattern). Name by axis, not by adjective: `01-tighter-spacing.html` beats `01-better.html`.
7. Update `.open-designer/designs/<design-name>/index.json`. Record `designSystem: "<name>"`.
8. Tell the user how to launch the viewer (one short sentence).

## Path B – greenfield

If no DS exists, the main `/design` skill's first-turn gate offers to run `/design-system` first. Follow that hand-off – do not start a greenfield design without a DS in place, even a thin one (the 2-minute reference base covers the minimum).

Once a DS exists, Path A applies. The only difference: there is no current state to anchor against.

- Skip the codebase scan. There's nothing to scan beyond what `/design-system` already captured into the DS's briefing.
- Skip `00-current.html`. Start at `01-`.
- Otherwise the loop is identical – tokens, voice, rules, gaps come from the DS, which for greenfield was anchored to a named reference base.

## Multi-page projects

If the request covers multiple screens (e.g. "design the auth flow"), model each screen as a **page** in the index, with its own variants folder:

```
designs/
  auth-flow/
    index.json
    sign-in/
      01-default.html
      02-illustrated.html
    sign-up/
      01-default.html
    reset/
      01-default.html
```

- One page entry per screen in `index.json`'s `pages: []` array.
- Each page can have one or multiple variants. Variants inside a page share the page's content structure and differ in styling.
- Wire the flow with `data-od-page`: "Create account" on sign-in → `sign-up`, "Forgot password?" → `reset`, and so on.

See `PAGES.md` for the page-vs-variant decision tree.

## Pitfalls to avoid

- **Inventing tokens.** Every iteration must re-read the DS. If the user asks for something the DS cannot express, follow the mid-iteration token-gap procedure in `SKILL.md` (promote to DS, use closest, or inline one-off).
- **Drift between drafts.** Same `<head>` block, same body skeleton, same token link chain. Variants differ in styling, not boilerplate.
- **Over-explaining in chat.** When you finish a cycle, one line: which file, which axis. The user opens the viewer.
- **Editing the wrong design.** When applying a pasted selection, locate the named design by exact folder. If two designs have similar variants, ask which one.
- **Treating a draft as production code.** Drafts are HTML for the viewer. When the user finalizes, hand off to `/design-integrate`.

## Refresh and reset

- "Re-init" / "update the design system" – hand off to `/design-system` (edit flow). Do not rewrite DS files from this skill.
- "Start over on this design" – delete the design folder and its entry, then write a fresh one.
- "Forget the design system" – do not. If the user wants a different DS, run `/design-system` to create it (or switch `.open-designer/config.json:defaultDesignSystem`).
