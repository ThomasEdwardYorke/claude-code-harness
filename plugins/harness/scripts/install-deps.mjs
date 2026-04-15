#!/usr/bin/env node
/**
 * plugins/harness/scripts/install-deps.mjs
 *
 * Placeholder for the "install runtime deps on first session" pattern
 * described in the Claude Code plugin docs. v0.1.0 has zero runtime
 * dependencies (pure JS JSON store), so this script is a no-op and is
 * kept as an extension point for v0.2.0+ when we may reintroduce a
 * native SQLite backend.
 */

process.stdout.write(
  JSON.stringify({
    decision: "approve",
    reason: "install-deps: no runtime dependencies in v0.1.0",
  }) + "\n",
);
process.exit(0);
