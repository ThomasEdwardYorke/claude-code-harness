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

Exemption mechanism (Phase ε unified grammar — see [CONTRIBUTING §3.1](../../CONTRIBUTING.md#31-unified-exemption-grammar)):
- File-level (MD): `<!-- generality-exemption: <pattern-ids> | <issue-key> | <expiry> | <reason> -->`
- File-level (TS): `/* generality-exemption: <pattern-ids> | <issue-key> | <expiry> | <reason> */`
- Line-level: `// generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture` (short form `// generality-exemption: B-1` 可)

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

The following were identified during audit but postponed to subsequent sessions to limit scope per approved Q-plan. **Phases γ / δ / ε / ζ have since been implemented in the 2026-04-22 follow-up session — the "Status as of 2026-04-22 evening" entries below track progress.**

### Phase γ (config 基盤整合) — ✅ Done (2026-04-22)
- ~~Wire `work.plansFile` / `worktree.*` / `tddEnforce.*` / `codeRabbit.*` through loader / template / init~~
- Implemented in commit `5d22999` (feature/model-b-evolution): `HarnessConfig` interface extended with `WorkConfig` (maxParallel / labelPriority / criticalLabels / testCommand / qualityGates / failFast), `WorktreeConfig`, `TddEnforceConfig`, `CodeRabbitConfig`, `QualityGatesConfig`. `mergeConfig` deep-merges `work.qualityGates` an extra layer so per-gate overrides do not clobber the siblings. 10 new `config.test.ts` assertions lock in defaults and override semantics.

### Phase δ (full CONFIG-IZE) — ✅ Mostly done (2026-04-22)
- ~~`work.assignmentSectionMarkers` for `pre-compact.ts` `担当表` keyword~~ — was already wired in Phase β.
- ~~`work.handoffFiles`~~ — was already wired in Phase β.
- ~~`work.changeLogFile` for optional change-log reference~~ — was already wired in Phase β.
- ~~`tooling.pythonCandidateDirs` (default `["src", "app"]`, `backend/` removed from default — requires test-bed side to add explicit override)~~ — implemented in commit `c17352d` via `ToolingConfig` interface + `resolvePythonCandidateDirs()` with defensive narrow (fail-open on shape-invalid config). parts-management side added `"tooling": {"pythonCandidateDirs": ["backend"]}` override in commit `f289c0e` (feature/harness-model-b).
- ~~`release.strategy` / `release.integrationBranch` / `release.testCommand` for branch model~~ — implemented in commit `c17352d` via `ReleaseConfig` interface (adds `productionBranch` field too — the default `main` branch name). Three-branch default matches `/branch-merge` + `/harness-release` spec; two-branch trunk-style projects flip `strategy: "two-branch"`.
- _Still pending_: `worktree.sharedSidecarPaths` schema addition (not needed for current test-bed setup, deferred until a second project requires it).

### Phase ε (full RELOCATE to project-local skill) — ✅ Done (2026-04-22)
- ~~Create `<test-bed>/.claude/skills/<project-name>-local-rules/` scaffold with references/~~ — done on the parts-management side in commit `c1383fe`: `.claude/skills/parts-management-local-rules/SKILL.md` + `references/security-checklist.md` + `references/review-runbook.md` + `references/pipeline-check.md`. `.gitignore` now promotes `.claude/skills/**` to tracked (other `.claude/*` stay local).
- ~~Move WeasyPrint / defusedxml / Excel checklist out of `security-auditor.md` into `security-checklist.md` under the local skill~~ — the plugin-side `security-auditor.md` was already stack-neutralised in Phase β; the project-side checklist materialises in `references/security-checklist.md`. parts-management `harness.config.json` points at it via `security.projectChecklistPath`.
- ~~Move create_script / protected-data runbook into `review-runbook.md`~~ — the predecessor-project references were already scrubbed in Phase β; the generic review red-flag catalogue now lives in `references/review-runbook.md` on the project side.
- ~~Remove `--test-pipeline` from `harness-work.md` entirely~~ — **Done** (Phase λ, 2026-04-22 "strongest harness" session). 6 locations removed from `harness-work.md` (argument-hint / mode table / pseudocode × 2 / options table / 独立 subflow section) + `description` / `description-ja` frontmatter からも `/test-pipeline` 除去。`generality.test.ts` に B-2f guard pattern 追加で再導入を CI で blocking。歴史的記述 (v3/v2/v1 の `test-pipeline` 言及) は経緯保持のため残置 + v4.2 changelog エントリ追記。Replacement は test-bed 側の `.claude/skills/<project>-local-rules/references/pipeline-check.md` で供用済 (Phase ε で整備)。

### Phase ζ (install) — ✅ Done (2026-04-22)
- ~~`install-project.sh` Codex auto-install → opt-in (`--with-codex`)~~ — implemented in commit `9b5e637`. `WITH_CODEX=0` default, `--with-codex` / `--help` / `-h` flag parsing, explicit note when skipping. Re-runs are idempotent.
- ~~README "optional companion" section~~ — done in the same commit; `README.md` now carries "Optional companion: `openai-codex`" (with a has-Codex / no-Codex truth table) and "Verifying the install — `harness doctor`".
- ~~`harness doctor` detects missing Codex~~ — expanded in the same commit. `cmdDoctor` now reports (a) core build, (b) Codex presence with opt-in hint, (c) `harness.config.json` resolution / parse status, (d) `security.projectChecklistPath` file existence, (e) `plansFile` + `handoffFiles` reachability, (f) `.claude/skills/` project-local skill dir, (g) `~/.claude/{skills,commands,agents}/` user-level overlays. content-integrity locks down 9 assertions on both the shell script and the CLI source.

### New phases deferred to future sessions (2026-04-22 evening)

These surfaced from Codex Worker A + B's official-docs audit and are too large for this follow-up session:

- **Phase η (hooks)** — **Partially done** (2026-04-22, commit `9c7c706` + Round-1 review followup): `WorktreeRemove` is now registered (non-blocking observability, hook event coverage 10 → 11/27), and `WorktreeCreate` has a route/scaffold handler wired but is **intentionally not registered** in `hooks.json` (Phase κ-2 deferred — the event replaces default `git worktree` creation with an `absolute-path-on-stdout` protocol, so an observability-only registration would break worktree creation). Still missing: `UserPromptSubmit` / `UserPromptExpansion` / `PostToolUseFailure` / `InstructionsLoaded` / `CwdChanged` / `FileChanged`, plus the remaining events enumerated in `research-anthropic-official-2026-04-22.md` § 3 (Hooks).
- **Phase θ (hook output schema)** — `HookResult` only supports `decision` / `reason` / `systemMessage`. Spec supports 11 additional fields (`continue`, `stopReason`, `suppressOutput`, `updatedPermissions`, `updatedInput`, `retry`, `watchPaths`, `worktreePath`, `updatedMCPToolOutput`, `action`, `content`).
- **Phase ι (commands → skills rename)** — Per Codex B recommendation, `commands/*.md` → `skills/<name>/SKILL.md` to get automatic `/harness:<name>` namespacing and avoid same-name conflict with project-local commands. Breaking change; needs user sign-off.
- **Phase κ (isolation frontmatter)** — ✅ **Done (guard-test approach, 2026-04-22)**. 公式 docs 調査 (`docs/maintainer/research-subagent-isolation-2026-04-22.md`) により「`/parallel-worktree` が手動 worktree 管理するため worker 等に `isolation: worktree` を付けると二重 worktree 干渉リスク」を確認。全 6 agent に `isolation` を付けない現状方針を `content-integrity.test.ts` の Phase κ guard で確定 (12 tests = 6 agent × 2 assertion: 未設定 + 値は `"worktree"` のみ)。Phase κ-2 (WorktreeCreate/Remove hook 協調設計 + isolation 付与) は Phase η と一緒に検討する残件として Phase 2-3 スコープに繰り越し。
- **Phase λ (remove `--test-pipeline`)** — ✅ **Done (2026-04-22)**. 詳細は上記 Phase ε の "Remove `--test-pipeline`" 項目を参照。

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
