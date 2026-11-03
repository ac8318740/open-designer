# Host contract

Read this before any Open Designer workflow or companion. The shared workflow names Claude Code tools; on Pi, use the mappings below. All approval, data-preservation, design-system, and finalization rules still apply.

## Questions and handoffs

- `AskUserQuestion` means the host's available question tool (for example, `ask_user_question` on Pi). Preserve the choices and explicit approval. If no question tool exists, ask in conversation and stop until the user answers. Never infer approval from a missing tool.
- `Skill` means an available skill invocation. On Pi, read the target's `SKILL.md` and follow it; never run a slash command in the shell. For sibling Open Designer skills, resolve `../<name>/SKILL.md` relative to the current skill directory.
- On Pi, use `/open-designer:design-system`, `/open-designer:design`, and `/open-designer:design-integrate` when suggesting commands. The shorter names in companions identify these same workflows. `/skill:design-system`, `/skill:design`, and `/skill:design-integrate` also load the shared skills directly.
- Optional integrations are available only when the current host session exposes the required commands/skills. Installed Claude plugins or project configuration alone do not make them callable from Pi. Never invoke an unavailable tool or install another package implicitly.

## Exploration, implementation, and checks

`Agent` and named agent types describe roles, not tools every host provides. Use an available delegation tool only with user authorization. Keep delegated writes isolated. On Pi without authorized delegation, perform the exploration roles sequentially, then the test-writing, implementation, and checking steps in order, preserving each role's scope and checks.

A sequential self-check is not an independent review. If the project or workflow requires independent verification, stop before claiming completion or writing shipped markers and ask for an authorized independent reviewer. Missing browser access, failed checks, or absent required capabilities are blockers, not permission to skip verification. Report any unavailable optional verification explicitly.

## Installed resources and viewer

All companion paths are relative to the installed skill directory, never the project or a global checkout. Project data stays under the user's project root in `.open-designer/`.

On Pi, launch the bundled `launcher/serve.mjs`, not `npx open-designer-viewer` (which might fetch different bytes). Namespaced commands provide its absolute path. When loaded directly as a skill, resolve `../../launcher/serve.mjs` relative to this skill's `SKILL.md` directory. Run `node "<absolute launcher path>"` from the user's project root. Quote paths safely; use argument arrays when the execution tool supports them.

The launcher binds explicitly to `127.0.0.1` and defaults to port 5179, trying the next 19 ports if busy. `OPEN_DESIGNER_PORT` changes the starting port; `OPEN_DESIGNER_NO_OPEN=1` prevents opening a browser. Inspect the actual listener after launch. Never broaden access, start an unrelated service, or claim browser verification from an HTTP-only check. Stop only the process this session started when finished.

Claude Code keeps the documented `npx open-designer-viewer` launcher and its existing plugin discovery rules.
