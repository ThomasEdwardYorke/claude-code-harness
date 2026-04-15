# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.1.0]: https://github.com/OWNER/claude-code-harness/releases/tag/v0.1.0
