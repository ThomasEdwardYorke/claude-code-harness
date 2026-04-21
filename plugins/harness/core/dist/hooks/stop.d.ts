/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Checks for pending CI results
 * from SubagentStop and reminds about Plans.md updates.
 */
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
export declare function handleStop(input: StopInput): Promise<StopResult>;
//# sourceMappingURL=stop.d.ts.map