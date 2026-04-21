# Leak Audit — 2026-04-22

> **Maintainer-only record.** This file lives under `docs/maintainer/` (excluded from the public plugin surface). It preserves the complete analysis and cleanup log for the project-local leak audit conducted on 2026-04-21/22.

## Executive Summary

A comprehensive audit during the Model B evolution work discovered **119 project-local leaks across 36 files** inside shipped plugin surface (`plugins/harness/`). The leaks originated from parallel development with a test-bed project (`parts-management`) and an older predecessor project (`script_generate`), whose specifics had been transplanted directly into plugin core instead of being extracted as reusable invariants.

Phase α introduced structural guardrails (`generality.test.ts`, `CONTRIBUTING.md`, PR template, `docs/maintainer/` separation) and Phase β cleaned up all detected leaks. All 323 generality assertions are GREEN; total 753 tests pass.

## Audit Methodology

- Two independent Codex agents (Worker + Reviewer) reviewed the plugin surface using grep + WebFetch against Anthropic plugin docs.
- 119 leak hits across 36 files were categorized into 5 severity buckets.
- Each leak was assigned one of 4 treatment strategies: DELETE / GENERALIZE / CONFIG-IZE / RELOCATE.

## Severity Breakdown

| Severity | Count | Treatment |
|---|---|---|
| CRITICAL (release-blocker for public plugin) | 2 | GENERALIZE + RELOCATE |
| MAJOR (clear user confusion) | 8 | GENERALIZE + CONFIG-IZE |
| MINOR (polish) | 5 | GENERALIZE + DELETE |
| INFO (safe as-is) | 5 | No change |

## Root Causes (5 structural factors)

1. **No documented separation principle** between plugin core and project-local customization.
2. **No distinction between example and specification** — project-specific values in JSON samples looked like authoritative settings.
3. **No static CI check** to block leaks at commit time.
4. **No physical separation** between shipped and maintainer-only documentation.
5. **No test-bed usage rule** preventing direct PoC-to-core promotion.

## Phase α — Guardrails (commit `3cfcfa2`)

### `generality.test.ts` (new, 323 assertions)

Blocklist with 5 series:
- **B-1** Specific branch names (`feature/new-partslist` etc.)
- **B-2** Predecessor project business terms (`upper_script`, `create_script_from_*`, `protected-data/`, `全9ジャンル`, `script_generate`)
- **B-3** Internal tracker IDs (`Phase N 申送 M-NN`, `Round N`, `A-N rM`)
- **B-4** Project-local required refs (`CLAUDE.local.md`, `next-session-prompt.md`)
- **B-5** Python web stack hardcoded as mandatory checklist (`psycopg`, `defusedxml`, `WeasyPrint`, `openpyxl`, `Tabulator`, `Y.js`)

Exemption mechanism:
- File-level: `<!-- generality-exemption: <pattern-id>, <reason> -->` (MD) / `/* generality-exemption: ... */` (TS)
- Line-level: `// generality-ok: <reason>` / `<!-- generality-ok: ... -->`

Scope:
- BLOCKLIST_TARGETS: `plugins/harness/agents/*.md`, `commands/*.md`, `core/src/hooks/*.ts`
- WARN_TARGETS: `core/src/__tests__/*.ts` (strict check for tracker IDs leaking into test describe)
- ALLOWLIST: `docs/maintainer/**`, `CHANGELOG.md`, `.github/**`, etc.

### Other guardrails

- `.github/pull_request_template.md` — 6-item Plugin Generality Check
- `CONTRIBUTING.md` — Sections 1-6 with official docs citations
- `docs/maintainer/` — physical separation of internal notes

## Phase β — Cleanup (commit `e6a92b2`)

### Series-by-series fix matrix

| Series | Files affected | Treatment |
|---|---|---|
| B-1 | `coderabbit-mimic.md`, `parallel-worktree.md` | GENERALIZE: branch sample → `main` / `feature/my-feature` / `feature/parent-integration` |
| B-2 | `harness-plan.md`, `harness-review.md`, `harness-work.md` | GENERALIZE: predecessor API refs → abstract `public API` / `CLAUDE.md 参照方式` |
| B-3 | All shipped commands + `content-integrity.test.ts` | DELETE: tracker IDs stripped (sed + python3 bulk-strip on test describe titles) |
| B-4 | `harness-work.md`, `parallel-worktree.md` | CONFIG-IZE: `CLAUDE.local.md` / `next-session-prompt.md` → `work.handoffFiles` / "プロジェクト固有ファイル (存在すれば)" |
| B-5 | `security-auditor.md` | GENERALIZE: Python web stack checklist → stack-neutral abstractions + `security.projectChecklistPath` pointer |

### Additional cleanups

- `worker.md` report template: `pytest/ruff/mypy` → `tests/lint/typecheck` (language-neutral)
- `README.md`: removed internal implementation log reference (`.docs/harness-portability-plan-20260416.md` → `docs/maintainer/` + `CHANGELOG.md`)
- `harness-work.md`: `Y.js 統合期` → `high-conflict collaboration phase`

## Decisions Deferred to Future Phases

The following were identified during audit but postponed to subsequent sessions to limit scope per approved Q-plan:

### Phase γ (config 基盤整合)
- Wire `work.plansFile` / `worktree.*` / `tddEnforce.*` / `codeRabbit.*` through loader / template / init (schema exists, wiring incomplete)

### Phase δ (full CONFIG-IZE)
- `work.assignmentSectionMarkers` for `pre-compact.ts` `担当表` keyword
- `work.handoffFiles` / `worktree.sharedSidecarPaths` schema addition
- `work.changeLogFile` for optional change-log reference
- `tooling.pythonCandidateDirs` (default `["src", "app"]`, `backend/` removed from default — requires test-bed side to add explicit override)
- `release.strategy` / `release.integrationBranch` / `release.testCommand` for branch model

### Phase ε (full RELOCATE to project-local skill)
- Create `<test-bed>/.claude/skills/<project-name>-local-rules/` scaffold with references/
- Move WeasyPrint / defusedxml / Excel checklist out of `security-auditor.md` into `security-checklist.md` under the local skill
- Move create_script / protected-data runbook into `review-runbook.md`
- Remove `--test-pipeline` from `harness-work.md` entirely (Q-4 selected DELETE); provide replacement as test-bed `scripts/check-pipeline.sh`

### Phase ζ (install)
- `install-project.sh` Codex auto-install → opt-in (`--with-codex`)
- README "optional companion" section
- `harness doctor` detects missing Codex

## Test Bed Policy (codified in CONTRIBUTING.md §5)

**R1 — Reusability gate**: Port to plugin only if behavior remains coherent after replacing project name, branch, layout, stack, locale.

**R2 — Business logic isolation**: Keep project-local: business nouns, file layouts, API names, handoff files.

**R-Flow (required order)**:
```
1. Implement in test-bed as project-local .claude/skills/*
2. Validate in real usage
3. Pass R1 + R2 reusability gate
4. Extract reusable invariant to plugin
5. Record in docs/maintainer/test-bed-usage.md
6. Add generality tests before merging
```

## Quality Verification Post-Cleanup

- All 753 tests pass (430 existing + 323 new generality)
- TypeScript typecheck clean
- Build OK
- `harness check` OK (all 10 commands + 6 agents)
- Phase α generality assertions green against cleaned-up Phase β state

## Follow-up Actions Required (Next Session)

1. `docs/maintainer/test-bed-usage.md` — empty skeleton needs content (first entry: the Model B evolution itself as retrospective R1/R2 analysis)
2. Consumer-side experimental `parts-management/.claude/skills/parts-management-local-rules/` scaffold for Phase ε preparation
3. Phase γ-δ-ε-ζ as outlined above
4. Review PR #1 CI result + CodeRabbit re-review after this Phase α+β push
5. Consider whether to merge PR #1 before or after Phase γ-ζ (risk/benefit per release gate)
