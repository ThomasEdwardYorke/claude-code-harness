# Installation

## Prerequisites

- Claude Code CLI
- Node.js >= 18

No native toolchain is required. This plugin has zero native dependencies.

## Install from the marketplace

```bash
claude plugin marketplace add ThomasEdwardYorke/cc-triad-relay
claude plugin install harness@cc-triad-relay --scope project
```

## Local development (no marketplace)

Point Claude Code directly at your working copy:

```bash
claude --plugin-dir /path/to/cc-triad-relay/plugins/harness
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
claude plugin uninstall harness@cc-triad-relay
```

`harness.config.json` stays in place — remove it manually if you no longer
want harness behaviour on that project.
