# References – the look-and-feel shelf

A curated list of component libraries Claude may consult when the user
explicitly asks for a particular aesthetic ("make it feel more like
shadcn", "use a Magic UI animation here") or when working greenfield
without an existing design system.

**This shelf is opt-in.** When working on existing UI, fidelity to the
active design system under `.open-designer/design-systems/<name>/`
always wins. Do not pull from these sources unless the user has named
them or the project has no design system yet.

Every source listed here ships under MIT, Apache-2.0, BSD, or ISC and
has been audited at the library or component level. If you want to use
something not on this list, audit it first – sometimes-permissive
defaults like 21st.dev community submissions, Aceternity UI, animate-ui
(MIT + Commons Clause), and prebuiltui have failed audit and must not
be vendored.

---

## How to use a reference

1. Identify what you need (an animation, a hero pattern, a chart layout).
2. Pick a source from the table below by aesthetic match.
3. Fetch the component's source from the URL listed and adapt it into
   your draft – do not paste-copy verbatim unless the user has approved
   shipping that source. References are inspiration, not building blocks.
4. If you do vendor markup or styles into the user's repo (not just into
   a draft), add the source's attribution line to the project's
   `THIRD_PARTY_NOTICES.md`. The attribution string is in the table.
5. Re-read the active DS's `tokens.css` + `voice.md` + `rules.md` and
   rewrite the snippet using only allowed tokens. The reference's
   color palette and font choices do not override the user's system.

---

## Whole-library MIT/Apache sources (any component is safe)

| Source | License | Best for | URL | Attribution |
|---|---|---|---|---|
| **shadcn/ui** | MIT | React primitives (button, dialog, form, table) | https://ui.shadcn.com – src https://github.com/shadcn-ui/ui | `shadcn/ui – MIT – Copyright (c) 2023 shadcn` |
| **Magic UI** | MIT | Animated text, special effects, hero animations | https://magicui.design – src https://github.com/magicuidesign/magicui | `Magic UI – MIT – Copyright (c) Magic UI` |
| **HyperUI** | MIT | Plain Tailwind HTML blocks, marketing sections | https://hyperui.dev – src https://github.com/markmead/hyperui | `HyperUI – MIT – Copyright (c) Mark Mead` |
| **Flowbite** | MIT | Tailwind HTML components with optional JS behavior | https://flowbite.com – src https://github.com/themesberg/flowbite | `Flowbite – MIT – Copyright (c) Themesberg` |
| **DaisyUI** | MIT | Semantic Tailwind class set, framework-agnostic | https://daisyui.com – src https://github.com/saadeghi/daisyui | `daisyUI – MIT – Copyright (c) Pouya Saadeghi` |
| **Tremor** | Apache-2.0 | Charts, dashboards, KPI cards | https://github.com/tremorlabs/tremor | `Tremor – Apache-2.0 – Copyright (c) Tremor` |
| **Untitled UI React** | MIT | Polished React primitives (buttons, inputs, modals) | https://untitledui.com/react – src https://github.com/untitleduico/react | `Untitled UI React – MIT – Copyright (c) 2025 Untitled UI` |
| **kokonutui** | MIT | AI chat input patterns, prompt boxes, V0-style chat | https://kokonutui.com – src https://github.com/kokonut-labs/kokonutui | `Kokonut UI – MIT – Copyright (c) 2025 kokonutUI` |
| **motion-primitives** | MIT | Animated tabs, transitions, motion patterns | https://motion-primitives.com – src https://github.com/ibelick/motion-primitives | `motion-primitives – MIT – Copyright (c) 2024 ibelick` |

## Discovery surfaces (browse, then audit before vendoring)

These sites are useful for discovering aesthetics but do **not**
guarantee a usable license. If you find something you want to vendor,
trace it back to its upstream repo and audit that repo's LICENSE.

- **21st.dev** – https://21st.dev . Component pages rarely declare a
  license. Their ToS reserves all rights to the author by default. Many
  components are remixes of MIT libraries above (kokonutui,
  motion-primitives, shadcn) – if you can identify the upstream, vendor
  from there with the upstream's license. Otherwise treat as
  all-rights-reserved and ask the author.

## Explicitly excluded (do not vendor)

These came up during audit and failed. Listed so they don't get
re-evaluated each time:

- **Aceternity UI free** – terms at `ui.aceternity.com/terms` reserve
  all IP and forbid redistribution. Copy-paste into your own end-user
  app is the documented intent; bundling into a redistributed plugin is
  not. Reimplement the visual pattern from scratch if needed.
- **animate-ui** – MIT **+ Commons Clause**. The Commons Clause
  explicitly forbids redistributing the components themselves alone or
  bundled. Looks open at a glance, isn't.
- **prebuiltui** – Template License at
  `prebuiltui.com/policies/template-license` forbids redistribution and
  sublicensing despite the marketing line "free to use".
- **Tailwind UI / Tailwind Plus** – paid, no redistribution.
- **Per-author 21st.dev components without a separate LICENSE'd repo** –
  default copyright applies. Examples seen during audit: easemize,
  isaiahbjork (for these specific components), jatin-yadav05,
  minhxthanh, hextaui (unlicensed at the repo level despite premium
  tiers existing).

---

## Selection cheat sheet

| You want… | Reach for |
|---|---|
| A solid base button/input/dialog | shadcn/ui |
| Animated headline or text effect | Magic UI |
| Plain HTML marketing block | HyperUI or Flowbite |
| Charts and KPI cards | Tremor |
| AI chat input or prompt box | kokonutui |
| Tabs, animated transitions | motion-primitives |
| Polished form primitives | Untitled UI React |
| A class system instead of components | DaisyUI |

When the user says "make it look like X", check this list first. If X
isn't listed, ask the user for a URL and audit before pulling anything
in.
