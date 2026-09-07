# impeccable

impeccable is a separate Claude Code plugin. It reviews a user interface against the product's own design rules. open-designer calls two of its parts and never copies its files.

- `detect` is a command line. It scans files for design anti-patterns
- `document` is a slash-command playbook. It writes `DESIGN.md` from the code

This file holds the one presence rule and the facts about those two parts. `CREATE.md` (the `design-system` skill) and `../design-integrate/SPECHUB-MAP.md` both read it.

## Presence rule

impeccable is optional. Every skill that uses it decides presence with this rule and nothing else.

1. Run the spechub design gate when the spechub CLI exists:

    ```bash
    test -x ~/.claude/spechub/bin/spechub && ~/.claude/spechub/bin/spechub design-gate --json
    ```

    The command prints one JSON object: `{ "on": <bool>, "reasons": [<string>...], "impeccable": { "version", "launcher" } | null }`. Read `on` and `reasons`.

    - `"on": true` means present. `impeccable.version` and `impeccable.launcher` come with it
    - `reasons` holding `"workflow.design_review is false"` means absent. The user turned the design review off for this project
    - `reasons` holding `"impeccable is not installed"` means absent
    - `reasons` holding only `"no spechub project here"`, or no spechub CLI at all, means the gate cannot answer. Go to step 2

2. Read the plugin registry, the same two files the gate reads:

    ```bash
    grep -q '"impeccable@' ~/.claude/plugins/installed_plugins.json
    ```

    - No key starting `impeccable@` means absent
    - A key whose value under `enabledPlugins` in `~/.claude/settings.json` is `false` means absent. Claude Code never loads a plugin switched off there
    - Any other state (`true`, no key, no `enabledPlugins`, no settings file) means present
    - `CLAUDE_CONFIG_DIR`, when set, replaces `~/.claude` in both paths

Absent means the skill runs as it did before impeccable existed. Present means the skill takes the impeccable branch its own file describes.

## Version floor

open-designer targets impeccable major 4. The floor warns and never blocks.

- The gate prints the warning itself on stderr when the installed version is older or unreadable
- On the registry path, read `version` from `<installPath>/.claude-plugin/plugin.json`, where `installPath` is the registry entry's `installPath`. Warn in one line when the major is below 4 or the version is unreadable, then continue

## `detect`

`detect` is the only part of impeccable that runs as a command. Call it through npm:

```bash
npx impeccable detect --json --no-advisory <file> [<file>...]
```

- A firm finding is one the contract calls primary. It counts toward the exit code. An advisory finding is a suggestion and never does
- Exit 0 means no firm finding
- Exit 2 means at least one firm finding. The JSON on stdout lists them
- Exit 1 means the detector could not read a target, or an argument was wrong. Treat it as "the detector could not run", never as a finding
- `--no-advisory` drops advisory findings. Without the flag the JSON lists them with `"advisory": true`
- Run it from the project root. `detect` reads `.impeccable/config.json` from the working directory, and it finds `DESIGN.md` by walking up from each target file
- Pass files, never directories. A directory scan covers files the work never touched

## `document`

`document` is a playbook inside impeccable's skill. Invoke the `/impeccable document` slash command with the Skill tool. Never run it as a shell command; there is no such command.

- It writes `DESIGN.md` at the project root, and a sidecar at `.impeccable/design.json`
- Scan mode reads the code. It asks the user two short rounds of qualitative questions (naming, mood, elevation philosophy) that no scan can answer
- Seed mode writes a `DESIGN.md` with no tokens. `document` offers it when the scan finds no tokens, no components, and no rendered site. A skill that needs tokens declines it
- An existing `DESIGN.md` makes `document` stop and ask: refresh, overwrite, or merge. It has no flag that skips the question

## What `DESIGN.md` holds

The YAML frontmatter is the machine-readable layer. Every value is one the project's code uses; `document` invents none.

| Key | Shape | Example |
|---|---|---|
| `colors` | slug to CSS color string | `primary: "#b8422e"` |
| `typography` | role to object of `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFeature`, `fontVariation`, each optional | `body: { fontFamily: "Inter, sans-serif", fontSize: "1rem" }` |
| `rounded` | step to value | `md: "8px"` |
| `spacing` | step to value | `md: "16px"` |
| `components` | variant to at most eight props, referencing primitives as `{colors.primary}` | `button-primary: { backgroundColor: "{colors.primary}" }` |

Two facts shape an import:

- Shadows, motion, and breakpoints never appear in the frontmatter. impeccable keeps them in the sidecar under `extensions.shadows`, `extensions.motion`, and `extensions.breakpoints`. Shadow and motion entries are `{ name, value, purpose }`; breakpoint entries are `{ name, value }`
- The frontmatter carries no dark-mode values

The markdown body after the frontmatter has up to eight sections in a fixed order. They are Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, and Do's and Don'ts. Each is prose about how to apply the tokens.

## Source of truth

The code is the only source of truth for tokens. `DESIGN.md` derives from the code through `document`. With impeccable present, `tokens.css` derives from `DESIGN.md`. With impeccable absent, `tokens.css` derives from the code.

Nothing ever writes `DESIGN.md` from `tokens.css`. A token changed in the viewer reaches the code through the `design-integrate` skill's re-ship, and `DESIGN.md` then follows the code through `document`.

`PRODUCT.md` belongs to impeccable's `init` playbook. open-designer never writes it.
