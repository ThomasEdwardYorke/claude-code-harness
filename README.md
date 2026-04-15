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

## Known notes (v0.1.0)

1. **If you fork this repository**, run
   `scripts/set-owner.sh <your-github-user>` to rewrite the owner in
   docs, schema, and `plugin.json` before publishing to your own
   marketplace. Review the diff with `git diff` before committing.
2. **Parallel build process**: the v0.1.0 implementation used a mixed
   strategy — Claude Code as the primary author plus three parallel
   Codex agents. Two of the three Codex jobs failed with a Bash
   permission issue on the host; the third (the `codex-sync` agent
   generalization) finished. Claude Code picked up the failed jobs and
   completed them directly. Keep this in mind when reproducing the
   build on a host where `codex-companion.mjs` cannot be spawned: fall
   back to direct in-session edits.
3. **State store concurrency**: the pure-JS JSON store in
   `plugins/harness/core/src/state/` is safe for single-process use.
   If you run `/breezing`-style parallel sessions against the same
   project, state writes can race. File locking (e.g.
   `proper-lockfile`) is planned for v0.2.0; until then, avoid
   simultaneous multi-session writes on the same project.
4. **`permission.ts` double-encoding**: the reviewer flagged a
   CRITICAL-tier design concern in
   `plugins/harness/core/src/guardrails/permission.ts` — the
   `PermissionResponse` is packaged via `systemMessage` and then
   unpacked again in `index.ts`. Current behaviour is correct and
   tested, but the layering is fragile. A refactor is scheduled for
   v0.2.0. Do not add new behaviour to that path until then.

Plan file `.docs/harness-portability-plan-20260416.md` captures the full
implementation log and the deferred list (14 residual MEDIUM/LOW/NIT
items).
