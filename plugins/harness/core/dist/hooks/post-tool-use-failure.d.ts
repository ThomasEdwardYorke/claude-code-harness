/**
 * hooks/post-tool-use-failure.ts
 *
 * PostToolUseFailure hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **Trigger**: fires when a tool execution fails (exception / non-zero exit /
 *   interrupt). Mutually exclusive with PostToolUse (success fires PostToolUse,
 *   failure fires this hook).
 * - **Payload**: `tool_name` / `tool_input` / `tool_use_id` / `error` (string) /
 *   `is_interrupt` (optional) + the shared fields (session_id / transcript_path /
 *   cwd / hook_event_name / permission_mode).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }` parsed
 *   - exit 0 + `hookSpecificOutput.additionalContext` → injected into Claude context
 *   - `decision: "block"` + reason → would block the tool failure explicitly
 *     (this handler does not use it)
 *   - other non-zero exit → non-blocking error (execution continues)
 * - **matcher**: tool-name based (same as PostToolUse); harness registers for all tools.
 *
 * ## Handler responsibility
 *
 * Observability hook that injects diagnostic information plus optional
 * corrective hints for known error patterns into
 * `hookSpecificOutput.additionalContext`, so Claude has material to decide
 * recovery on the next turn.
 *
 * - **Fail-open**: config read failure / empty error → silent skip + `approve`.
 * - **Truncate**: when error length exceeds `maxErrorLength`, truncate and emit
 *   an inline marker.
 * - **Built-in hints (`correctiveHints: true`)**: six patterns (permission denied /
 *   no such file / command not found / signal abort / timeout / connection refused).
 * - **Non-blocking**: always returns `decision: "approve"`. Blocking the failure
 *   itself is out of scope — this hook observes and advises only.
 *
 * ## Related docs
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (hook spec research)
 * - CHANGELOG.md (feature history)
 */
export interface PostToolUseFailureInput {
    hook_event_name: string;
    /** Name of the failing tool (official payload). */
    tool_name?: string | undefined;
    /** Arguments passed to the failing tool (official payload). */
    tool_input?: Record<string, unknown> | undefined;
    /** Tool invocation id (official payload). */
    tool_use_id?: string | undefined;
    /** Error string (official payload, e.g. `Command exited with non-zero status code 1`). */
    error?: string | undefined;
    /** User-interrupt flag (official payload, optional). */
    is_interrupt?: boolean | undefined;
    session_id?: string | undefined;
    cwd?: string | undefined;
    transcript_path?: string | undefined;
    permission_mode?: string | undefined;
}
export interface PostToolUseFailureResult {
    /** This handler always returns `approve` (observability hook). */
    decision: "approve";
    /** Diagnostic text + hint (lifted into `hookSpecificOutput.additionalContext`). */
    additionalContext?: string;
}
/**
 * Main entry point for the PostToolUseFailure hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns Always `decision: "approve"` (observability hook, fail-open).
 *          Includes `additionalContext` when diagnostics and hints can be
 *          generated.
 */
export declare function handlePostToolUseFailure(input: PostToolUseFailureInput, options?: {
    projectRoot?: string | undefined;
}): Promise<PostToolUseFailureResult>;
//# sourceMappingURL=post-tool-use-failure.d.ts.map