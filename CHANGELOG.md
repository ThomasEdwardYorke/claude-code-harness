# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Phase κ — subagent `isolation` frontmatter regression guard** (`content-integrity.test.ts`). 12 tests (6 agent × 2 assertion) that lock in the current no-`isolation` policy and permit only the official `"worktree"` value if someone ever adds it. Background in `docs/maintainer/research-subagent-isolation-2026-04-22.md` (Codex Worker C, official-docs deep dive): the `isolation: worktree` field is supported for plugin subagents, but adding it to `worker` while `/parallel-worktree` still manages worktrees manually would create a nested-worktree interference risk. Migrating cleanly requires hook-level coordination via `WorktreeCreate` / `WorktreeRemove` (tracked as Phase κ-2, Phase 2-3 scope).
- **Phase λ — B-2f generality guard** (`generality.test.ts`). Blocks re-introduction of the predecessor-project-specific `--test-pipeline` subflow in shipped specs. Regex `/--test-pipeline(?![\w-])/g` is word-boundary-strict (no false positive on `--test-pipeline-*` variants).
- Docs: `docs/maintainer/research-subagent-isolation-2026-04-22.md` (200 lines, public-docs-cited deep dive into the `isolation` field and its interaction with `/parallel-worktree`).
- Docs: `docs/maintainer/research-anthropic-official-2026-04-22.md` + `docs/maintainer/research-plugin-best-practice-2026-04-22.md` (preserved Codex Worker A/B parallel audit reports; basis for Phase η / θ / ι / κ planning).

### Removed

- **Phase λ — `--test-pipeline` subflow (breaking change for v3/v4.1 users)** from `plugins/harness/commands/harness-work.md`. Removed from 6 locations: `argument-hint`, mode selection table, pseudocode × 2, options table, and the standalone subflow section. Also removed from the `description` / `description-ja` frontmatter so the flag no longer shows up as a Claude routing trigger. The flag was predecessor-project-specific (CSV schema validation via `scripts/check-pipeline.sh`). Historical references in the v3/v2/v1 changelog entries are preserved for context. Migration: test-bed projects should supply their own pipeline check via a project-local skill (see `.claude/skills/<project>-local-rules/references/pipeline-check.md`).

### Changed

- `plugins/harness/commands/harness-work.md` frontmatter `description` / `description-ja` reworded to drop `test pipeline` / `/test-pipeline` triggers (Phase λ).
- `plugins/harness/commands/harness-work.md` skill changelog section records v4.2 (the Phase λ removal) and annotates v3/v2/v1 entries as "integrated in vN, removed in v4.2" for reader clarity.
- `docs/maintainer/leak-audit-2026-04-22.md` and `docs/maintainer/test-bed-usage.md` updated to mark Phase κ + Phase λ as Resolved, with cross-references to the new research doc.

## [0.1.0] - 2026-04-16

### Added
- Initial portable release split from a private project harness.
- Guardrail rules R01–R13 with TypeScript implementation in `plugins/harness/core/`.
- `harness.config.json` schema and loader for per-project customization.
- Pure-JS JSON file state store (zero native dependencies).
- Plugin manifest (`plugin.json`, `marketplace.json`) for Claude Code distribution.
- 5 verb skills: `harness-plan/work/review/release/setup`.
- 3 general agents: `worker`, `reviewer`, `scaffolder`.
- Helper agents: `security-auditor`, `codex-sync`.
- E2E smoke tests that run against compiled core without requiring a Claude Code session.
- GitHub Actions workflows for CI, build, release, and smoke testing.

### Changed
- R10 (protected directory deletion) is now parameter-driven (`protectedDirectories`), no-op when empty.
- R11 (API-key-in-command) is parameter-driven (`protectedEnvVarNames`), no-op when empty.
- All guardrail error messages are now in English and dynamically constructed from config.
- `harness-setup check` now references v3 agent names (`worker`/`reviewer`/`scaffolder`).
- State storage path unified to `.claude/state/harness.json` (JSON, not SQLite).

### Removed
- `better-sqlite3` dependency (native binary) replaced with pure JS JSON store.
- Project-specific agents (`script-tester`, `test-writer`) — see migration guide.
- Project-specific rule (`project-architecture.md`).

### Security
- Added explicit guidance on log sensitivity in `docs/en/security.md`.
- `.gitignore` template excludes `.claude/logs/`, `.claude/state/`, `.claude/worktrees/`.

[0.1.0]: https://github.com/ThomasEdwardYorke/claude-code-harness/releases/tag/v0.1.0
