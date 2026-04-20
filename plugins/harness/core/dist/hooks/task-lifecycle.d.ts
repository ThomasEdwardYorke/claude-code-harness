/**
 * hooks/task-lifecycle.ts
 *
 * TaskCreated / TaskCompleted hook handlers.
 * Logs task state changes for coordinator monitoring.
 * Plans.md 担当表の自動更新は coordinator worktree のみで実行可能なため、
 * ここではログ出力 + additionalContext でフィードバックを返す。
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