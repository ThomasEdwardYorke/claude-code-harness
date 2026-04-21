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