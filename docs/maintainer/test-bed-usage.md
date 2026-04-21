# Test Bed Usage Log

> **Maintainer-only record.** This file lives under `docs/maintainer/` (excluded from the public plugin surface). Every harness plugin feature derived from a test-bed project must be recorded here per `CONTRIBUTING.md` Section 5.

## Purpose

A test-bed project is used as a proving ground for new harness plugin features. This file records every experiment, the reusability judgment (R1/R2), and the extraction decision.

**Principle**: A test bed is a proving ground, not a specification. The plugin ships only what passes R1 and R2 (see CONTRIBUTING.md Section 5).

---

## Rules

- **Correct order (R-Flow)**: test-bed local → validate → reusability gate → port to plugin → record here → add generality tests → merge
- **Forbidden order**: plugin-first → verify in test-bed
- Never port project-local business logic to plugin core
- R1 and R2 must be evaluated and recorded for every portation

---

## Experiment Entry Template

```markdown
### YYYY-MM-DD — <feature name>

- **Test-bed repo**: <owner>/<repo>
- **Test-bed commit / branch**: <commit hash or branch>
- **Local-only implementation path**: `.claude/skills/<name>/` or `CLAUDE.md`
- **Hypothesis**: <what behavior was tested>
- **Observed benefit**: <what improved in the test bed>
- **Reusable invariant extracted**: <the generic mechanism, stripped of project nouns>
- **Project-local assumptions rejected**: <what was left out and why>
- **Config knobs introduced in plugin**: <new harness.config.json keys>
- **generality.test.ts assertions added**: <describe block and assertion text>
- **Decision**: `local-only` | `generalize-next` | `rejected`
- **Follow-up issue**: HARNESS-<N> or `none`
```

---

## Migration Log

Each item ported from test-bed to plugin:

| Date | Feature | Removed project-local values | Added config keys | Added test assertions | Release |
|---|---|---|---|---|---|
| 2026-04-22 | Generality guardrail + 119-leak cleanup | `feature/new-partslist`, `upper_script`, `create_script_from_*`, `protected-data/`, `全9ジャンル`, `script_generate`, `Phase N 申送 M-NN`, `Round N`, `A-N rM`, `CLAUDE.local.md`, `next-session-prompt.md`, `WeasyPrint`/`defusedxml`/`psycopg` mandated checklist, `Plans.md` hardcode in `pre-compact.ts`/`task-lifecycle.ts`, `担当表` hardcode in hooks, `PYTHONPATH=. pytest` universal default | `work.plansFile`, `work.assignmentSectionMarkers`, `work.handoffFiles`, `work.changeLogFile`, `security.projectChecklistPath`, `security.enabledChecks` | `generality.test.ts` 10 series (B-1..B-9), 941 assertions total; `content-integrity.test.ts` tracker-ID hygiene | v0.1.0 (unreleased) |
| 2026-04-22 (evening) | Phase γ — schema-aligned typed config surface | `work.maxParallel`/`.labelPriority`/`.criticalLabels`/`.testCommand`/`.qualityGates`/`.failFast`, `worktree.*`, `tddEnforce.*`, `codeRabbit.*` were schema-only and not surfaced in typed config | `WorkConfig` (6 new fields), `QualityGatesConfig`, `WorktreeConfig`, `TddEnforceConfig`, `CodeRabbitConfig`, union `WorktreeEnabledMode` / `PseudoCoderabbitProfile` | `config.test.ts` §Phase γ (10 assertions covering defaults + deep-merge of `work.qualityGates`) | v0.1.0 (unreleased) |
| 2026-04-22 (evening) | Phase δ — `tooling.pythonCandidateDirs` + `release.*` | Test-bed-specific hardcode array `["backend","src","app"]` in `subagent-stop.ts`; branch-name hardcode (`dev` / `main`) in release / branch-merge docs | `tooling.pythonCandidateDirs` (default `["src","app"]`, backend/ opt-in), `release.strategy`, `release.integrationBranch`, `release.productionBranch`, `release.testCommand` | `config.test.ts` §Phase δ (5 assertions); `hooks.test.ts` §detectAvailableChecks rewritten for stack-neutral default (9 tests); `content-integrity.test.ts` for worker.md + subagent-stop.ts new shape | v0.1.0 (unreleased) |
| 2026-04-22 (evening) | plugin.json / marketplace.json manifest explicit declaration | Implicit directory-discovery reliance; missing cross-marketplace dep | `plugin.json.commands[]` (12), `plugin.json.agents[]` (6), `plugin.json.hooks`; `marketplace.json.allowCrossMarketplaceDependenciesOn: ["openai-codex"]` | `content-integrity.test.ts` §plugin.json (4) + §marketplace.json (3) = 7 assertions | v0.1.0 (unreleased) |
| 2026-04-22 (evening) | Phase ζ — Codex companion opt-in + harness doctor overlay visibility | `install-project.sh` forced Codex install; `harness doctor` only reported Codex presence, not the rest of the overlay stack | Behavior change (`install-project.sh --with-codex` flag); `harness doctor` surfaces `harness.config.json` parse + `security.projectChecklistPath` resolution + `work.plansFile`/`handoffFiles` reachability + `.claude/skills/` presence + user-level `~/.claude/{skills,commands,agents}/` overlays | `content-integrity.test.ts` §install-project.sh (5) + §harness doctor (5) = 10 assertions | v0.1.0 (unreleased) |

---

## Rejected Cases

Items that failed R1 or R2 and must stay project-local:

| Date | Feature | Reason | Stays where |
|---|---|---|---|
| 2026-04-22 | Predecessor `script_generate` runbook (`create_script_from_*`, `protected-data/`, `全9ジャンル` CSV checks) | Fails R1 (stack-specific business workflow); fails R2 (business logic that cannot be meaningfully generalized) | test-bed project's own `CLAUDE.md` / `.claude/skills/<project-name>-local-rules/references/review-runbook.md` |
| 2026-04-22 | Python Web stack security checklist (`WeasyPrint SSRF`, `defusedxml` XXE, Excel Zip Bomb, `psycopg.sql.Identifier`, CSRF signed double-submit) as mandatory | Fails R1 (stack-specific); fails R2 (library-coupled business logic) | test-bed project's `.claude/skills/<project-name>-local-rules/references/security-checklist.md` (to be created); plugin retains stack-neutral abstractions only |
| 2026-04-22 | `--test-pipeline` subflow with `protected-data/` CSV schema validation | Fails R1 (depends on predecessor project's data pipeline); fails R2 (business pipeline logic) | test-bed project's `scripts/check-pipeline.sh` + `.claude/skills/<project-name>-local-rules/references/pipeline-check.md` (deferred to Phase ε in next session) |

---

## Retrospective: Model B Evolution (2026-04-20 → 2026-04-22)

This is the first formal entry — a retrospective of the Model B evolution work that surfaced the need for this record.

- **Test-bed repo**: (the parts-management reference project used during Model B development)
- **Test-bed branch**: Phase 1 integration branch
- **Local-only implementation path**: test-bed repo's `.claude/rules/*.md` + gitignored `CLAUDE.local.md`
- **Hypothesis**: Harness can support both Model A (single Claude + Task subagent) and Model B (independent Claude per worktree) workflows, validated on a real development project
- **Observed benefit**: Model B enabled isolated TDD loops per feature worktree with tmux orchestration; PreCompact / SubagentStop / TaskCreated hooks reduced context loss at compaction boundaries
- **Reusable invariant extracted**:
  - Hook framework (PreCompact / SubagentStop / Stop / TaskCreated / TaskCompleted)
  - Guardrail rules R01-R13
  - Parallel worktree orchestration via `/parallel-worktree`
  - CodeRabbit integration (`/coderabbit-review` + `/pseudo-coderabbit-loop`)
  - TDD-enforced implementation loop (`/tdd-implement` v2)
  - Configurable `work.*` / `security.*` / `release.*` fields for project-local overrides
- **Project-local assumptions rejected**:
  - `feature/new-partslist` branch name (generalized to `feature/my-feature`)
  - `Plans.md` / `担当表` / `CLAUDE.local.md` / `.docs/next-session-prompt.md` hardcode (configuration-driven instead)
  - Python Web stack (`WeasyPrint`, `defusedxml`, `psycopg`) mandatory checklists (stack-neutral abstractions + project-local skill)
  - Predecessor script_generate project's business runbook (relocated to project-local)
- **Config knobs introduced in plugin** (this session):
  - `work.plansFile`, `work.assignmentSectionMarkers`, `work.handoffFiles`, `work.changeLogFile`
  - `security.projectChecklistPath`, `security.enabledChecks`
  - (Already existed: `work.testCommand`, `work.qualityGates`, `worktree.*`, `tddEnforce.*`, `codeRabbit.*`)
- **generality.test.ts assertions added**:
  - Series B-1 (specific branch names) × all shipped md/ts files
  - Series B-2 (predecessor API names) × all shipped md/ts files
  - Series B-3 (internal tracker IDs, 4 sub-series a/b/c/d) × shipped + test describes
  - Series B-4 (project-local required refs) × all shipped md/ts files
  - Series B-5 (stack-specific mandatory checklists) × agents
  - Series B-6 (Plans.md file-name hardcode in core)
  - Series B-7 (Japanese UI keyword hardcode in core hooks)
  - Series B-8 (absolute developer paths) × all shipped md/ts files
  - Series B-9 (Python stack commands as universal defaults)
- **Decision**: `generalize-next` — reusable parts ported, business-specific parts relocated to test-bed project-local
- **Follow-up issue**: HARNESS-generality-migration (track remaining Phase γ-ζ work)

---

## Open Follow-up Items

Recorded for future sessions (maintainer-only, not part of shipped plugin spec).

### ✅ Resolved in 2026-04-22 evening session

1. ~~Create actual `<test-bed>/.claude/skills/<project-name>-local-rules/` scaffold with references/~~ — **Done** (Phase ε, parts-management commit `c1383fe`). Scaffold contains `SKILL.md` + 3 references (`security-checklist.md`, `review-runbook.md`, `pipeline-check.md`). `.gitignore` updated on the test-bed to promote `.claude/skills/**` to tracked.
2. ~~Implement full CONFIG-IZE of deferred items (`worktree.*` wiring, `release.*` wiring, `tooling.pythonCandidateDirs`)~~ — **Done** (Phase γ/δ, plugin commits `5d22999` + `c17352d`). All schema fields are now surfaced via typed `HarnessConfig` with defensive narrow in consumers.
3. ~~Empty out `workMode.bypass*` semantics disagreement (Codex adversarial review M-6)~~ — **Done** (plugin commit `477397c`). schema / config.ts / tests were already aligned; the gap was docs. `harness-setup.md` now carries a dedicated subsection with the per-flag effect + non-effect (R10 / main protection intact).

### 🟡 Still open

4. English migration of shipped spec (Codex adversarial review C-3) — see `english-migration.md`. Phase 1 (new-file English-only rule) is now compliance-verified per the migration log; Phase 2 (critical-path migration of `harness-work.md` / `tdd-implement.md` / `parallel-worktree.md` / `worker.md` / `reviewer.md`) and Phase 3 (remaining files) remain deferred.

### 🆕 New follow-ups surfaced by the 2026-04-22 evening Codex Worker A + B official-docs audit

5. **Phase η — 17 unimplemented hook events.** Per `research-anthropic-official-2026-04-22.md` (Codex Worker A, Top 5 finding #1): harness handles 10 of 27 Claude Code hook events. Missing: `WorktreeCreate` / `WorktreeRemove` / `UserPromptSubmit` / `UserPromptExpansion` / `PostToolUseFailure` / `InstructionsLoaded` / `CwdChanged` / `FileChanged`, plus 9 others. `WorktreeCreate` is especially valuable as a workaround for open issue `anthropics/claude-code#28041` (`.claude/` not inherited by `--worktree`).
6. **Phase θ — `HookResult` field coverage.** Per Worker A Top 5 #2: `HookResult` only supports `decision` / `reason` / `systemMessage`. Spec supports 11 more fields (`continue`, `stopReason`, `suppressOutput`, `updatedPermissions`, `updatedInput`, `retry`, `watchPaths`, `worktreePath`, `updatedMCPToolOutput`, `action`, `content`). Breaking-change judgment required per field.
7. **Phase ι — `commands/` → `skills/` namespace migration.** Per Worker B Top 5 #1: shipping commands in `commands/*.md` puts them in the global namespace; migrating to `skills/<name>/SKILL.md` yields automatic `/harness:<name>` namespacing. Breaking change; needs explicit user sign-off before merging.
8. **Phase κ — `isolation: worktree` agent frontmatter.** Per Worker A §1.3 gap: `worker`, `reviewer`, `security-auditor` can opt into worktree isolation declaratively. Aligns with the harness's parallel-worktree pitch.
9. **Phase λ — Remove `--test-pipeline` subflow** from `harness-work.md` per Q-4 DELETE decision carried over from leak-audit. Project-local replacement is already in place via `pipeline-check.md`.
