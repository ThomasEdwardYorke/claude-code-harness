# Shipped Spec English Migration Plan

> **Maintainer-only record.** Tracks the incremental migration of shipped plugin spec from Japanese-dominant to English (or locale-neutral). Background: early development happened with a Japanese-speaking maintainer and a Japanese-context test-bed project, so many `commands/`, `agents/`, and `hooks/` files are Japanese-heavy. `CONTRIBUTING.md` §1.2 requires shipped spec to be English / locale-neutral for global plugin consumers.

## Scope

- **In scope** (must migrate to English):
  - `plugins/harness/agents/*.md`
  - `plugins/harness/commands/*.md`
  - `plugins/harness/.claude-plugin/plugin.json` (description fields)
  - `.claude-plugin/marketplace.json` (description fields)
  - `plugins/harness/core/src/hooks/*.ts` (user-visible strings / comments that explain behavior)
  - `plugins/harness/schemas/harness.config.schema.json` (description fields)
- **Out of scope** (may remain in Japanese):
  - `docs/ja/*.md` (Japanese-localized user documentation)
  - `docs/maintainer/**` (maintainer-only)
  - `CHANGELOG.md` (bilingual acceptable)
  - Commit messages / PR descriptions
  - Test fixtures using Japanese for ja/en compatibility verification

## Current State (2026-04-22)

Shipped spec is predominantly Japanese. English parts:
- `plugin.json` / `marketplace.json` description fields (English)
- `CONTRIBUTING.md` (English, newly added)
- `docs/en/*.md` (English localization)
- `generality.test.ts` (English-dominant, Japanese only in error messages to match spec pattern)

Japanese parts requiring migration:
- All `commands/*.md` (~13 files)
- All `agents/*.md` (6 files)
- `core/src/hooks/*.ts` section-header literals (e.g. `[assignment-table]` is already English, but some remain)
- Schema description fields (mixed)

## Migration Strategy

### Phase 1 — New-file English-only rule (immediate)

- Any **new** shipped spec file added from this session onward must be English-primary.
- Enforced manually via PR review (CONTRIBUTING §1.2) — CI enforcement is Phase 4.

### Phase 2 — Critical path migration (next session)

High-traffic files first (they affect the most users):
1. `commands/harness-work.md`
2. `commands/tdd-implement.md`
3. `commands/parallel-worktree.md`
4. `agents/worker.md`
5. `agents/reviewer.md`

Each migration: keep behavior identical, replace Japanese prose with English. Japanese-preferring consumers can read `docs/ja/` which will mirror the translated English.

### Phase 3 — Remaining shipped spec migration (follow-up sessions)

- Remaining `commands/` (8 files) and `agents/` (4 files)
- `schemas/harness.config.schema.json` `description` fields
- Hook source comments that explain behavior to Claude at runtime

### Phase 4 — CI enforcement (after Phase 2-3 mostly complete)

Once the critical path is migrated, add `generality.test.ts` series B-10 (locale check) to enforce English-only in shipped spec going forward. Files that are deliberately Japanese (like `docs/ja/`) would be under ALLOWLIST; files with pending migration get a time-bound exemption (`generality-exemption: B-10 — HARNESS-english-migration, until v0.4.0`).

## Exemption Handling During Migration

While migration is incomplete:
- Existing Japanese shipped spec is **tolerated** (CI does not block)
- New Japanese shipped spec is **rejected** at PR review (CONTRIBUTING §3)
- Each migrated file gets a release-cycle record in the Migration Log below

## Migration Log

| Date | File | Before | After | Commit |
|---|---|---|---|---|
| 2026-04-22 | `plugins/harness/core/src/hooks/pre-compact.ts` | `[Plans.md 担当表]` section header, `担当表` hardcode | `[assignment-table]` section header + config-driven markers | `e6a92b2` (partial) |
| 2026-04-22 | `plugins/harness/core/src/hooks/task-lifecycle.ts` | Japanese plans-reminder string | Config-driven reminder using `work.plansFile` | `e6a92b2` (partial) |
| 2026-04-22 (evening) | `plugins/harness/core/src/__tests__/index.test.ts` (NEW) | — (new file) | English-primary: describe / it titles, comments, fixture strings | `37ce15a` |
| 2026-04-22 (evening) | `plugins/harness/core/src/__tests__/content-integrity.test.ts` (§plugin.json / §marketplace.json / §install-project.sh / §harness doctor — 23 new assertions) | — (new sections) | English-primary section titles and assertion messages | `8751f2d` + `9b5e637` |
| 2026-04-22 (evening) | `plugins/harness/core/src/config.ts` (§ToolingConfig / §ReleaseConfig / §QualityGatesConfig / §WorktreeConfig / §TddEnforceConfig / §CodeRabbitConfig) | — (new interfaces) | English-primary doc comments | `5d22999` + `c17352d` |
| 2026-04-22 (evening) | `plugins/harness/schemas/harness.config.schema.json` (§tooling / §release — 2 new sections) | — (new sections) | English-primary `description` fields | `c17352d` |
| 2026-04-22 (evening) | `plugins/harness/.claude-plugin/plugin.json` (commands / agents / hooks declarations, expanded description) | Brief English description | Expanded English description listing the 6-agent / 12-command / 10-hook-event composition | `8751f2d` |
| 2026-04-22 (evening) | `.claude-plugin/marketplace.json` (allowCrossMarketplaceDependenciesOn, expanded description) | Minimal English | Expanded English with Codex companion note | `8751f2d` |
| 2026-04-22 (evening) | `README.md` (§Optional companion / §Verifying the install) | (no such sections) | English-primary sections | `9b5e637` |
| 2026-04-22 (evening) | `scripts/install-project.sh` (`--with-codex` flag + help block + skip-note) | English-primary | Still English-primary, extended text for new opt-in | `9b5e637` |
| 2026-04-22 (evening) | `plugins/harness/bin/harness` (`cmdDoctor` expansion) | Bilingual English/Japanese labels | Kept English label wording for new lines (`project security checklist`, `plans file`, `project skill dir`, `user overlays`) — consistent with pre-existing English labels | `9b5e637` |

**Phase 1 rule compliance statement (2026-04-22 evening session)**: No Japanese prose was introduced into shipped spec during this session. Changes to pre-existing Japanese-dominant files (`plugins/harness/commands/harness-setup.md`, `plugins/harness/agents/worker.md`) only touched localized sections in the same language as the surrounding text (Japanese), per the "incremental migration" rule. No new Phase-1-regression incurred.

## Open Questions

1. Should `docs/ja/` be auto-updated when `commands/*.md` English migration completes? → Decision needed: mirror manually vs. generate from canonical English via a docs pipeline.
2. What's the migration cutoff version? → Revised (as of v0.2.0 release, 2026-04-23): complete Phase 1 by v0.2.0 (DONE), Phase 2 by v0.4.0, Phase 3 by v0.5.0, Phase 4 CI-enforced from v0.4.0. Phase 1 compliance applies in v0.2.0; Phase 2 critical-path migration (harness-work / tdd-implement / parallel-worktree / worker / reviewer) is deferred to v0.4.0.
3. How to handle comments in `core/src/hooks/*.ts`? → Proposed: code comments that only maintainers read may remain bilingual; doc-strings that surface in LSP / editor tooltips should be English.

## References

- `CONTRIBUTING.md` Section 1.2 (separation principle — locale-neutral shipped spec)
- `CONTRIBUTING.md` Section 3 (language check item in Self-Check Checklist)
- Codex adversarial review [C-3] 2026-04-22 (triggered this migration plan)
