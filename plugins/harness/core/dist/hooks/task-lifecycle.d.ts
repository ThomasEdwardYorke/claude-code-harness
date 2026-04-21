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
export declare function handleTaskCreated(input: TaskLifecycleInput): Promise<TaskLifecycleResult>;
export declare function handleTaskCompleted(input: TaskLifecycleInput): Promise<TaskLifecycleResult>;
//# sourceMappingURL=task-lifecycle.d.ts.map