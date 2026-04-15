# Verb Skills

The harness ships 5 verb skills. They share one convention: each is a
top-level action on the project.

| Skill | Purpose |
|-------|---------|
| `/harness-plan`    | Create, manage, and audit `Plans.md` |
| `/harness-work`    | Implement the current task (solo / parallel / breezing / codex) |
| `/harness-review`  | Multi-angle review (code / plan / scope / troubleshoot) |
| `/harness-release` | Bump version, merge branches, create a tag |
| `/harness-setup`   | Initialize, build, check, doctor, localize |

## `/harness-work` auto-mode detection

| Tasks selected | Mode |
|----------------|------|
| 1 | Solo |
| 2–3 | Parallel (Task tool) |
| 4+ | Breezing (Agent Teams) |

Explicit flags (`--parallel N`, `--breezing`, `--codex`) override auto mode.

## `/harness-setup` entry points

| Subcommand | Purpose |
|-----------|---------|
| `init`    | Scaffold `harness.config.json` and `CLAUDE.md` if missing |
| `build`   | Rebuild the TypeScript core |
| `check`   | Verify files, manifest, hooks |
| `doctor`  | Print environment diagnostics |
| `localize`| Interactively tune `harness.config.json` |

All subcommands are also exposed as `bin/harness <subcommand>` at the shell.

## Plans.md labels

`[feature]`, `[fix]`, `[improve]`, `[test]`, `[docs]`, `[refactor]`, `[security]`
