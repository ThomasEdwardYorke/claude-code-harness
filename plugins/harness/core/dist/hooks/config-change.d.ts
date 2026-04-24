/**
 * hooks/config-change.ts
 *
 * ConfigChange hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-24)
 *
 * - **Trigger**: fires when a configuration file changes during the session
 *   (external editor / process modifies settings or skills files).
 * - **Payload**: `source` (matcher: user_settings / project_settings /
 *   local_settings / policy_settings / skills) + `file_path` + shared
 *   fields (session_id / cwd / transcript_path / hook_event_name).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }`
 *   - `decision: "block"` → prevent the config change from taking effect
 *   - `hookSpecificOutput.additionalContext` → injected into Claude context
 *   - other non-zero exit → non-blocking error (change proceeds)
 * - **matcher**: source-based (the 5 enum values documented above).
 *
 * ## Handler responsibility (harness-specific)
 *
 * Observability hook with opt-in blocking. Default behaviour is
 * `decision: "approve"` with a diagnostic context; the user can opt in to
 * blocking specific sources (e.g.
 * `configChange.blockOnSources: ["policy_settings"]`) to enforce
 * immutability of enterprise-managed policy without writing a custom hook.
 *
 * - **Fail-open**: config read failure / `enabled: false` → silent skip +
 *   `approve` with no additionalContext.
 * - **Sanitize**: file_path control chars / CR / LF / ANSI escape → literal
 *   `\n` / `\x{NN}`. source outside the 5-enum whitelist → `"unknown"`.
 * - **Truncate**: file_path > `maxFilePathLength` → truncate + inline marker.
 * - **Sensitive hint**: `.env` / `.env.<suffix>` / `secrets.<ext>` /
 *   `credentials.<ext>` / `*.pem` / `*.key` / `*.p12` / `*.pfx` →
 *   append `hint: potential secret file`.
 * - **Harness reload hint**: file_path endsWith `harness.config.json` →
 *   append `hint: harness config changed — run `harness doctor` or
 *   restart Claude Code to reload`.
 * - **Opt-in block**: `blockOnSources` に source が含まれる → `decision:
 *   "block"` + reason。additionalContext は block 時も保持 (observability)。
 *
 * ## Sanitization rationale (同 post-tool-use-failure.ts pattern)
 *
 * An attacker-controlled process can modify a settings file and trigger this
 * hook with crafted `source` / `file_path` strings to (a) spoof fence
 * boundaries in additionalContext, (b) inject ANSI escape sequences that
 * corrupt terminal rendering, or (c) leak secrets via the injected context.
 * Mitigations:
 *   1. Replace newline / CR with the literal `\n` token.
 *   2. Replace all other C0 control chars (including TAB `\x09`) + DEL `\x7F`
 *      with `\x{HH}` form. TAB is escaped here (unlike post-tool-use-failure
 *      which preserves TAB for error stack trace readability) because a
 *      file_path legitimately never contains TAB and an unescaped TAB can
 *      create visual alignment attacks in terminal rendering.
 *   3. Validate `source` against the 5-enum allowlist; anything else → "unknown".
 *   4. Per-request 48-bit nonce in the header + truncation marker so the
 *      attacker cannot pre-compute a spoofed literal.
 *
 * ## Related docs
 * - `docs/maintainer/research-anthropic-official-2026-04-22.md` (hook spec)
 * - `CHANGELOG.md` (feature history)
 */
export interface ConfigChangeInput {
    hook_event_name: string;
    /**
     * Matcher source (official payload): one of
     * `user_settings` / `project_settings` / `local_settings` /
     * `policy_settings` / `skills`. Anything else is mapped to `"unknown"`
     * during sanitization.
     */
    source?: string | undefined;
    /**
     * Absolute or relative path to the changed config file (official
     * payload). Rendered into additionalContext after control-char
     * sanitization and length truncation.
     */
    file_path?: string | undefined;
    session_id?: string | undefined;
    cwd?: string | undefined;
    transcript_path?: string | undefined;
}
export interface ConfigChangeResult {
    /**
     * `"approve"` = observability-only (default path),
     * `"block"` = reject the config change (opt-in via `blockOnSources`).
     */
    decision: "approve" | "block";
    /** Block reason (populated only when `decision: "block"`). */
    reason?: string;
    /**
     * Diagnostic text lifted into `hookSpecificOutput.additionalContext`
     * by index.ts main(). Includes the nonce-header, source, file_path,
     * and optional hints.
     */
    additionalContext?: string;
}
/**
 * Main entry point for the ConfigChange hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns `decision: "block"` when `sanitizedSource ∈ blockOnSources`,
 *          otherwise `decision: "approve"`. `additionalContext` is always
 *          populated unless `enabled: false`.
 */
export declare function handleConfigChange(input: ConfigChangeInput, options?: {
    projectRoot?: string | undefined;
}): Promise<ConfigChangeResult>;
//# sourceMappingURL=config-change.d.ts.map