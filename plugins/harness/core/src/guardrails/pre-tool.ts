/**
 * core/src/guardrails/pre-tool.ts
 * PreToolUse hook evaluator.
 *
 * Builds a RuleContext from the hook input, loaded harness config, and any
 * per-session work-state flags, then delegates to rules.ts.
 */

import { existsSync } from "node:fs";
import { loadConfigSafe } from "../config.js";
import { HarnessStore } from "../state/store.js";
import { defaultStatePath } from "../state/migration.js";
import { evaluateRules } from "./rules.js";
import type { HookInput, HookResult, RuleContext } from "../types.js";

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function resolveStatePath(projectRoot: string): string | null {
  const path = defaultStatePath(projectRoot);
  return existsSync(path) ? path : null;
}

/** Resolve the project root from hook input or environment. */
function resolveProjectRoot(input: HookInput): string {
  return (
    input.cwd ??
    process.env["HARNESS_PROJECT_ROOT"] ??
    process.env["PROJECT_ROOT"] ??
    process.cwd()
  );
}

function buildContext(input: HookInput): RuleContext {
  const projectRoot = resolveProjectRoot(input);
  const config = loadConfigSafe(projectRoot);

  let workMode =
    isTruthy(process.env["HARNESS_WORK_MODE"]) ||
    isTruthy(process.env["ULTRAWORK_MODE"]);
  let codexMode = isTruthy(process.env["HARNESS_CODEX_MODE"]);
  const breezingRole = process.env["HARNESS_BREEZING_ROLE"] ?? null;

  // Augment from work_state store if a session id and state file exist.
  const sessionId = input.session_id;
  if (sessionId !== undefined && sessionId !== "") {
    const statePath = resolveStatePath(projectRoot);
    if (statePath !== null) {
      try {
        const store = new HarnessStore(statePath);
        try {
          const state = store.getWorkState(sessionId);
          if (state !== null) {
            workMode = workMode || state.bypassRmRf || state.bypassGitPush;
            codexMode = codexMode || state.codexMode;
          }
        } finally {
          store.close();
        }
      } catch {
        // Fail open — config alone is enough to evaluate rules.
      }
    }
  }

  // Apply config.workMode defaults (can upgrade but not downgrade explicit env flags).
  if (config.workMode.bypassRmRf || config.workMode.bypassGitPush) {
    workMode = true;
  }

  return {
    input,
    projectRoot,
    workMode,
    codexMode,
    breezingRole,
    config,
  };
}

export function evaluatePreTool(input: HookInput): HookResult {
  const ctx = buildContext(input);
  return evaluateRules(ctx);
}
