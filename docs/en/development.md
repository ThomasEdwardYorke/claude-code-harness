# Development

## Local setup

```bash
git clone https://github.com/OWNER/claude-code-harness
cd claude-code-harness
npm install
npm run build
npm test
```

## Running tests

```bash
# From the repo root (uses the workspace)
npm test              # vitest run
npm run test:coverage # vitest run --coverage
npm run smoke         # node tests/e2e/smoke.test.mjs
```

Tests live in `plugins/harness/core/src/**/__tests__/` and are driven by
vitest. The e2e smoke test drives `core/dist/index.js` via stdin.

## Iterating on a rule

1. Add or edit the rule in `plugins/harness/core/src/guardrails/rules.ts`.
2. Add a test case in `plugins/harness/core/src/guardrails/__tests__/rules.test.ts`.
3. Run `npm test`. Fix until green.
4. `npm run build` to refresh `core/dist/`.
5. Run `npm run smoke` to verify the end-to-end wire works.

## Loading your working copy into Claude Code

```bash
claude --plugin-dir plugins/harness
# inside the session:
/reload-plugins
```

Changes to `core/src/` require `npm run build` before the session picks
them up. Changes to `agents/*.md` and `commands/*.md` are picked up on
`/reload-plugins`.

## Typecheck without building

```bash
npm run typecheck
```

## Adding a new subcommand to `harness` CLI

Edit `plugins/harness/bin/harness` (ES modules, no TypeScript). Keep it
dependency-free — it runs directly from whatever the user has installed.
