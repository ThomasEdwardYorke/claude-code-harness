/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Checks for pending CI results
 * from SubagentStop and reminds about Plans.md updates.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
export async function handleStop(input) {
    const projectRoot = input.cwd ?? process.cwd();
    const sections = [];
    const configPath = resolve(projectRoot, "harness.config.json");
    if (!existsSync(configPath)) {
        return { decision: "approve" };
    }
    try {
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw);
        const work = config["work"];
        if (work) {
            const gates = work["qualityGates"];
            if (gates) {
                const reminders = [];
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
    }
    catch (err) {
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
//# sourceMappingURL=stop.js.map