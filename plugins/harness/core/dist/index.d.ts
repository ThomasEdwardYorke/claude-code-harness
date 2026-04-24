/**
 * core/src/index.ts
 * Harness core entry point.
 *
 * Reads JSON from stdin, routes by hook type, writes a JSON response to stdout.
 *
 *   echo '{"tool_name":"Bash","tool_input":{...}}' | node dist/index.js pre-tool
 *   echo '{"tool_name":"Write","tool_input":{...}}' | node dist/index.js post-tool
 *   echo '{"tool_name":"Bash","tool_input":{...}}' | node dist/index.js permission
 *   echo '{}' | node dist/index.js session-start
 *   echo '{}' | node dist/index.js session-end
 */
import type { HookInput, HookResult } from "./types.js";
type HookType = "pre-tool" | "post-tool" | "permission" | "session-start" | "session-end" | "pre-compact" | "subagent-stop" | "subagent-start" | "task-created" | "task-completed" | "stop" | "worktree-remove" | "worktree-create" | "user-prompt-submit" | "post-tool-use-failure" | "config-change";
export declare function route(hookType: HookType, input: HookInput | Record<string, unknown>): Promise<HookResult>;
/**
 * Safe fallback used by `main()` when the dispatcher or any handler throws.
 *
 * Exported so that tests can verify the end-to-end contract — a handler
 * that throws must still produce a valid `HookResult` rather than leaking
 * the exception (which would otherwise crash Claude Code's hook runner).
 * Every hook path eventually flows through `main()` via `scripts/hook-dispatcher.mjs`,
 * which relies on this fallback to keep the user session alive.
 *
 * @internal
 *
 * **Do not pattern-match on the returned `reason` string** from external
 * code. The exact format (`"Core engine error (safe fallback): <msg>"`)
 * is an internal implementation detail and may be reformatted across
 * releases. Consumers should only rely on `decision === "approve"` and
 * on `reason` being a non-empty string; the reason text is intended for
 * human-readable debugging / stderr logging, not machine parsing.
 */
export declare function errorToResult(err: unknown): HookResult;
/**
 * Maximum Unicode code-point length of the safe-fallback reason body
 * BEFORE appending a truncation suffix, when surfaced via stderr or
 * lifted into `systemMessage`. The final emitted string may therefore be
 * slightly longer than this constant — `sanitizeSafeFallbackReason()`
 * appends `…[truncated]` (12 code units) when the body exceeds the cap.
 *
 * Chosen empirically: 2000 code points fits ~30 stack frames or a
 * multi-line error message without crowding Claude's context window on
 * the next conversation turn (systemMessage is "delivered to Claude as
 * context on the next conversation turn" per
 * https://code.claude.com/docs/en/hooks).
 *
 * @internal
 */
export declare const MAX_SAFE_FALLBACK_REASON_CHARS = 2000;
/**
 * Neutralises control characters and bounds the length of a safe-fallback
 * reason before it is surfaced via stderr or lifted into `systemMessage`.
 *
 * Rationale:
 *   - `systemMessage` is delivered to Claude as context on the next turn
 *     (per the hooks spec), so its content must be treated as untrusted
 *     text that could try to alter Claude's behaviour (prompt-injection
 *     defence). Stripping C0/C1 control bytes neutralises ANSI escape
 *     sequences, terminal-clear tricks, and NUL-byte logging attacks.
 *   - Keep `\t` (0x09), `\n` (0x0A), `\r` (0x0D) so stack traces remain
 *     readable — these are non-hostile formatting characters.
 *   - Bound the BODY at MAX_SAFE_FALLBACK_REASON_CHARS Unicode code
 *     points (the truncation suffix `…[truncated]` is appended AFTER
 *     the cap, so the emitted string is at most 2012 code points — the
 *     cap applies to the pre-suffix body, not the final output length).
 *     A multi-megabyte stack trace can therefore not spam the debug log
 *     or crowd out Claude's context window.
 *   - Truncate at Unicode code-point boundaries (via `Array.from`) rather
 *     than UTF-16 code-unit boundaries (`String.prototype.slice`) so that
 *     a supplementary-plane character (e.g., emoji 😀 = surrogate pair)
 *     straddling the cap is never split — otherwise we would emit a
 *     lone high surrogate, which `JSON.stringify` would encode as a
 *     `\uXXXX` escape but which renders as garbage in user-facing UIs.
 *
 * @internal
 */
export declare function sanitizeSafeFallbackReason(raw: string): string;
export {};
//# sourceMappingURL=index.d.ts.map