/**
 * hooks/subagent-start.ts
 *
 * SubagentStart hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-24)
 *
 * - **Trigger**: fires when Task tool spawns a subagent (before subagent runs).
 * - **Payload**: `session_id` / `cwd` / `agent_type` / `agent_id` /
 *   `transcript_path` / shared fields (hook_event_name).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, hookSpecificOutput }`
 *   - `hookSpecificOutput.additionalContext` → injected into **subagent's**
 *     context (advisory only, subagent reads this as additional context)
 *   - **Block NOT supported**: SubagentStart does NOT support `decision: "block"`
 *     (Anthropic official spec: subagent block is not an intended use case)
 *   - other non-zero exit → non-blocking error (subagent runs anyway)
 * - **matcher**: `agent_type` (Bash / Explore / Plan / `harness:worker` /
 *   `harness:reviewer` etc.)
 *
 * ## Handler responsibility (harness-specific)
 *
 * Observability hook with opt-in guidance injection. Default behaviour is
 * `decision: "approve"` with a diagnostic context; the user can opt in to
 * per-type guidance notes (e.g. `harness:worker` → "TDD first" reminder)
 * to bridge global plugin defaults with local project rules via the
 * subagent context.
 *
 * - **Fail-open**: config read failure / `enabled: false` → silent skip +
 *   `approve` with no additionalContext.
 * - **Sanitize**: agent_type / agent_id / note values share the same
 *   policy — CR / LF / CRLF → literal `\n`, TAB (`\x09`) + other C0
 *   (0x00-0x1F) + DEL (0x7F) → `\x{HH}`. Notes are rendered single-line
 *   (see `sanitizeNote()` for rationale: config values are attack
 *   surface, preserving raw LF would allow multi-line pseudo-section
 *   injection inside `additionalContext`).
 * - **Truncate**: agent_type > `maxIdentifierLength` → truncate + inline
 *   marker (char-based); total bytes > `maxTotalBytes` → byte-safe
 *   UTF-8 truncation (multi-byte characters kept whole).
 * - **agentTypeNotes injection**: config provides per-type guidance (e.g.
 *   `{ "harness:worker": "Remember: TDD first..." }`). When agent_type
 *   matches a key, the note value is sanitized and injected into
 *   additionalContext.
 * - **Nonce-fenced diagnostic**: 12 hex (48-bit entropy) fence markers +
 *   inline nonce to defend against fake-marker injection attacks (attacker
 *   config cannot pre-compute matching nonce).
 *
 * ## Sanitization rationale (post-tool-use-failure.ts pattern)
 *
 * An attacker-controlled config (or malicious config admin) can craft
 * agent_type / agent_id / agentTypeNotes values to (a) spoof fence
 * boundaries, (b) inject ANSI escape sequences that corrupt terminal
 * rendering, (c) confuse parsing via embedded newlines, or (d) smuggle
 * multi-line content that looks like new section boundaries. Mitigations:
 *   1. Replace CR / LF / CRLF with the literal `\n` token in **both**
 *      identifiers and note content (single-line output — config values
 *      are attack surface, multi-line preservation would enable pseudo-
 *      section injection).
 *   2. Replace all other C0 (0x00-0x1F, TAB included) + DEL (0x7F) with
 *      the `\x{HH}` form — ANSI escape + visual alignment attacks denied.
 *   3. Per-request 48-bit nonce in the header so attacker cannot
 *      pre-compute a spoofed literal (collision probability 2^-48).
 *   4. Truncation markers for overlong identifiers; byte-safe UTF-8
 *      truncation for total `additionalContext` length.
 *
 * ## Related docs
 * - `docs/maintainer/research-anthropic-official-2026-04-22.md` (hook spec)
 * - `CHANGELOG.md` (feature history)
 */
export interface SubagentStartInput {
    hook_event_name: string;
    /**
     * Session identifier from Claude Code. Used for observability
     * (tracing subagent back to parent session).
     */
    session_id?: string | undefined;
    /**
     * Current working directory. Used as projectRoot for config lookup.
     */
    cwd?: string | undefined;
    /**
     * Agent type (matcher value): one of
     * `Bash` / `Explore` / `Plan` / `harness:worker` / `harness:reviewer` /
     * etc. Rendered into additionalContext after control-char sanitization
     * and truncation. `undefined` is coalesced to `"unknown"` during
     * sanitization.
     */
    agent_type?: string | undefined;
    /**
     * Agent instance identifier. Rendered into additionalContext after
     * sanitization (for observability/tracing).
     */
    agent_id?: string | undefined;
    /**
     * Absolute path to the transcript file (for coordinators to locate
     * subagent output). Informational; not rendered in additionalContext
     * by this handler (used by calling layer).
     */
    transcript_path?: string | undefined;
}
export interface SubagentStartResult {
    /**
     * Always `"approve"` (SubagentStart does NOT support block).
     */
    decision: "approve";
    /**
     * Diagnostic text lifted into `hookSpecificOutput.additionalContext`
     * by index.ts main(). Includes the nonce-header, agent_type, agent_id,
     * and optional agentTypeNotes if present and config-matched.
     * Populated only when `enabled: true`; omitted when `enabled: false`.
     */
    additionalContext?: string;
}
export interface SubagentStartConfig {
    enabled: boolean;
    maxIdentifierLength: number;
    fenceContext: boolean;
    agentTypeNotes: Record<string, string>;
    maxTotalBytes: number;
}
/**
 * Main entry point for the SubagentStart hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns Always `decision: "approve"` (block not supported).
 *          `additionalContext` is populated unless `enabled: false`.
 */
export declare function handleSubagentStart(input: SubagentStartInput, options?: {
    projectRoot?: string | undefined;
}): Promise<SubagentStartResult>;
//# sourceMappingURL=subagent-start.d.ts.map