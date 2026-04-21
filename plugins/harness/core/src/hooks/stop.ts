/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Reads project config via
 * `loadConfigSafe` so that merge defaults are honoured (partial
 * `work.qualityGates` overrides inherit the other gate defaults).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSafe } from "../config.js";

export interface StopInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  stop_hook_active?: boolean | undefined;
}

export interface StopResult {
  decision: "approve";
  additionalContext?: string;
}

export async function handleStop(
  input: StopInput,
): Promise<StopResult> {
  const projectRoot = input.cwd ?? process.cwd();

  // Keep the historical behavior of returning a bare approve when the
  // project has no `harness.config.json` at all — we don't want to
  // start emitting reminders for projects that never opted in.
  const configPath = resolve(projectRoot, "harness.config.json");
  if (!existsSync(configPath)) {
    return { decision: "approve" };
  }

  // Defensive narrow: `loadConfigSafe` already fails open on shape errors
  // (returns DEFAULT_CONFIG), but the returned shape is a `HarnessConfig`
  // — `work.qualityGates` is always present with merged defaults.
  const config = loadConfigSafe(projectRoot);
  const gates = config.work.qualityGates;

  const reminders: string[] = [];
  if (gates.enforceTddImplement) {
    reminders.push("TDD 必須");
  }
  if (gates.enforcePseudoCoderabbit) {
    reminders.push("疑似 CodeRabbit 必須");
  }
  if (gates.enforceRealCoderabbit) {
    reminders.push("本物 CodeRabbit 必須");
  }
  if (gates.enforceCodexSecondOpinion) {
    reminders.push("Codex セカンドオピニオン必須");
  }

  // Behavioural preservation: if every gate is explicitly `false`, produce
  // no `additionalContext`. Historically callers observed
  // `{decision:"approve"}` with no reason in that case — `index.ts` then
  // drops the reason field entirely.
  if (reminders.length === 0) {
    return { decision: "approve" };
  }

  return {
    decision: "approve",
    additionalContext: `[品質ゲート] ${reminders.join(" / ")}`,
  };
}
