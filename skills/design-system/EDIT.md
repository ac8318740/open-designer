# Edit flow

Two payload shapes come from the viewer while the user is in Design systems mode, plus plain conversational edits.

## Shape 1 – selection payload

Starts with `I selected an element in design system \`<ds>\`` (single element) or `I selected N elements in design system \`<ds>\`` (multi). Same format as the `design` skill's payload but with a different lead sentence and an extra `designSystem: <name>` context.

To apply:

1. Resolve the DS. Walk its `extends` chain so you have the full token context.
2. Locate the playable page – `design-systems/<ds>/pages/<page-id>/<variant>.html`.
3. For each element, find it by selector. Fall back to outer-HTML snippet if ambiguous.
4. Decide where the edit lands:
   - **Structural / markup change** – edit the playable page HTML.
   - **Visual change that already binds to a CSS variable** – adjust the variable in `tokens.css` at `:root`. Recommend promotion to the user one-liner: "Updated `tokens.css` – this will cascade to every design using `<ds>`."
   - **Visual change that doesn't yet bind to a variable** – ask: promote to DS (add a new token) or keep local to the playable page?
   - **Copy / tone change** – update `briefing/voice.md` and quote the new rule in the element.
   - **Structural "do not break" change** – add a rule to `briefing/rules.md` with a **Why:** line citing the element as evidence.
5. Bump `manifest.updatedAt` (ISO timestamp).
6. One-line reply to the user: which file changed and what.

Never silently promote a local tweak to the DS. Promotion is explicit – either the user clicks the Promote button, or you ask and they confirm.

## Shape 2 – Promote payload

The viewer's Promote button POSTs to `/data/design-systems/<ds>/promote` – the launcher applies it atomically. The skill only sees this when the user is asking about a specific change that was promoted and wants to understand what happened.

If the user pastes the toast text or asks "why did my tweak disappear?", explain: the Promote button wrote the value to `tokens.css` `:root`. The local tweak is now the default for every design that links this DS.

## Shape 3 – conversational edits

Plain-language requests. Route each by file:

- "add an amber success token" → `tokens.css` `:root` (add `--<prefix>-success-bg`, `--<prefix>-success-fg`). Update `preview/colors.html` to include the new swatch. Append a `briefing/components.md` note if a component should start using it.
- "banish exclamation points from voice" → `voice.md` – add the rule under a Punctuation section, cite the user's request as evidence.
- "document the 1px-border rule" → `rules.md`. Add rule, add **Why:** (what breaks when you drop to 0.5px), add **How to apply:** (which surfaces).
- "Geist Mono isn't self-hosted yet" → `gaps.md`. Never move the entry to `rules.md` until the font is actually vendored.
- "add a settings playable page" → create `pages/settings/01-default.html` plus the `pages/index.json` entry. Use DS tokens and the playable-page shape in `PAGES.md`.

Every conversational edit bumps `manifest.updatedAt`.

## New-token discipline

When adding a token:

1. Pick a name that follows the existing prefix (`--<prefix>-*`).
2. Add to `:root` in `tokens.css`. If the DS has dark mode, add a paired value under the `@media (prefers-color-scheme: dark)` block.
3. Add the swatch / sample to the matching `preview/*.html`.
4. If the token represents a concept not yet expressed anywhere (e.g. success color for a DS that had none), tell the user: "`<ds>` now exposes `--<prefix>-success-bg`. Want me to also add it to `briefing/components.md` so Claude knows to reach for it?"

If the user says no, leave `briefing/components.md` alone – the token exists but is available, not prescribed.

## Removing tokens

- Never remove a token without asking. Designs may be linking it.
- If the user confirms removal, grep `.open-designer/designs/` for `var(--<prefix>-<name>)`. If any design references it, warn them before deleting.

## Changing `extends`

- If the user wants to add or swap `extends:`, ask what the intent is. Common cases:
  - "Make `lightnote-mkt` inherit `lightnote`" → set `extends: "lightnote"` and drop any duplicate tokens from the child that match the parent exactly.
  - "Stop inheriting" → copy the resolved parent tokens into the child's `tokens.css` and remove `extends:` from `manifest.json`. Otherwise designs that used parent-only tokens will break.

## After any edit

Short one-line reply. Do not repeat the request back. Name the file and the nature of the edit. The user will see the result in the viewer's next refresh (hot reload picks it up automatically).
