# Migration from v2 to v3 harness

## Breaking changes

1. **State store switched from SQLite to JSON.** The file `.harness/state.db`
   is no longer consulted. The new location is `.claude/state/harness.json`.
   Use `harness migrate` to carry over sessions / signals / work-state.
2. **Guardrail rules R10 and R11 are now parameterized.** The old
   `annotated_data` hard-coded block is gone. Populate
   `harness.config.json:protectedDirectories` instead. The old
   `OPENAI_API_KEY` hard-coded block is replaced by
   `harness.config.json:protectedEnvVarNames`; defaults already cover
   `OPENAI_API_KEY` along with several other common secret names.
3. **Agent names consolidated.**
   - `task-worker`, `error-recovery` → `worker`
   - `code-reviewer`, `plan-analyst`, `plan-critic` → `reviewer`
   - `doc-writer` → `scaffolder`
   - `script-tester`, `test-writer` → use `worker` directly (project-specific
     testers should be authored per project)
4. **`better-sqlite3` dependency removed.** CI no longer needs a C toolchain.

## Step-by-step

```bash
# 1. Make sure your v2 state is preserved
cp -R .claude .claude.v2.bak

# 2. Install the v3 plugin
claude plugin marketplace add ThomasEdwardYorke/claude-code-harness
claude plugin install harness@claude-code-harness --scope project

# 3. Migrate state
plugins/harness/bin/harness migrate

# 4. Initialize the new config
plugins/harness/bin/harness init

# 5. Populate protected lists (edit harness.config.json)
#    - protectedDirectories: datasets / training data / …
#    - protectedEnvVarNames: add any project-specific API key names

# 6. Verify
plugins/harness/bin/harness check
```

## Config mapping

| v2 | v3 |
|----|----|
| Hard-coded `annotated_data` in R10 | `harness.config.json:protectedDirectories` |
| Hard-coded `OPENAI_API_KEY` in R11 | `harness.config.json:protectedEnvVarNames` |
| `.claude/settings.local.json` hooks | Auto-installed by the plugin |
| `.harness/state.db` (SQLite) | `.claude/state/harness.json` (JSON) |
| `script-tester` agent | Per-project, not bundled |
| `test-writer` agent | Per-project, not bundled |
