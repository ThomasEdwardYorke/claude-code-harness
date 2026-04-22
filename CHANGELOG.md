# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **`.coderabbit.yaml` (repository-level CodeRabbit config)** — 旧 Organization UI default 設定への silent fallback を廃し、repository 固有の path-based review instructions を明示化。10 path × harness 固有 rules (TypeScript core の Pure JS / zero native deps / Record<string, unknown> + narrow access / hooks blocking protocol; commands/agents frontmatter 4-field; hooks.json 11 events + `WorktreeCreate` 未登録保持; plugin.json / marketplace.json drift guard; scripts ES module + strict SemVer; `.github/workflows/*.yml` strict tag + `npm ci` + `body_path`; CHANGELOG exemption zone; docs generality policy)、profile `chill`、`auto_review.base_branches: ^main$` (regex)、`path_filters` で dist / .docs 除外、`knowledge_base.learnings.scope: local` / `web_search.enabled: true`。公式 schema `coderabbit.ai/integrations/schema.v2.json` 準拠。`content-integrity.test.ts` に 9 regression guards 追加 (language / profile / auto_review / 10 path / tone_instructions ≤250 文字 / **/* 汎用化原則 / knowledge_base+chat / path_filters / schema directive)。

## [0.2.0] - 2026-04-23

> **⚠️ Breaking change for v3/v4.1 users**: The `--test-pipeline` subflow has been fully removed from `harness-work.md`. If you relied on it, migrate to a project-local skill under `.claude/skills/<project>-local-rules/references/pipeline-check.md`. See `### Removed` below.

### Added

- **`session-handoff` skill `check` v2 follow-up (PR #6)** — explicit **full-context ingestion** in Gate 2 description (`Read` loads `current.md` + `backlog.md` in full to Claude context, report is summary-only but content is query-able), new **Anti-pattern #10** (re-reading after `check` is redundant, exception is compaction), new staleness signal **S-13** (backlog.md 150+ lines WARN / 200+ lines FAIL, using Gate 2 Context loaded rather than separate `wc -l`, classified under Gate 1 Structural), Output Template adds `Context loaded: <N> lines (current: {X}, backlog: {Y})` Summary field for re-bloat visibility, and `Forbidden` section compressed from 8 bullets to 3 categories (no information loss). S-01〜S-13 total, Anti-patterns total 10. 5 new regression guards in `content-integrity.test.ts` (full-context wording / Context-loaded line / re-read forbidden / S-13 threshold / 10th anti-pattern existence). Skill size kept under 500 lines per Anthropic SKILL.md guideline.
- **`session-handoff` skill `check` v2 — 3-gate architecture (structural + content comprehension + rehydration synthesis)**. The `check` subcommand was extended from a structural-only linter (v1) to a three-gate read-only verification: **Gate 1 Structural Integrity** (existence, line limits, priority labels, append-only, naming conventions — unchanged from v1), **Gate 2 Content Comprehension** (reads `current.md` / `backlog.md` via Read tool, extracts Latest state / Top priority / Quick-start / Pointers, cross-checks with `git log --oneline -5`), **Gate 3 Understanding Synthesis** (evaluates 12 staleness signals `S-01`〜`S-12` with severity, produces a 3-level rehydration verdict `PASS (Ready)` / `WARN (Partial)` / `FAIL (Stale)` plus the special `INIT_REQUIRED` for first-time use). Includes explicit read-only `Forbidden` section, edge-case handling (git / gh unavailable, large archive sampling, markdown corruption), and a bold-heading output template that avoids `##` collision with downstream regex scanners. 7 regression guards added to `content-integrity.test.ts` covering: 3-gate keyword presence / Read+current+backlog declaration / ≥6 staleness signals + 4-topic coverage / 3-level verdict / code-block template / forbidden-ops enumeration / edge-case coverage (first-time + git-unavailable both required independently).
- **`session-handoff` skill (workflow commands: 7 → 8; total commands: 12 → 13)** — new `plugins/harness/commands/session-handoff.md` codifies a 3-layer session-handoff document structure (`<project>-current.md` bird's-eye index + `<project>-backlog.md` + `<project>-design-decisions.md` + `archive/session-<YYYY-MM-DD>-<slug>.md` per-session records). The skill is fully generic (no project-specific names), and its structure aligns with Anthropic's official [MEMORY.md][anthropic-memory] and [SKILL.md][anthropic-skills] patterns. Subcommands: `init` / `update` / `archive` / `check`. Eight anti-patterns are enumerated up-front to prevent the common regression of accumulating session logs in a single monolithic prompt. 12 regression guards added to `content-integrity.test.ts` (10 skill-specific: existence, frontmatter 4-field compliance, strict `[word|word|...]` argument-hint regex, < 500 lines per Anthropic SKILL.md guideline, `<project>` placeholder presence, four-file layout mention, update-trigger section, anti-pattern section, Anthropic-official reference citation, Japanese-imperative `description-ja`; plus 2 harness-setup integration: command-list path-form check + plugin.json ↔ `harness-setup.md` workflow-skill-count consistency with VERB_SKILLS array drift guard).
- **Phase η P0-κ — `WorktreeRemove` hook handler (non-blocking observability)**. New `plugins/harness/core/src/hooks/worktree-lifecycle.ts` implements `handleWorktreeRemove`, registered in `plugins/harness/hooks/hooks.json` (dispatch arg `worktree-remove`, timeout 10s). Emits `additionalContext` covering `worktree_path` / `agent_type` / `agent_id` plus a `Plans.md` assignment-table reminder for the coordinator when the file contains known section markers. Payload values are newline-sanitised before being joined into the context to prevent fake-section injection. Fail-open via `loadConfigSafe` (shape-invalid config silently falls back to defaults). Spec basis: `docs/maintainer/research-anthropic-official-2026-04-22.md` § 3 (フック).
- **Phase η P0-κ — `WorktreeCreate` handler scaffold (intentionally NOT registered in `hooks.json`)**. `handleWorktreeCreate` is exported and wired through `route()` / `main()` in `core/src/index.ts` so that Phase κ-2 can drop in a protocol-compliant blocking implementation (stdout absolute-path contract + real `git worktree` creation) without rewiring the dispatch layer. The handler returns `approve` with a scaffold-notice `additionalContext` and never writes stdout paths. Rationale: `WorktreeCreate` **replaces** Claude Code's default `git worktree` creation entirely; registering an observability-only hook would break worktree creation (see `docs/maintainer/research-anthropic-official-2026-04-22.md` § 3). A regression guard in `content-integrity.test.ts` asserts that `hooks.json` does NOT contain `WorktreeCreate` until Phase κ-2 ships. The handler's doc-comment now enumerates the concrete failure mode (JSON stdout unparseable as path → `worktreePath` empty → worktree creation fails) to deter future accidental promotion.
- **Phase η P0-κ regression guards** (`content-integrity.test.ts`, 5 tests): `hooks.json` must register `WorktreeRemove` and must NOT register `WorktreeCreate`; `worktree-lifecycle.ts` must export both handlers; context injection must use `additionalContext` (not `systemMessage`); the `WorktreeCreate` scaffold must self-identify with a **two-term combination** (`Phase κ-2`+`deferred` OR `scaffold`+`hooks.json 未登録`) to resist single-word false-positive matches.
- **Route-level integration tests for both hooks** (`index.test.ts`, 3 tests) and **handler unit tests** (`worktree-lifecycle.test.ts`, new file, 14 tests including empty-string, newline-injection, and CR/CRLF edge cases). New `it` / `it.each` blocks added across the three-commit Phase η P0-κ series total 22 (net, across 3 test files). The project-wide vitest case count (which expands `it.each` parametrisations from many earlier test files) moved from 1685 to 1760 across the series.
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

[Unreleased]: https://github.com/ThomasEdwardYorke/claude-code-harness/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ThomasEdwardYorke/claude-code-harness/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ThomasEdwardYorke/claude-code-harness/releases/tag/v0.1.0

[anthropic-memory]: https://code.claude.com/docs/en/memory
[anthropic-skills]: https://code.claude.com/docs/en/skills
