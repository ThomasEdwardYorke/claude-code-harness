/**
 * hooks/task-lifecycle.ts
 *
 * TaskCreated / TaskCompleted hook handlers.
 * Logs task state changes for coordinator monitoring.
 * Plans.md 担当表の自動更新は coordinator worktree のみで実行可能なため、
 * ここではログ出力 + additionalContext でフィードバックを返す。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TaskLifecycleInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  task_id?: string | undefined;
  task_subject?: string | undefined;
  task_status?: string | undefined;
}

export interface TaskLifecycleResult {
  decision: "approve";
  additionalContext?: string;
  taskId?: string | undefined;
  taskSubject?: string | undefined;
}

export async function handleTaskCreated(
  input: TaskLifecycleInput,
): Promise<TaskLifecycleResult> {
  const projectRoot = input.cwd ?? process.cwd();
  const hasPlans = existsSync(resolve(projectRoot, "Plans.md"));
  const taskInfo = input.task_subject ?? input.task_id ?? "unknown";

  const context = hasPlans
    ? `[TaskCreated] ${taskInfo} — Plans.md 担当表への反映を検討してください`
    : `[TaskCreated] ${taskInfo}`;

  return {
    decision: "approve",
    additionalContext: context,
    taskId: input.task_id,
    taskSubject: input.task_subject,
  };
}

export async function handleTaskCompleted(
  input: TaskLifecycleInput,
): Promise<TaskLifecycleResult> {
  const projectRoot = input.cwd ?? process.cwd();
  const hasPlans = existsSync(resolve(projectRoot, "Plans.md"));
  const taskInfo = input.task_subject ?? input.task_id ?? "unknown";

  const context = hasPlans
    ? `[TaskCompleted] ${taskInfo} — Plans.md 担当表の更新と完了セクションへの移動を検討してください`
    : `[TaskCompleted] ${taskInfo}`;

  return {
    decision: "approve",
    additionalContext: context,
    taskId: input.task_id,
    taskSubject: input.task_subject,
  };
}
