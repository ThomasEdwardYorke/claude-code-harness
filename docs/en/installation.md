# Installation

## Prerequisites

- Claude Code CLI
- Node.js >= 18

No native toolchain is required. v0.1.0 has zero native dependencies.

## Install from the marketplace

```bash
claude plugin marketplace add OWNER/claude-code-harness
claude plugin install harness@claude-code-harness --scope project
```

## Local development (no marketplace)

Point Claude Code directly at your working copy:

```bash
claude --plugin-dir /path/to/claude-code-harness/plugins/harness
```

Inside a session, run `/reload-plugins` to pick up edits.

## Initialize a project

```bash
/harness-setup init
```

This creates `harness.config.json`, copies `CLAUDE.md` if missing, and updates
`.gitignore` to exclude runtime state.

## Verify

```bash
/harness-setup check
/harness-setup doctor
```

Or from the shell:

```bash
plugins/harness/bin/harness check
plugins/harness/bin/harness doctor
```

## Uninstall

```bash
claude plugin uninstall harness@claude-code-harness
```

`harness.config.json` stays in place — remove it manually if you no longer
want harness behaviour on that project.
