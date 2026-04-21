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

Recorded for future sessions (maintainer-only, not part of shipped plugin spec):

1. Create actual `<test-bed>/.claude/skills/<project-name>-local-rules/` scaffold with references/
2. Implement full CONFIG-IZE of deferred items (`worktree.*` wiring, `release.*` wiring, `tooling.pythonCandidateDirs`)
3. Empty out `workMode.bypass*` semantics disagreement (Codex adversarial review M-6)
4. English migration of shipped spec (Codex adversarial review C-3) — see `english-migration.md`
