# Security

## Threat model

The harness is designed to stop:

- **Accidental destruction** of user data (rm -rf, force push, writes to
  `.env` / `.git` / private keys)
- **Leaking secrets** via shell commands that include API key names
- **Silent quality erosion** (skipped tests, removed assertions, CI
  `continue-on-error: true`) via the tampering detector

It is NOT designed to defend against a targeted attacker with shell
access. Guardrails are a speed bump for honest mistakes and automated
agents, not a substitute for OS-level isolation.

## Logs can contain prompt text

`.claude/logs/` may include prompt content and tool I/O. Treat this
directory like any other secret: keep it out of commits, archives, and
support bundles.

The bundled `template/.gitignore` excludes:

```
.claude/logs/
.claude/state/
.claude/worktrees/
harness.config.json.local
```

Make sure your project's `.gitignore` has equivalent entries. The
`harness init` helper appends them for you if they are missing.

## Reading secret files

R09 approves reads of files that look like secrets (e.g. `.env`,
`id_rsa`, `*.pem`) but attaches a `systemMessage` warning. This is
intentional — legitimate workflows sometimes need to verify a file
exists. If you need harder enforcement, add the file path to your project's
deny-list at the Claude Code `permissions` level.

## Workflow modes

- `$HARNESS_WORK_MODE=1` bypasses R04 (outside-project writes) and R05
  (`rm -rf` confirmation). Keep it off in shared automation.
- `$HARNESS_CODEX_MODE=1` is meant to activate when Codex is the actor.
  Use it together with `codex-sync` to make Codex the worker and Claude
  the PM.

## Reporting vulnerabilities

Open a private security advisory on GitHub. Please do not file a public
issue for vulnerabilities.
