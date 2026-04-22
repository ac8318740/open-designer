# Playable pages

A design system owns a small mini-app of HTML pages under `design-systems/<ds>/pages/`. The user can iterate on them in the viewer the same way they iterate on designs – select elements, type feedback, paste back into Claude.

Playable pages are the DS exercising itself. They don't ship into the real codebase. Their job is to let the user feel the DS's tokens, voice, and rules in motion before any real design or integration happens.

## Shape

Same layout as the `design` skill:

```
design-systems/<ds>/pages/
  index.json                  ← page + variant list (no `chosen`)
  landing/
    01-default.html
    02-dense.html
  dashboard/
    01-default.html
  settings/
    01-default.html
```

`index.json` example:

```json
{
  "designSystem": "<ds>",
  "updated": "2026-04-22T15:00:00Z",
  "pages": [
    {
      "id": "landing",
      "label": "Landing",
      "variants": [
        { "id": "01-default", "file": "landing/01-default.html", "label": "Default" },
        { "id": "02-dense",   "file": "landing/02-dense.html",   "label": "Dense" }
      ]
    },
    {
      "id": "dashboard",
      "label": "Dashboard",
      "variants": [
        { "id": "01-default", "file": "dashboard/01-default.html", "label": "Default" }
      ]
    }
  ]
}
```

No `chosen` object – DS playable pages aren't ported. Their finalize behavior is "remember the last variant the user picked" (persisted via the launcher's `/finalize` endpoint, which reuses the same merge logic as designs).

## Authoring rules

Every playable page:

- Links the DS's tokens directly: `<link rel="stylesheet" href="../../tokens.css" />` (the viewer also injects the extends-chain tokens at load, but the direct link keeps the file openable on its own).
- Uses `var(--<prefix>-*)` everywhere – never raw hex. This is the DS exercising its own allow-list.
- Uses `data-od-page="<otherPageId>"` for navigation between playable pages. (Same attribute as designs after the rename.)
- Respects `voice.md`, `rules.md`, and `gaps.md`. If the DS bans exclamations, the landing copy must not exclaim.
- Includes variants that exercise different tweak axes – density, motion, accent – not content variants. The DS isn't a product, so "log vs detail" is pointless here; "cozy vs roomy" is the right kind of axis.

## Template menu (pick freely – 1 is fine, 5 is fine)

For the 30-minute greenfield flow and for brownfield when the user wants more than one page, pick from:

- **Landing** – hero + feature grid + footer. Good for exercising type scale, hero composition, CTA treatment.
- **Dashboard** – sidebar nav + main pane + stats cards + one table / list. Exercises layout primitives, table density, badge styling.
- **Settings** – section headers, form rows, toggles, small destructive button. Exercises form typography, spacing rhythm, danger tokens.
- **Modal** – trigger page + open modal state (render as a separate playable page with the backdrop baked in, same pattern as the `design` skill's `PAGES.md`). Exercises overlay, focus treatment, z-index.
- **Empty state** – a single illustration + headline + helper copy + primary action. Exercises voice more than anything.

For brownfield, prefer templates that match real routes in `briefing/routes.md`. For greenfield, pick a mix that covers the DS's expected use.

## Tweaks on playable pages

Playable pages **can** declare tweaks in `index.json` the same way designs do. The difference:

- In DS mode, each tweak gets a **Promote** button in the tweaks panel. Click = write the tweak's current value to `tokens.css` `:root` for the matching `--<prefix>-*` variable. Then the tweak UI stays bound to the new default.
- Without Promote, tweaks are local to the DS – they don't cascade to designs.

Declare tweaks sparingly in playable pages. A tweak that doesn't map to a real DS token is noise – use it only when you're intentionally proposing a new token value the user might want to promote.

## Flexible page count

- Minimum one page (so the viewer isn't empty in DS mode).
- No maximum. The user can say "add a modal page" any time; the edit flow spawns `pages/modal/01-default.html` + adds the entry to `pages/index.json`.
- Deletion on request only.

## Do not

- Do not duplicate designs here. If the user already has a design for "settings", the DS's settings playable page is a different thing – it exercises the DS rather than specifying real product flows. If in doubt, ask whether the user wants a new playable page or a new design (designs go through `/design`, playable pages through `/design-system`).
- Do not wire a playable page to produce a clipboard payload that targets a real design's file. The viewer's clipboard respects the current mode and will prefix the payload with `design system` in DS mode.
