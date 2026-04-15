# Claude Code Harness — standalone template

This directory contains files you can copy into a new project if you don't
want to use the plugin distribution path.

## What to copy

```
.claude/CLAUDE.md.tmpl              → <your-project>/CLAUDE.md
.claude/harness.config.json.tmpl    → <your-project>/harness.config.json
.claude/settings.local.json.tmpl    → <your-project>/.claude/settings.local.json
.claude/rules/                      → <your-project>/.claude/rules/
.gitignore                          → merge into your project's .gitignore
```

Then edit the `{{PROJECT_NAME}}` / `{{PROJECT_DESCRIPTION}}` /
`{{HARNESS_VERSION}}` placeholders.

## Recommended: use the plugin instead

For most projects, installing the plugin is simpler:

```bash
claude plugin marketplace add ThomasEdwardYorke/claude-code-harness
claude plugin install harness@claude-code-harness --scope project
```

See [../docs/en/installation.md](../docs/en/installation.md).
