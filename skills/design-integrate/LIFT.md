# Lifting React designs

Read this in Stage 2 when the chosen variants are `.tsx`, which happens when the design system says `"framework": "react"`. Everything in `SKILL.md` still applies: the per-page triage, the clarification round, the executor rules, verification, and the shipped markers. This file covers what changes when the design is already React.

An HTML design is a spec the executor translates into components. A React design is close to production code: it composes the design system's components with typed props, and it passed the project's TypeScript at finalize. Integration lifts that code instead of re-deriving it.

## What to lift

For each chosen page, the executor brief names three inputs instead of `resolved/<pageId>.html`:

- **The chosen variant's `.tsx`**, e.g. `.open-designer/designs/<name>/<page>/<variant>.tsx`
- **Every design-system component it imports through `@ds/*`.** Classify each one:
    - **Shipped**: it resolves under `shippedTo` + `shippedComponents`. The app already has it, so reuse it as is.
    - **Not shipped**: it lives in `design-systems/<ds>/components/`. Lift it into the app first.
- **The chosen tweaks and states**, read as `SKILL.md` Step 1 describes

## Order of work

1. **Lift unshipped components first, once per component.** Move each one into the app's component folder (the `shippedComponents` path, or the folder the user picks in the clarification round when the design system has none yet). Keep its props, named states, and classes. Rewrite its own imports to the app's aliases.
2. **Lift the page.** Copy the variant's component into the route the user confirmed, and then make these changes:
    - Rewrite `@ds/<file>` imports to the app's import path, e.g. `@/ui/primitives/<file>`.
    - Replace fixture imports with the real data source from the clarification round. A fixture's JSON Schema is the shape the data must have.
    - Bake the chosen `select`, `toggle`, `slider`, `color`, and `text` tweak values into props or classes. Delete the CSS variables and `data-*` selectors that existed only for tweaking.
    - Wire each `state` tweak to the real state machine, as Step 1 already asks. Never hard-code a state.
    - Replace `data-od-page` with the framework's navigation primitive, per the navigation answers.
    - Delete `<style>` elements and arbitrary values that duplicate the app's own classes.
3. **Type-check in the app.** The finalize check ran with OpenDesigner's settings; the app's own `tsc` and lint are the ones that count now.

The page must not import anything from `.open-designer/`. Grep the changed files for `.open-designer` and `@ds/` before Step 8.

## Shipped-components marker

After the first component lifts into the app, set `manifest.shippedComponents` to that folder, relative to `shippedTo`, if it is unset. From then on, `@ds/*` resolves to the real components in every design, so later designs preview against production code.

This is an allowed design-system write, alongside `shippedAt`, `shippedTo`, and `shippedTokens`. Never move or delete files in `design-systems/<ds>/components/`; the user decides when to clean them up.

## Verify

Step 8 runs as written. For the `agent-browser` comparison, compare the live route against the variant as the viewer renders it, or against its single-file build:

```
npx open-designer-viewer build <design> --page <page>
```

On Pi, run the bundled launcher from `../HOST.md` with the same arguments.
