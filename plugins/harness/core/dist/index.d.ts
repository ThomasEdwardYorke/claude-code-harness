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
type HookType = "pre-tool" | "post-tool" | "permission" | "session-start" | "session-end" | "pre-compact" | "subagent-stop" | "task-created" | "task-completed" | "stop" | "worktree-remove" | "worktree-create" | "user-prompt-submit" | "post-tool-use-failure" | "config-change";
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
export {};
//# sourceMappingURL=index.d.ts.map