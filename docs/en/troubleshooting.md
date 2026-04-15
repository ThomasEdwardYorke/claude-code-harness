# Troubleshooting

## `harness check` reports MISSING

Run `npm run build` inside `plugins/harness/core`. The dispatcher needs
`core/dist/index.js` to exist.

## Hooks don't fire

1. `claude plugin list --json` — is `harness@claude-code-harness` enabled?
2. `claude --plugin-dir plugins/harness` — can the plugin load at all?
3. Check `$CLAUDE_PLUGIN_ROOT` inside a hook (run `harness doctor`). If it
   doesn't end with the plugin directory, something is wrong with your
   Claude Code install.

## Permissions prompt keeps firing

Add the specific Bash pattern to `.claude/settings.local.json:permissions.allow`
in your project. For broad relaxation, use `workMode.bypassRmRf` in
`harness.config.json`, which bypasses R04/R05 at the rule level instead of
the permission layer.

## Everything is getting blocked

Check your `harness.config.json`:

- `protectedDirectories` containing `/` would match everything
- `protectedEnvVarNames` containing short common tokens will cause false
  positives
- `protectedFileSuffixes` containing just `"."` would match every file

Defaults are safe. The debugging script:

```bash
bin/harness rules test "some bash command here"
```

tells you which rule fires and why.

## Upgrading Node

The harness targets Node 18+. `better-sqlite3` is no longer a dependency,
so you can upgrade Node freely without rebuilding native addons.

## Tampering detector is too loud

Set `tampering.severity` to `"approve"` (default — warn only) or disable
tampering in plugin hooks. Authoring an `ask` or `deny` severity is
recommended in CI and automation contexts.

## Codex plugin version drift

`codex-sync` auto-detects the installed version. Run `harness doctor` —
if it reports `codex plugin: not installed`, run `claude plugin install
codex@openai-codex`. Pin a specific version in
`harness.config.json:codex.pluginRoot` if needed.
