/**
 * hooks/pre-compact.ts
 *
 * PreCompact hook handler.
 * Fires before context compaction. Reads project state (Plans.md 担当表,
 * open PRs) and returns it as additionalContext so it survives compaction.
 */
export interface PreCompactInput {
    hook_event_name: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    trigger?: string | undefined;
    custom_instructions?: string | undefined;
}
export interface PreCompactResult {
    decision: "approve";
    additionalContext?: string;
}
export declare function handlePreCompact(input: PreCompactInput): Promise<PreCompactResult>;
//# sourceMappingURL=pre-compact.d.ts.map