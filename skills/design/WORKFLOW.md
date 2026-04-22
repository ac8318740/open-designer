# Workflow – SOPs

## Path A – existing UI

This is the default. The user has a real app and wants to redesign or extend a page.

1. Confirm `.open-designer/init/` and `.open-designer/design-system.md` exist. If not, run init first (see `INIT.md`).
2. Identify the target. Ask the user one clarifying question only if the target is ambiguous.
3. Trace imports starting at the route or component file. Pull in the full dependency tree of UI it touches – layouts, child components, hooks that drive layout. Stop at framework boundaries (do not pull in router internals, ORM modules, etc.).
4. Read the design system. Re-read it – do not assume memory.
5. Write `00-current.html` – a faithful replica of the current page using only the design-system tokens. This is the anchor.
6. Write 2 to 4 variants. Each variant explores a different axis (layout density, visual emphasis, interaction pattern). Name them by axis, not by number adjective: `01-tighter-spacing.html` beats `01-better.html`.
7. Update `.open-designer/drafts/<project>/index.json`.
8. Tell the user how to launch the viewer (one short sentence).

## Path B – greenfield

The user has no existing UI yet. There is no current state to anchor against.

1. Skip the codebase scan. There is nothing to scan.
2. Ask the user for the design system up front. If they have one in mind (Tailwind defaults, shadcn, Material, custom), capture it into `.open-designer/design-system.md` before any draft.
3. Skip `00-current.html`. Start at `01-`.
4. Otherwise the loop is identical.

## Multi-page projects

If the request covers multiple screens (e.g. "design the auth flow"), model each screen as a **page** in the index, with its own variants folder:

```
drafts/
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
- Wire the flow with `data-od-link`: "Create account" on sign-in → `sign-up`, "Forgot password?" → `reset`, and so on.

See `PAGES.md` for the page-vs-variant decision tree.

## Pitfalls to avoid

- **Inventing tokens.** Every iteration must re-read `design-system.md`. If the user asks for something the system cannot express, stop and ask whether to extend the system first.
- **Drift between drafts.** Same `<head>` block, same body skeleton, same font loading. Variants differ in styling, not boilerplate.
- **Over-explaining in chat.** When you finish a draft cycle, one line: which file, which axis. The user opens the viewer to see the result – they do not need a paragraph from you.
- **Editing the wrong draft.** When applying a pasted selection, locate the named draft by exact filename. If two projects have similar drafts, ask which one.
- **Treating a draft as production code.** Drafts are HTML for the viewer. When the user picks a winner, port markup and styles into the real components.

## Refresh and reset

- "Re-init" – wipe `.open-designer/init/` and re-run init.
- "Start over on this draft" – delete the draft file and remove its entry from `index.json`, then write a fresh one.
- "Forget the design system" – do not. If the user wants a different system, capture the new one in `design-system.md` first, then iterate.
