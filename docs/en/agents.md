# Agents

## General-purpose (v3)

| Agent | Role | Tools |
|-------|------|-------|
| `worker`     | Implement → self-review → verify → commit | Read, Write, Edit, Bash |
| `reviewer`   | Read-only multi-angle review (code, plan, scope) | Read, Grep, Glob |
| `scaffolder` | Docs, state sync, project analysis | Read, Write, Edit, Bash |

## Helpers

| Agent | Role |
|-------|------|
| `security-auditor` | API-key leakage, injection risk, permission audit |
| `codex-sync`       | Synchronous wrapper around the Codex CLI companion (forces foreground mode to avoid the known background-hang bug in `codex-rescue`). Requires the `codex@openai-codex` plugin; errors immediately if absent. |
| `coderabbit-mimic` | Read-only CodeRabbit-style PR reviewer via Codex CLI. Used by `/pseudo-coderabbit-loop` to pre-review locally before triggering the real CodeRabbit. Requires `codex@openai-codex`; errors immediately if absent. |

## When to invoke which

- You want to **change code**: `worker`
- You want a **second opinion**: `reviewer`
- You want to **update docs / config / state**: `scaffolder`
- You want a **security-only pass**: `security-auditor`
- You want **Codex to do the work synchronously**: `codex-sync`
- You want a **CodeRabbit-style pre-review locally** (rate-limit hedge): `coderabbit-mimic` (typically via `/pseudo-coderabbit-loop`)

## Notes

- Agents inherit the CLAUDE.md and `harness.config.json` of the project.
- None of the bundled agents require project-specific configuration out of
  the box. If you need stricter rules (e.g. forbid writes to a particular
  directory), encode that via `harness.config.json:protectedDirectories`
  and R10 will enforce it for every agent.
