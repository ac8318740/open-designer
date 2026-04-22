# Pages – decision tree and patterns

A design has **pages**, each page has **variants**. This doc explains which is which and how to wire the clicks between them.

## Decision tree

For every screen in the request, ask:

1. **Does it live at a different route or URL in the real app?** → page.
2. **Does it replace the main content region when entered (list → detail, tab switch, modal open over a page)?** → page.
3. **Is it the same screen, restyled or re-laid-out?** → variant.

If two candidates both have the same content shape but differ in layout density, emphasis, or color – they are variants of the same page, not different pages.

## States are not pages

Loading, empty, errored, populated, streaming, diffed – these are **states within a variant**, not pages and not variants. Do not create `log-loading`, `log-empty`, `log-populated` as sibling pages. Do not create `01-loading`, `02-errored`, `03-populated` as sibling variants either.

A variant renders the interesting states **on one surface at once** – a populated row sitting next to a skeleton row sitting next to an errored row. That's what makes a DS's tokens visible across state pressure. If the user needs to step through states one at a time in the viewer, use the `state` tweak (see `SKILL.md` step 8) – it flips `data-state` on the iframe root without duplicating files.

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
- **Forgetting the back link**. Every detail/modal/step page needs a way out. The viewer surfaces a Back button automatically once the user navigates in, but a back chevron in the design itself keeps the draft self-explanatory.
- **Over-fragmenting**. If two "pages" have the same structure and differ only in content (e.g. two list views with different filters), they're likely one page with a filter control, not two pages.
