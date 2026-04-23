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

Or use the bundled helper script from any git checkout of this repo:

```bash
# Harness only (default — recommended baseline):
bash /path/to/claude-code-harness/scripts/install-project.sh

# Harness + Codex companion (opt-in, enables codex-sync / coderabbit-mimic):
bash /path/to/claude-code-harness/scripts/install-project.sh --with-codex
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

### Optional companion: `openai-codex`

The Harness ships stack- and LLM-neutral. Two of its agents —
`codex-sync` and `coderabbit-mimic` — shell out to the OpenAI
[Codex](https://github.com/openai/codex-plugin-cc) companion plugin to
run synchronous code review / pseudo-CodeRabbit flows. Without Codex
installed, invoking either of those two agents **errors immediately
with a clear, grep-able message** (they don't degrade gracefully —
they refuse to proceed). Every other agent, command, guardrail, and
hook works identically with or without Codex. **Installing Codex is
therefore optional**:

| Plugin installed | What works | What errors on invocation |
|------------------|------------|---------------------------|
| `harness` only (default) | All 13 guardrails, 12 verb commands, 4 agents (worker / reviewer / scaffolder / security-auditor), all lifecycle hooks | `codex-sync` fails fast with `ERROR: Codex plugin not found` and `coderabbit-mimic` fails with `ERROR: codex-companion.mjs not found.` — both hard errors that stop the agent before any work starts. Other agents and commands are unaffected. |
| `harness` + `codex` | Everything above **plus** Codex-powered synchronous second-opinion review (`codex-sync`) and local pseudo-CodeRabbit loop (`coderabbit-mimic`) | — |

`install-project.sh --with-codex` flips the opt-in; otherwise run
`claude plugin install codex@openai-codex --scope project` manually.
Verify with `harness doctor`, which reports:

```
codex plugin:        detected at ~/.claude/plugins/cache/openai-codex/codex
```

or

```
codex plugin:        not installed (optional — ...)
```

Re-install is a no-op if already present (idempotent).

### Verifying the install — `harness doctor`

```bash
harness doctor
```

Surfaces:

- Core build presence + mtime.
- Codex companion presence.
- `harness.config.json` location + parse status.
- Resolved project security checklist (from `security.projectChecklistPath`).
- Resolved plans file + handoff files.
- Project-local skill directory (`.claude/skills/`).
- User-level overlays (`~/.claude/{skills,commands,agents}/`) — useful
  when diagnosing which layer a skill / command came from.

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

## Known notes

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
   `proper-lockfile`) is a candidate for future releases; until then,
   avoid simultaneous multi-session writes on the same project.
4. **`permission.ts` double-encoding**: the reviewer flagged a
   CRITICAL-tier design concern in
   `plugins/harness/core/src/guardrails/permission.ts` — the
   `PermissionResponse` is packaged via `systemMessage` and then
   unpacked again in `index.ts`. Current behaviour is correct and
   tested, but the layering is fragile. Avoid adding new behaviour to
   that path until a refactor is completed in a future release.

Maintainer notes and implementation logs are kept under
`docs/maintainer/` (excluded from marketplace distribution). See
`CHANGELOG.md` for user-facing change history and `CONTRIBUTING.md` for
the plugin generality policy.
