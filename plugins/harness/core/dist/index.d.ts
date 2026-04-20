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
type HookType = "pre-tool" | "post-tool" | "permission" | "session-start" | "session-end" | "pre-compact" | "subagent-stop";
export declare function route(hookType: HookType, input: HookInput): Promise<HookResult>;
export {};
//# sourceMappingURL=index.d.ts.map