/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Checks for pending CI results
 * from SubagentStop and reminds about Plans.md updates.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  const sections: string[] = [];

  const configPath = resolve(projectRoot, "harness.config.json");
  if (!existsSync(configPath)) {
    return { decision: "approve" };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    const work = config["work"] as Record<string, unknown> | undefined;
    if (work) {
      const gates = work["qualityGates"] as Record<string, boolean> | undefined;
      if (gates) {
        const reminders: string[] = [];
        if (gates["enforceTddImplement"]) {
          reminders.push("TDD 必須");
        }
        if (gates["enforcePseudoCoderabbit"]) {
          reminders.push("疑似 CodeRabbit 必須");
        }
        if (gates["enforceCodexSecondOpinion"]) {
          reminders.push("Codex セカンドオピニオン必須");
        }
        if (reminders.length > 0) {
          sections.push(`[品質ゲート] ${reminders.join(" / ")}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[harness stop] config parse: ${msg}\n`);
  }

  if (sections.length === 0) {
    return { decision: "approve" };
  }

  return {
    decision: "approve",
    additionalContext: sections.join("\n"),
  };
}
