# Claude Code Harness

A portable, TypeScript-powered guardrail and agent harness for [Claude Code](https://claude.com/claude-code).

## What this gives you

- **13 guardrail rules** (R01–R13) that block dangerous operations: `sudo`, `rm -rf`, force-push, `curl | bash`, `.env` leakage, and more. Configurable via `harness.config.json`.
- **3 general-purpose agents**: `worker` (implement + self-review + verify + commit), `reviewer` (read-only multi-angle review), `scaffolder` (docs + state sync). Plus `security-auditor` and `codex-sync` helpers.
- **5 verb skills**: `/harness-plan`, `/harness-work`, `/harness-review`, `/harness-release`, `/harness-setup`.
- **Zero native dependencies** in v0.1.0 (pure JS JSON state store) — works on macOS, Linux, and Windows without `npm install` native rebuilds.

## Installation

```bash
claude plugin marketplace add <owner>/claude-code-harness
claude plugin install harness@claude-code-harness --scope project
```

Or for local development:

```bash
claude --plugin-dir /path/to/claude-code-harness/plugins/harness
```

Then in your project root:

```bash
# Inside Claude Code session
/harness-setup init
```

This creates a `harness.config.json` tailored to your project.

## Quick configuration

`harness.config.json`:

```json
{
  "projectName": "my-app",
  "language": "en",
  "protectedDirectories": ["training-data", "fixtures"],
  "protectedEnvVarNames": ["OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY"],
  "workMode": { "bypassRmRf": false, "bypassGitPush": false },
  "tampering": { "severity": "approve" }
}
```

## Documentation

- [Installation](./docs/en/installation.md)
- [Architecture](./docs/en/architecture.md)
- [Configuration](./docs/en/configuration.md)
- [Guardrails (R01–R13)](./docs/en/guardrails.md)
- [Agents](./docs/en/agents.md)
- [Commands](./docs/en/commands.md)
- [Development](./docs/en/development.md)
- [Migration](./docs/en/migration-from-v2.md)
- [Security](./docs/en/security.md)
- [Troubleshooting](./docs/en/troubleshooting.md)

Japanese: [日本語ドキュメント](./docs/ja/)

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

---

## Before publishing

Several docs and the `plugin.json` homepage/repository fields contain
`OWNER/claude-code-harness` as a placeholder. Run:

```bash
scripts/set-owner.sh my-github-user
```

to replace every occurrence with your real GitHub user or organization.
