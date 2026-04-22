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
  // worktree-create は blocking hook protocol に従う: 成功 = raw absolute path を
  // stdout、失敗 = non-zero exit。dispatcher 段階で fail した場合も JSON を
  // stdout に流すと Claude Code がそれを path と誤認して worktree 作成に失敗する
  // (stdin 未読の handler でも、missing CLAUDE_PLUGIN_ROOT / dist 未 build 等の
  // dispatcher 層失敗が protocol-corrupt な success とみなされる)。
  // 該当 hook 種別では stderr に理由を書き exit 1 で明示 fail させる。
  const hookType = process.argv[2];
  if (hookType === "worktree-create") {
    process.stderr.write(`hook-dispatcher (worktree-create): ${reason}\n`);
    process.exit(1);
  }
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
