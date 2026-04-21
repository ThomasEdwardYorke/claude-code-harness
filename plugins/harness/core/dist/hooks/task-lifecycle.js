/**
 * hooks/task-lifecycle.ts
 *
 * TaskCreated / TaskCompleted hook handlers.
 * Logs task state changes for coordinator monitoring.
 * The plan file path is configurable via `harness.config.json` (work.plansFile).
 * Automatic assignment-table updates are intentionally not performed here —
 * they are coordinator-only work. This hook only emits reminders via
 * `additionalContext`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSafe } from "../config.js";
function plansReminder(projectRoot, verb) {
    const config = loadConfigSafe(projectRoot);
    const plansFile = config.work.plansFile;
    const hasPlans = existsSync(resolve(projectRoot, plansFile));
    return hasPlans
        ? ` — ${plansFile} の assignment section (${verb}) への反映を検討してください`
        : "";
}
export async function handleTaskCreated(input) {
    const projectRoot = input.cwd ?? process.cwd();
    const taskInfo = input.task_subject ?? input.task_id ?? "unknown";
    const suffix = plansReminder(projectRoot, "task-created entry");
    const context = `[TaskCreated] ${taskInfo}${suffix}`;
    return {
        decision: "approve",
        additionalContext: context,
        taskId: input.task_id,
        taskSubject: input.task_subject,
    };
}
export async function handleTaskCompleted(input) {
    const projectRoot = input.cwd ?? process.cwd();
    const taskInfo = input.task_subject ?? input.task_id ?? "unknown";
    const suffix = plansReminder(projectRoot, "completion section move");
    const context = `[TaskCompleted] ${taskInfo}${suffix}`;
    return {
        decision: "approve",
        additionalContext: context,
        taskId: input.task_id,
        taskSubject: input.task_subject,
    };
}
//# sourceMappingURL=task-lifecycle.js.map