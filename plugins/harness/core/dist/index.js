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
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf-8");
}
function parseInput(raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" ||
        parsed === null ||
        !("tool_name" in parsed) ||
        typeof parsed["tool_name"] !== "string") {
        throw new Error("Invalid hook input: missing required field 'tool_name'");
    }
    const obj = parsed;
    const result = {
        tool_name: obj["tool_name"],
        tool_input: typeof obj["tool_input"] === "object" && obj["tool_input"] !== null
            ? obj["tool_input"]
            : {},
    };
    if (typeof obj["session_id"] === "string") {
        result.session_id = obj["session_id"];
    }
    if (typeof obj["cwd"] === "string") {
        result.cwd = obj["cwd"];
    }
    if (typeof obj["plugin_root"] === "string") {
        result.plugin_root = obj["plugin_root"];
    }
    return result;
}
/**
 * Minimal shape we accept on session hooks (tool_name etc. not required).
 */
function parseSessionInput(raw) {
    if (!raw.trim())
        return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
        ? parsed
        : {};
}
function extractString(obj, key) {
    const val = obj[key];
    return typeof val === "string" ? val : undefined;
}
export async function route(hookType, input) {
    switch (hookType) {
        case "pre-tool": {
            const { evaluatePreTool } = await import("./guardrails/pre-tool.js");
            return evaluatePreTool(input);
        }
        case "post-tool": {
            const { evaluatePostTool } = await import("./guardrails/post-tool.js");
            return evaluatePostTool(input);
        }
        case "permission": {
            const { evaluatePermission, formatPermissionOutput } = await import("./guardrails/permission.js");
            const permResult = evaluatePermission(input);
            const permJson = formatPermissionOutput(permResult);
            return { decision: permResult.decision, systemMessage: permJson };
        }
        case "pre-compact": {
            const { handlePreCompact } = await import("./hooks/pre-compact.js");
            const raw = input;
            const compactResult = await handlePreCompact({
                hook_event_name: String(raw["hook_event_name"] ?? "PreCompact"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                trigger: extractString(raw, "trigger"),
                custom_instructions: extractString(raw, "custom_instructions"),
            });
            const compactHookResult = { decision: compactResult.decision };
            if (compactResult.additionalContext !== undefined) {
                compactHookResult.reason = compactResult.additionalContext;
            }
            return compactHookResult;
        }
        case "subagent-stop": {
            const { handleSubagentStop } = await import("./hooks/subagent-stop.js");
            const raw = input;
            const stopResult = await handleSubagentStop({
                hook_event_name: String(raw["hook_event_name"] ?? "SubagentStop"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                agent_type: extractString(raw, "agent_type"),
                agent_id: extractString(raw, "agent_id"),
                agent_transcript_path: extractString(raw, "agent_transcript_path"),
                last_assistant_message: extractString(raw, "last_assistant_message"),
            });
            const stopHookResult = { decision: stopResult.decision };
            if (stopResult.additionalContext !== undefined) {
                stopHookResult.reason = stopResult.additionalContext;
            }
            return stopHookResult;
        }
        case "session-start":
        case "session-end": {
            return { decision: "approve" };
        }
        default: {
            return {
                decision: "approve",
                reason: `Unknown hook type: ${String(hookType)}`,
            };
        }
    }
}
function errorToResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
        decision: "approve",
        reason: `Core engine error (safe fallback): ${message}`,
    };
}
async function main() {
    const hookType = (process.argv[2] ?? "pre-tool");
    let result;
    try {
        const raw = await readStdin();
        if (hookType === "session-start" ||
            hookType === "session-end" ||
            hookType === "pre-compact" ||
            hookType === "subagent-stop") {
            const parsed = parseSessionInput(raw);
            result = await route(hookType, parsed);
        }
        else if (!raw.trim()) {
            result = { decision: "approve", reason: "Empty input" };
        }
        else {
            const input = parseInput(raw);
            result = await route(hookType, input);
        }
    }
    catch (err) {
        result = errorToResult(err);
    }
    if (hookType === "permission" && result.systemMessage !== undefined) {
        process.stdout.write(result.systemMessage + "\n");
    }
    else {
        process.stdout.write(JSON.stringify(result) + "\n");
    }
}
// Only run main() when this module is the entry point — tests import safely.
const isEntry = typeof process !== "undefined" &&
    process.argv[1] !== undefined &&
    (process.argv[1].endsWith("/index.js") ||
        process.argv[1].endsWith("\\index.js"));
if (isEntry) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Fatal: ${message}\n`);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map