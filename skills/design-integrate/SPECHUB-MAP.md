# Spechub-vs-self-contained map

Soft integration. If spechub is present, use its slash commands and agents. If not, orchestrate the same agent types directly.

## Detection

Check in this order:

1. `spechub/project.yaml` exists somewhere up the tree from the working directory.
2. Slash commands `/spechub:propose`, `/spechub:design`, `/spechub:implement`, `/spechub:implement-quick` are listed in the current session's available slash commands.
3. The `spechub` plugin directory exists under the plugin cache (`~/.claude/plugins/cache/.../spechub/`).

Any of these → **soft integration mode**.

## Full pipeline + spechub

### `/spechub:propose`

Synthesize a proposal from the exploration outputs and the resolved DS bundle. The prompt you feed spechub:

```
Integrate the open-designer page "<pageId>" of design "<design>" into
the codebase.

Design context:
- Resolved DS bundle: <bundle path>
  - tokens.css, voice.md, rules.md, gaps.md, components.md,
    routes.md, layouts.md, theme.md (all extends-resolved)
- Resolved design HTML: <bundle>/resolved/<pageId>.html
- Matched DS playable page: <bundle>/pages/<pageId>.html
- Tweak overrides to bake in: <chosen.tweaks as key=value list>

Backend gaps (must be addressed by this proposal):
- <list from Agent 3>

Target route / component (from clarification round):
- <user's chosen route>
- <user's chosen component strategy>

Navigation mapping (data-od-page → real-app primitive):
- <list from clarification round>

Real copy / data sources:
- <answers from clarification round>

DS fidelity – use only tokens in <bundle>/tokens.css. Apply voice.md
and rules.md to every ported surface. Do not invent new tokens unless
the user explicitly approves.

If the DS has not yet shipped into this codebase (no manifest.shippedAt),
Stage 1 of design-integrate has already handled that – the codebase's
tokens.css and doc locations are noted in the clarification answers.
```

### `/spechub:design`

After propose lands, feed the design command with the same design context plus the proposal outputs. Spechub's design phase turns the proposal into tasks.

### `/spechub:implement`

Launch the implementation loop. Stay available to answer context questions that come back from the test-writer / executor agents – especially "what does this element in the HTML correspond to in terms of existing components?".

## Quick path + spechub

### `/spechub:implement-quick`

Skip propose/design. Feed the same bundled context but compressed:

```
Quick-path integration of open-designer page "<pageId>" of design
"<design>".

Scope:
- <one-line description of the change>

Design context:
- Resolved DS bundle: <bundle path>
- Resolved design HTML: <bundle>/resolved/<pageId>.html
- Matched DS playable page: <bundle>/pages/<pageId>.html
- Tweak overrides: <chosen.tweaks as key=value list>
- Target: <component path>
- Navigation mapping: <list>

DS fidelity – use only tokens in <bundle>/tokens.css. Apply voice.md
and rules.md.
```

## Full pipeline + no spechub

Orchestrate subagents directly.

1. **test-writer agent** (`subagent_type: "spechub:test-writer"` if available, else `general-purpose`):
   ```
   Write failing tests for this behavior. The behavior is described by:
   - Resolved design HTML: <bundle>/resolved/<pageId>.html
   - Backend gaps to cover: <list>
   - User's clarified intent: <answers>

   Test placement follows existing conventions in the repo. Do NOT
   read any implementation files yet – tests are a spec.
   ```

2. **task-executor agent** (`subagent_type: "spechub:task-executor"` if available, else `general-purpose`):
   ```
   Make these failing tests pass. Tests are at <paths>. Design
   reference at <bundle>/resolved/<pageId>.html. Matched DS playable
   page at <bundle>/pages/<pageId>.html. Do not modify the tests. Use
   only tokens in <bundle>/tokens.css for visual work. Apply rules
   from <bundle>/rules.md and voice from <bundle>/voice.md.
   ```

3. **task-checker agent** (`subagent_type: "spechub:task-checker"` if available, else `general-purpose`):
   ```
   Verify the implementation at <paths>. Binary PASS/FAIL. Check:
   - All new tests pass
   - Typecheck clean
   - Lint clean
   - No regressions in existing tests
   - Visual match against <bundle>/resolved/<pageId>.html
   - Rules-lint pass against <bundle>/rules.md (gradients, accents,
     casing, punctuation)
   ```

## Quick path + no spechub

Skip test-writing for purely visual pieces.

1. **task-executor** directly:
   ```
   Apply this visual change to <component path>. Design reference at
   <bundle>/resolved/<pageId>.html. Tweak overrides: <key=value list>.
   Use only tokens in <bundle>/tokens.css. Apply rules from
   <bundle>/rules.md and voice from <bundle>/voice.md. Reuse the
   codebase components Agent 2 identified before creating new ones.
   Drop any data-od-page attributes from the shipped code; replace
   with the framework's nav primitive per the clarification answers.
   ```

2. **task-checker**:
   ```
   Verify <paths>. Typecheck + lint + existing tests + visual match
   against <bundle>/resolved/<pageId>.html. Rules-lint pass against
   <bundle>/rules.md – flag violations as warnings.
   ```

3. **frontend-verifier** (if available as `spechub:frontend-verifier`):
   ```
   Navigate to <route> after `npm run dev` and snapshot. Compare
   layout, colors, copy structure against <bundle>/resolved/<pageId>.html.
   ```

## Notes

- Never paste the resolved HTML or the DS bundle files into prompts. Always reference by path. HTML and CSS can be large and pasting them blows the context budget.
- Always bundle the `chosen.tweaks` as a short key=value list – that is the exact visual state the user approved, and it's small enough to include inline.
- When both spechub and agent-browser are available, use the `spechub:browser-verify` skill for the visual verification step.
- If a subagent says "I don't have access to X", do not switch to a hack – stop and ask the user. Most of the time the right answer is "the user didn't run the dev server" or "spechub isn't installed here", which is a clarify-and-re-run, not a workaround.
