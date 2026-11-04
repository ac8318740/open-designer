# React design systems

Read this when a design system is or becomes `"framework": "react"`. A React design system adds typed components to everything in `SKILL.md`: designs compose those components instead of writing markup, so the code that wins the design loop carries into the app.

HTML stays a first-class mode. Choose React only when the project's UI is React. A design system without `framework` is HTML, and its designs keep working unchanged.

## Choose the framework

Ask once, during the create flow, after Step 1 detects the surface. Use `AskUserQuestion` with `header: "Framework"`:

- `React components (recommended for React projects)`: designs are `.tsx` pages composing `components/*.tsx`
- `HTML`: designs are hand-written HTML, as before

Recommend React when the codebase is React and has a component layer. Recommend HTML otherwise, and always for marketing surfaces built from static HTML. Write the answer to `manifest.framework`.

## What a React design system adds

```
design-systems/<ds>/
  manifest.json        framework, plus stylesheet and shippedComponents when they apply
  tokens.css           unchanged: the runnable allow-list
  styles.css           the Tailwind entry, when the project has no app stylesheet
  components/*.tsx     typed components with named states
  pages/*.tsx          playable pages, composing the components
  briefing/            unchanged; components.md lists every component's props and states
  preview/*.html       unchanged
```

### Components

Each `components/<file>.tsx` exports one or more components with typed props:

```tsx
import * as React from "react";

export const NOTEBOOK_CARD_STATES = ["populated", "loading", "empty"] as const;

export type NotebookCardProps = {
  title: string;
  tags: string[];
  state?: (typeof NOTEBOOK_CARD_STATES)[number];
};

export function NotebookCard({ title, tags, state = "populated" }: NotebookCardProps) {
  if (state === "loading") return <article className="animate-pulse rounded-xl border bg-card p-4" aria-busy />;
  return (
    <article className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      {state === "empty" ? <p className="text-muted-foreground">No cells yet</p> : <ul>{tags.map((t) => <li key={t}>{t}</li>)}</ul>}
    </article>
  );
}
```

- **Typed props are the contract.** Designs and fixtures must satisfy them, and finalize type-checks them.
- **Named states are a typed `state` prop** with its options exported as a constant. A playable page renders each state side by side, and a design's `state` tweak maps onto it.
- **Lift, never invent.** In a brownfield project, a component's markup, classes, and states come from the project's own components, exactly as tokens come from the code. Record anything you could not find in `gaps.md`.
- Pages import components as `@ds/<file>`. The `design` skill's `REACT.md` covers page authoring.

### Stylesheet

React builds compile CSS with the project's own Tailwind v4, so plugins, imports, and `@theme` match production.

- **The app has a stylesheet** (for example, LightNote's `apps/app/src/app/globals.css`): set `manifest.stylesheet` to its path, relative to `shippedTo` (or to the project root when `shippedTo` is unset). Tailwind resolves from that app's `node_modules`.
- **No app stylesheet** (greenfield): write `styles.css` in the design system, starting with `@import "tailwindcss";` and an `@theme` block that maps the tokens in `tokens.css` onto Tailwind's names.
- **An explicit override**: `manifest.stylesheet` may point at any stylesheet in the project, e.g. a marketing app's.

### Shipped components

`manifest.shippedComponents` is the project's real component folder, relative to `shippedTo`. Once it is set, `@ds/*` resolves there instead of to `components/`, and each shipped file still resolves its own `tsconfig.json` path aliases. `/design-integrate` sets it when it lifts the components into the codebase. The bootstrap below sets it for components that already live in the app.

## manifest.json for React

```json
{
  "name": "lightnote",
  "framework": "react",
  "shippedTo": "/home/me/LightNote/apps/app",
  "shippedComponents": "src/ui/primitives",
  "stylesheet": "src/app/globals.css"
}
```

## Bootstrap a React design system from existing primitives

Use this procedure when the project already has a component layer worth designing with, such as LightNote's `apps/app/src/ui/primitives`. The design system then points at the real primitives instead of copying them. Ask before each write; nothing here edits the app.

1. **Confirm the packages are installed.** The app's `node_modules` must hold React, its component dependencies (Radix, `class-variance-authority`), and Tailwind v4. If they are missing, stop and ask the user before running any install in the app.
2. **Find the three paths.**
    - The app root, which becomes `shippedTo`, e.g. `/home/me/LightNote/apps/app`
    - The primitives folder relative to it, which becomes `shippedComponents`, e.g. `src/ui/primitives`
    - The app's Tailwind entry relative to it, which becomes `stylesheet`, e.g. `src/app/globals.css`
3. **Write the manifest** with `framework: "react"` and those three fields. This is the one case where the design-system skill writes `shippedTo` and `shippedComponents`, because the components already live in the app. Leave `shippedAt` unset, so `/design-integrate` still runs Stage 1 for the tokens.
4. **Write `briefing/components.md` from the primitives.** For each file, list its exports, props (from the TypeScript types), variants (for example, the `cva` variant names), and states. Copy these verbatim, never paraphrase them.
5. **Keep `tokens.css` honest.** Lift it as `CREATE.md` describes. The stylesheet already carries the theme, so `tokens.css` is the allow-list the `design` skill reads, not the CSS source.
6. **Write one playable page** in `pages/` that composes several primitives. Open it in the viewer and confirm it renders styled. A build error or unstyled output means one of the paths is wrong.
7. **Leave `components/` empty.** New components the design loop invents go there until `/design-integrate` lifts them into the primitives folder.

An existing HTML design system for the same app keeps its HTML designs. Create the React design system alongside it, or switch `framework` only after the user confirms that new designs should be React.
