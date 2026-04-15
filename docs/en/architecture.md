# Architecture

## High level

```
Claude Code session
        │
        ▼
hooks/hooks.json  (registered per plugin install)
        │ stdin JSON (tool_name + tool_input)
        ▼
scripts/hook-dispatcher.mjs  (thin ES-Modules shim, no logic)
        │ import ${CLAUDE_PLUGIN_ROOT}/core/dist/index.js
        ▼
core/src/index.ts  (routes by hook type)
        │
        ├── guardrails/pre-tool.ts    → guardrails/rules.ts  (R01–R13)
        ├── guardrails/post-tool.ts   → guardrails/tampering.ts (T01–T12)
        ├── guardrails/permission.ts  (auto-approve safe commands)
        └── state/store.ts            (JSON file store for sessions/signals/…)
        │
        ▼ stdout JSON { decision, reason?, systemMessage? }
Claude Code enforces the decision
```

## Layers

1. **Guardrails** — 13 declarative rules. Domain-neutral defaults plus 3
   parameter-driven rules (R10 / R11 / R13) that can be enabled per project.
2. **Skills** — 5 verb commands (`plan` / `work` / `review` / `release` /
   `setup`) that live under `commands/`.
3. **Agents** — 3 general-purpose agents (`worker` / `reviewer` /
   `scaffolder`) plus 2 helpers (`security-auditor`, `codex-sync`).
4. **State** — pure-JS JSON file at `<projectRoot>/.claude/state/harness.json`.
   No native SQLite. Single-process safe.

## Configuration precedence

1. `harness.config.json` at the project root — user-authored values
2. `DEFAULT_CONFIG` in `core/src/config.ts` — applied for any unset field
3. Environment variables (`HARNESS_WORK_MODE`, `HARNESS_CODEX_MODE`,
   `HARNESS_BREEZING_ROLE`) override narrow flags at evaluation time

Unknown fields in `harness.config.json` are ignored (forward compatibility).

## Design invariants

- Plugin root paths are resolved via `${CLAUDE_PLUGIN_ROOT}`. The dispatcher
  never uses `../../` or ad-hoc traversal — `${CLAUDE_PLUGIN_ROOT}/core/dist/…`
  is always valid post-install.
- Every rule evaluates a `RuleContext` that carries the loaded `HarnessConfig`.
  Empty config arrays mean "off", never "error".
- All hook paths fail open on errors. A malformed input JSON or a missing
  core build approves the tool call rather than blocking the user.

## Official reference patterns used

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — per-tool matchers (one entry per tool to avoid
  relying on unverified regex-OR behaviour)
- `bin/` — `harness` CLI added to the Bash `PATH` while the plugin is enabled
- `${CLAUDE_PLUGIN_ROOT}` — plugin install directory

See the Claude Code plugin reference for the canonical definitions.
