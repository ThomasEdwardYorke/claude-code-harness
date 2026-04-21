/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Reads project config via
 * `loadConfigWithError` so that partial `work.qualityGates` overrides
 * inherit the other gate defaults **and** so that a malformed config
 * file is not silently treated the same as a pristine config — a
 * broken file suppresses the reminders entirely (avoids the
 * silent-swallow failure mode where `loadConfigSafe` would emit every
 * default reminder even when the user never validly authored them).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigWithError } from "../config.js";
export async function handleStop(input) {
    const projectRoot = input.cwd ?? process.cwd();
    // Keep the historical behavior of returning a bare approve when the
    // project has no `harness.config.json` at all — we don't want to
    // start emitting reminders for projects that never opted in.
    const configPath = resolve(projectRoot, "harness.config.json");
    if (!existsSync(configPath)) {
        return { decision: "approve" };
    }
    const outcome = loadConfigWithError(projectRoot);
    if (outcome.error !== undefined) {
        // Malformed config. Emitting the default reminder set ("TDD 必須 /
        // 疑似 CodeRabbit 必須 / ...") would misrepresent the project's
        // intent — the user never successfully declared them. Surface the
        // parse failure to stderr and suppress all reminders for this turn.
        process.stderr.write(`[harness stop] harness.config.json parse failed: ${outcome.error}; suppressing quality-gate reminders until fixed.\n`);
        return { decision: "approve" };
    }
    const gates = outcome.config.work.qualityGates;
    const reminders = [];
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
//# sourceMappingURL=stop.js.map