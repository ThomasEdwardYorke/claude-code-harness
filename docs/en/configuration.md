# Configuration

All per-project tuning lives in a single file at the project root:

```
<project-root>/harness.config.json
```

An example with every field populated:

```json
{
  "$schema": "https://raw.githubusercontent.com/ThomasEdwardYorke/cc-triad-relay/main/plugins/harness/schemas/harness.config.schema.json",
  "projectName": "my-app",
  "language": "en",
  "protectedDirectories": ["datasets", "fixtures/gold"],
  "protectedEnvVarNames": [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "GITHUB_TOKEN",
    "GOOGLE_API_KEY",
    "MY_INTERNAL_TOKEN"
  ],
  "protectedFileSuffixes": [".env", ".secrets"],
  "codex": {
    "enabled": true,
    "pluginRoot": "${HOME}/.claude/plugins/cache/openai-codex/codex/1.0.3"
  },
  "workMode": {
    "bypassRmRf": false,
    "bypassGitPush": false
  },
  "tampering": {
    "severity": "approve"
  }
}
```

## Field reference

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `projectName` | `string` | `"my-project"` | Human-readable name used in messages |
| `language` | `"en" \| "ja"` | `"en"` | Preferred language for localized messages |
| `protectedDirectories` | `string[]` | `[]` (R10 disabled) | Directory names R10 refuses to delete via `rm`/`rmdir`/`unlink` |
| `protectedEnvVarNames` | `string[]` | standard secret names | Names R11 blocks from appearing in Bash commands |
| `protectedFileSuffixes` | `string[]` | `[".env"]` | Suffixes R13 blocks from `cat`/`head`/`tail`/etc. |
| `codex.enabled` | `boolean` | `false` | Whether the `codex-sync` agent is surfaced |
| `codex.pluginRoot` | `string?` | auto-detected | Absolute path to the installed codex plugin |
| `workMode.bypassRmRf` | `boolean` | `false` | If true, R05 is bypassed project-wide |
| `workMode.bypassGitPush` | `boolean` | `false` | Not currently enforced (reserved) |
| `tampering.severity` | `"approve" \| "ask" \| "deny"` | `"approve"` | Tampering detection response tier |

## Guardrail behaviour when a list is empty

- `protectedDirectories: []` → R10 is a complete no-op
- `protectedEnvVarNames: []` → R11 is a complete no-op
- `protectedFileSuffixes: []` → R13 is a complete no-op

This is the default installation: the harness ships with guardrails that do
NOT block a single thing until you enable them. That makes `claude plugin
install harness@cc-triad-relay` safe to run on any project without
surprise blocks.

## Where to put the file

`harness.config.json` is loaded from the project root. The project root is
one of, in order:

1. `input.cwd` passed by Claude Code on the hook
2. `$HARNESS_PROJECT_ROOT`
3. `$PROJECT_ROOT`
4. `process.cwd()`

A missing config file is not an error — `DEFAULT_CONFIG` is used instead.

A malformed config file is not an error either — the `loadConfigSafe`
wrapper (used by the hook path) returns `DEFAULT_CONFIG` on parse errors so
that a broken file never bricks the session.
