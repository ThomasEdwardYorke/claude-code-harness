# Commands

The harness ships 13 commands: 5 verb skills that define the overall
lifecycle, plus 8 workflow skills for git, PR review, Codex collaboration,
TDD enforcement, worktree parallelization, session handoff, and the local
pseudo-CodeRabbit loop.

## Verb skills

| Skill | Purpose |
|-------|---------|
| `/harness-plan`    | Create, manage, and audit `Plans.md` |
| `/harness-work`    | Implement the current task (solo / parallel / breezing / codex) |
| `/harness-review`  | Multi-angle review (code / plan / scope / troubleshoot) |
| `/harness-release` | Bump version, merge branches, create a tag |
| `/harness-setup`   | Initialize, build, check, doctor, localize |

## Workflow skills

| Skill | Purpose |
|-------|---------|
| `/branch-merge`          | feature → dev → main merge with test gates + dev re-sync |
| `/new-feature-branch`    | Create a new feature branch after verifying main/dev sync |
| `/coderabbit-review`     | Background-watch a CodeRabbit review on a PR and auto-respond |
| `/codex-team`            | Use Codex CLI as a teammate (review / dev / adversarial) |
| `/parallel-worktree`     | Orchestrate 2+ sub-tasks in parallel via `git worktree` with coordinator / worker dispatch |
| `/pseudo-coderabbit-loop`| Local pseudo-CodeRabbit review loop via Codex CLI (rate-limit hedge for real CodeRabbit) |
| `/session-handoff`       | 3-layer handoff doc structure (current / backlog / design-decisions + archive) with `init` / `update` / `archive` / `check` subcommands |
| `/tdd-implement`         | Strict TDD + Codex parallel + pseudo-CodeRabbit + real CodeRabbit + Codex second-opinion quality gate |

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
