/**
 * hooks/subagent-stop.ts
 *
 * SubagentStop hook handler.
 * Fires when a subagent completes. For worker agents, runs a lightweight
 * CI safety net (ruff/mypy/pytest) to catch regressions before the
 * coordinator proceeds.
 */
export interface SubagentStopInput {
    hook_event_name: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    agent_type?: string | undefined;
    agent_id?: string | undefined;
    agent_transcript_path?: string | undefined;
    last_assistant_message?: string | undefined;
}
export interface CiCheckResult {
    tool: string;
    passed: boolean;
    output: string;
}
export interface SubagentStopResult {
    decision: "approve";
    ciTriggered: boolean;
    ciResults?: CiCheckResult[];
    additionalContext?: string;
}
export declare function detectAvailableChecks(projectRoot: string): Array<{
    tool: string;
    command: string;
}>;
export declare function handleSubagentStop(input: SubagentStopInput): Promise<SubagentStopResult>;
//# sourceMappingURL=subagent-stop.d.ts.map