# Internal Tracker ID Migration Log

> **Maintainer-only record.** This file preserves the mapping between retired internal tracker ID formats (used during early development of this plugin in parallel with a test-bed project) and the generic issue keys that replaced them, per `CONTRIBUTING.md` Section 4.3.

## Purpose

Early development used test-bed-specific tracker labels (`Phase N 申送 M-NN`, `Round N`, `A-N rM Major-L`) inside shipped plugin files. These labels only made sense to maintainers familiar with the test-bed project's task management system. They have been removed from shipped spec in the 2026-04-22 cleanup.

This file records the **old-to-new mapping** so maintainers can still trace historical context when needed, without polluting the shipped plugin surface.

## Policy (from CONTRIBUTING.md §4)

- Internal tracker IDs are **allowed**: `commit messages`, `CHANGELOG.md`, `docs/maintainer/**`, PR descriptions, issue comments, release notes.
- Internal tracker IDs are **forbidden**: `commands/`, `agents/`, `hooks/`, `plugin.json`, `marketplace.json`, config schema defaults, user-facing examples, `test describe()/it()` titles, hook `statusMessage`.

## Migration Table

| Retired label format | Context | Replacement |
|---|---|---|
| `Phase N 申送 M-NN` | Test-bed project's phase-based task handoff identifiers | Generic issue key `HARNESS-<N>` in maintainer docs only |
| `Round N` | Internal development round counters | Describe the behavior, cite `CHANGELOG.md` if historical context is essential |
| `A-N rM Major-L` / `A-N rM Minor-L` / `A-N rM Trivial-L` | Codex adversarial review round IDs | Describe the finding's severity (Critical/Major/Minor/Trivial) and behavior, link maintainer review log if needed |
| `Major-N` / `Minor-N` / `Trivial-N` | Codex review severity suffixes | Use `Major severity` / `Minor severity` / `Trivial severity` as a description (no numeric suffix) |
| `C-N` / `M-N` / `m-N` (bare prefixes for Codex review items) | Individual review findings | Drop the prefix; describe the finding in-place |

## Retired Labels Inventory (as of 2026-04-22)

The following labels previously appeared in shipped plugin files and have been removed:

- `Phase 1 申送 M-12`, `Phase 1 申送 M-16`, `Phase 1 申送 M-17` (harness-work.md, parallel-worktree.md, tdd-implement.md, content-integrity.test.ts)
- `Phase 3 Codex レビュー申送 C-1 / M-2 / M-3 / m-2` (content-integrity.test.ts)
- `Round 4`, round-based narrative in worker.md, parallel-worktree.md (harness-work.md, parallel-worktree.md)
- `A-6 r2..r11` with associated `Major-N` / `Minor-N` / `Trivial-N` severity suffixes (throughout content-integrity.test.ts describe titles, pseudo-coderabbit-loop.md comments)
- `round 11 の Minor-1 指摘`, `r6 Minor-1 指摘`, `r7 Major-7` (content-integrity.test.ts comments)

## How to Handle New Referenced Items

If a maintainer needs to reference a historical review finding in a new commit:

1. **Do**: Use `HARNESS-<N>` format (e.g. `HARNESS-42`) tied to a GitHub issue
2. **Do**: Describe the behavior being referenced (e.g. `profile propagation regression`)
3. **Don't**: Re-introduce the retired labels into shipped spec

## CI Enforcement

`plugins/harness/core/src/__tests__/generality.test.ts` enforces this policy via series B-3 (a/b/c/d). Attempts to re-introduce retired label formats into shipped spec or test describe titles will cause CI to fail with a clear pointer to this file.
