# Pages – decision tree and patterns

A design has **pages**, each page has **variants**. This doc explains which is which and how to wire the clicks between them.

## The finalize-discard test

Every variant past the first AND every `select`/`toggle` tweak is a designer decision. When the user clicks finalize, the unselected alternatives drop from the production design. The chosen variant + chosen tweak values are what `/design-integrate` ports to real code; the rest stays behind as draft.

Encode the test as data, not prose. In `index.json`:

- Every variant past the first MUST set `discardReason: "<one sentence>"`.
- Every `select`/`toggle` tweak MUST set `discardReason: "<one sentence>"`.
- `state` tweaks are **exempt** – they're runtime conditions the production component dispatches on, not designer decisions.

The viewer surfaces these reasons in the finalize confirmation modal so the user can see what's being discarded and why. Missing values produce a console warning this release; next release they'll be a hard error.

Before adding a variant OR a `select`/`toggle` tweak, ask: **when the user finalizes, do the unselected options drop from production?**

- **Yes** → variant (one direction wins) or tweak (one value wins). Set `discardReason`.
- **No, production needs all options live at runtime** → **page**, state, or responsive treatment. Pages are linked with `data-od-page`; states are conditions of one screen rendered together.

| Case | Drop from prod on finalize? | Therefore |
|---|---|---|
| Cards vs list vs tree view mode | No – prod ships all three at runtime | **page** per mode, wired by `data-od-page` |
| Light vs dark | No – prod ships both | **page** per theme (or state, if same DOM) |
| Mobile vs desktop | No – prod renders both | responsive in one variant |
| User-toggleable density (cozy/comfy/roomy) | No – user picks at runtime | **page** or state, not tweak |
| Density default = comfy (designer's pick) | Yes – only the default ships | tweak |
| Brand-focused vs ops-focused dashboard | Yes | variant |
| Tighter vs roomier as the page's default | Yes | variant |
| Serif vs sans treatment | Yes | variant |

The test catches a common trap: writing a `select` tweak with options that all need to ship. If `select.options = [cards, list, tree]` and production renders all three, the tweak is doing nothing meaningful – `finalize` snapshots one value but the others are still in the production code. That's the signal: split into pages.

## Decision tree

For every screen in the request, ask:

1. **Does it live at a different route or URL in the real app?** → page.
2. **Does it replace the main content region when entered (list → detail, tab switch, modal open over a page)?** → page.
3. **Is it the same screen, restyled or re-laid-out as a one-time direction choice the user will commit to?** → variant.

If two candidates both have the same content shape but differ in layout density, emphasis, or color – they are variants of the same page, not different pages.

## States and modes are not variants – or tweaks

Categorical runtime conditions are **states within a variant**, switched one at a time via the `state` tweak. Don't enumerate them in this doc – derive them from `briefing/components.md` and `briefing/extractable-components.md` for the page. Common shapes include populated/loading/empty/errored, but streaming, diffed, connecting, deploying, etc. all qualify when the page has them. See `SKILL.md` step 8 for the CSS pattern.

Do not create `log-loading`, `log-empty`, `log-populated` as sibling pages. Do not create `01-loading`, `02-errored`, `03-populated` as sibling variants either.

**Runtime modes** the user toggles between in production – view mode (cards/list/tree), sidebar shown/hidden, light/dark, user-toggleable density – fail the finalize-discard test for both variants AND tweaks: production needs every option at runtime, so finalize doesn't drop anything. They are **pages**: each mode is its own page entry; the segmented-control button that switches modes is a `data-od-page` link. The user (and the LLM) can see the navigation in the viewer rather than chasing a hidden tweak.

If the user needs to step through states one at a time in the viewer, declare a `state` tweak (see `SKILL.md` step 8) – it flips `data-state` on the iframe root, the variant boots in the first listed state, and selector-based hiding shows one state at a time.

## Worked examples

### 1. List + detail

Request: "Design the meeting log and the note detail screen."

- **Pages**: `log` (scrollable list of meetings), `detail` (single meeting with full notes).
- **Variants** per page: 2–4 styling alternatives.
- **Navigation**: each row in the log gets `data-od-page="detail"`. The detail page gets a back link (arrow or chevron) with `data-od-page="log"`.

Do **not** spawn one detail page per list row. Six meetings in the log still link to one detail page – pick plausible distinct titles, but they all go to the same screen. Parametric detail rendering is a real-app concern, not a draft concern.

### 2. Tabs

Request: "Design the settings page with Profile, Notifications, Billing tabs."

- **Pages**: `profile`, `notifications`, `billing`.
- **Navigation**: the tab bar is shared across all three. Each tab is a `data-od-page` to its sibling page. Mark the active tab by styling the current tab differently per file – no runtime state needed, the viewer just swaps iframes.

### 3. Wizard steps

Request: "Design the onboarding – three steps."

- **Pages**: `step-1-name`, `step-2-workspace`, `step-3-invite`.
- **Navigation**: "Next" buttons get `data-od-page="step-2-workspace"` etc. "Back" links get the previous step's id.

### 4. Modal open

Request: "Design the project page plus the 'new task' modal."

- **Pages**: `project` (full page), `new-task-modal` (the modal as a full-page render with the dimmed backdrop baked in).
- **Navigation**: the `+ New task` button on `project` links to `new-task-modal`. The modal's close X links back to `project`.

Modals in a static viewer are just pages that look like an overlay over the previous screen.

### 5. Auth flow

Request: "Design sign-in, sign-up, and forgot-password."

- **Pages**: `sign-in`, `sign-up`, `forgot-password`.
- **Navigation**: the "Create account" link on `sign-in` goes to `sign-up`. "Forgot password?" goes to `forgot-password`. "Back to sign-in" links back.

### 6. Layout modes (cards/list/tree)

Request: "Design the workspace browser. It needs cards, list, and tree views."

Apply the finalize-discard test: when the user picks one and finalizes, do the other two leave production? No – production ships all three; the user toggles between them at runtime. So they fail the variant test AND the tweak test. They are **pages**.

- **Pages**: `workspace-cards`, `workspace-list`, `workspace-tree` – three sibling pages under one design.
- **Variants per page**: 1 to N. Within `workspace-cards` you might explore "compact cards" vs "spotlight cards" – those *are* variants (the designer finalizes one direction for the cards view).
- **Tweaks per page**: card density inside the cards page; row density inside the list page; indent step inside the tree page. Each tweak is local to the page that uses it.
- **Navigation**: every page renders the same segmented control. The Cards button gets `data-od-page="workspace-cards"`, List → `workspace-list`, Tree → `workspace-tree`. Same control wired the same way on every page.

```html
<div class="seg" role="group" aria-label="View mode">
  <button data-od-page="workspace-cards" aria-pressed="true">Cards</button>
  <button data-od-page="workspace-list">List</button>
  <button data-od-page="workspace-tree">Tree</button>
</div>
```

Why pages and not a `select` tweak: the segmented control is real UI the user clicks. Pages model that explicitly – the designer (and the LLM) sees the navigation surface in the viewer rather than discovering it as a hidden parametric knob. And `/design-integrate` ports all three pages to real components, instead of porting one and silently dropping the others.

## Navigation contract

Any element the user would click to move between screens gets `data-od-page="<pageId>"`.

```html
<a href="#" data-od-page="detail">Team sync – Tuesday</a>
<button data-od-page="detail">Open note</button>
<a href="#" data-od-page="detail:02-focus">Pin a specific variant</a>
<a href="#" data-od-page="log">← Back</a>
```

- `data-od-page="pageId"` → target page's last-active variant (or its first).
- `data-od-page="pageId:variantId"` → a specific variant, useful when one flow should always land on a particular treatment.

Wire obvious connections by default. Do not wait for the user to ask for navigation – if the real app would navigate there, the draft should too.

## Realistic copy tip

When a list renders many rows that all link to the same detail page:

- Each row should have **distinct plausible titles** ("Team sync – Tuesday", "1:1 with Priya", "Q2 planning") so the list reads as real.
- All rows still link to the same `detail` page. Do not duplicate the detail page six times to give each row its own.

The user picks a winner once, the real app reads from the database.

## Common pitfalls

- **Spawning variants for sibling screens**. If the request is "Meeting log and Note detail", that is two pages, not two variants of one design. The viewer's variant selector exists for styling alternatives – don't use it as a page switcher.
- **Smuggling runtime modes into a `select` tweak**. Cards/list/tree, sidebar on/off, light/dark, user-toggleable density all fail the finalize-discard test. They are sibling pages, not tweak options. If you find yourself writing `select.options = [cards, list, tree]`, stop and split into pages.
- **Forgetting the back link**. Every detail/modal/step page needs a way out. The viewer surfaces a Back button automatically once the user navigates in, but a back chevron in the design itself keeps the draft self-explanatory.
- **Over-fragmenting**. If two "pages" have the same structure and differ only in content (e.g. two list views with different filters), they're likely one page with a filter control, not two pages.
