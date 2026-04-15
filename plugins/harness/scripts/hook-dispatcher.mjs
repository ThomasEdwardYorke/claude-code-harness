#!/usr/bin/env node
/**
 * plugins/harness/scripts/hook-dispatcher.mjs
 *
 * Thin ES-Modules shim invoked by hooks.json. Resolves the core entry point
 * via `${CLAUDE_PLUGIN_ROOT}` (the absolute install path of this plugin,
 * provided by Claude Code) and hands off to core/dist/index.js.
 *
 * Fail-open: any unexpected error prints an approve decision so that the
 * hook can never brick the user's session.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function failOpen(reason) {
  process.stdout.write(
    JSON.stringify({ decision: "approve", reason }) + "\n",
  );
  process.exit(0);
}

async function main() {
  const hookType = process.argv[2];
  if (!hookType) {
    failOpen("hook-dispatcher: missing hook type argument");
    return;
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    failOpen("hook-dispatcher: CLAUDE_PLUGIN_ROOT is not set");
    return;
  }

  const corePath = join(pluginRoot, "core", "dist", "index.js");
  if (!existsSync(corePath)) {
    failOpen(
      `hook-dispatcher: core build not found at ${corePath}. ` +
        "Did you run `npm install && npm run build` inside plugins/harness/core?",
    );
    return;
  }

  // Delegate argv so core/dist/index.js reads `process.argv[2]` correctly.
  process.argv[1] = corePath;
  await import(pathToFileURL(corePath).href);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  failOpen(`hook-dispatcher fatal: ${message}`);
});
