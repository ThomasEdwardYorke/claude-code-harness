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
        case "task-created": {
            const { handleTaskCreated } = await import("./hooks/task-lifecycle.js");
            const raw = input;
            const taskResult = await handleTaskCreated({
                hook_event_name: String(raw["hook_event_name"] ?? "TaskCreated"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                task_id: extractString(raw, "task_id"),
                task_subject: extractString(raw, "task_subject"),
                task_status: extractString(raw, "task_status"),
            });
            const taskHookResult = { decision: taskResult.decision };
            if (taskResult.additionalContext !== undefined) {
                taskHookResult.reason = taskResult.additionalContext;
            }
            return taskHookResult;
        }
        case "task-completed": {
            const { handleTaskCompleted } = await import("./hooks/task-lifecycle.js");
            const raw = input;
            const taskResult = await handleTaskCompleted({
                hook_event_name: String(raw["hook_event_name"] ?? "TaskCompleted"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                task_id: extractString(raw, "task_id"),
                task_subject: extractString(raw, "task_subject"),
                task_status: extractString(raw, "task_status"),
            });
            const taskHookResult = { decision: taskResult.decision };
            if (taskResult.additionalContext !== undefined) {
                taskHookResult.reason = taskResult.additionalContext;
            }
            return taskHookResult;
        }
        case "stop": {
            const { handleStop } = await import("./hooks/stop.js");
            const raw = input;
            const stopRes = await handleStop({
                hook_event_name: String(raw["hook_event_name"] ?? "Stop"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
            });
            const stopHR = { decision: stopRes.decision };
            if (stopRes.additionalContext !== undefined) {
                stopHR.reason = stopRes.additionalContext;
            }
            return stopHR;
        }
        case "worktree-remove": {
            const { handleWorktreeRemove } = await import("./hooks/worktree-lifecycle.js");
            const raw = input;
            const wrRes = await handleWorktreeRemove({
                hook_event_name: String(raw["hook_event_name"] ?? "WorktreeRemove"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                worktree_path: extractString(raw, "worktree_path"),
                agent_type: extractString(raw, "agent_type"),
                agent_id: extractString(raw, "agent_id"),
                transcript_path: extractString(raw, "transcript_path"),
            });
            const wrHR = { decision: wrRes.decision };
            if (wrRes.additionalContext !== undefined) {
                wrHR.reason = wrRes.additionalContext;
            }
            return wrHR;
        }
        case "worktree-create": {
            // WorktreeCreate blocking protocol: 公式仕様
            // (https://code.claude.com/docs/en/hooks) に従い、command hook として
            // 実 `git worktree add` を実行し absolute path を返す。
            //
            // HookResult の mapping:
            //   - worktreePath: handler が成功時に返す absolute path (main() で raw stdout)
            //   - reason: handler が失敗時に返すエラー理由 (main() で stderr)
            //   - systemMessage: 失敗時 debug log 用に additionalContext を載せる
            //     (成功時の raw path stdout を妨げない形で observability を担保)
            const { handleWorktreeCreate } = await import("./hooks/worktree-lifecycle.js");
            const raw = input;
            const wcRes = await handleWorktreeCreate({
                hook_event_name: String(raw["hook_event_name"] ?? "WorktreeCreate"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                name: extractString(raw, "name"),
                agent_type: extractString(raw, "agent_type"),
                agent_id: extractString(raw, "agent_id"),
                transcript_path: extractString(raw, "transcript_path"),
            });
            const wcHR = { decision: wcRes.decision };
            if (wcRes.worktreePath !== undefined) {
                wcHR.worktreePath = wcRes.worktreePath;
            }
            if (wcRes.reason !== undefined) {
                wcHR.reason = wcRes.reason;
            }
            if (wcRes.additionalContext !== undefined) {
                wcHR.systemMessage = wcRes.additionalContext;
            }
            return wcHR;
        }
        case "user-prompt-submit": {
            // UserPromptSubmit: Global plugin → Local project rules bridge。
            // 公式仕様 (https://code.claude.com/docs/en/hooks) の
            // `hookSpecificOutput.additionalContext` / `sessionTitle` を
            // HookResult 経由で受け、main() の JSON 出力分岐で整形する。
            const { handleUserPromptSubmit } = await import("./hooks/user-prompt-submit.js");
            const raw = input;
            const upRes = await handleUserPromptSubmit({
                hook_event_name: String(raw["hook_event_name"] ?? "UserPromptSubmit"),
                prompt: typeof raw["prompt"] === "string" ? raw["prompt"] : "",
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                transcript_path: extractString(raw, "transcript_path"),
            });
            const upHR = { decision: upRes.decision };
            if (upRes.additionalContext !== undefined) {
                upHR.additionalContext = upRes.additionalContext;
            }
            if (upRes.sessionTitle !== undefined) {
                upHR.sessionTitle = upRes.sessionTitle;
            }
            if (upRes.reason !== undefined) {
                upHR.reason = upRes.reason;
            }
            return upHR;
        }
        case "post-tool-use-failure": {
            // PostToolUseFailure: tool 失敗時の observability hook。
            // 公式仕様 (https://code.claude.com/docs/en/hooks) の
            // `hookSpecificOutput.additionalContext` で診断 + hint を inject する。
            // non-blocking (必ず approve 返却)。
            const { handlePostToolUseFailure } = await import("./hooks/post-tool-use-failure.js");
            const raw = input;
            const ptufRes = await handlePostToolUseFailure({
                hook_event_name: String(raw["hook_event_name"] ?? "PostToolUseFailure"),
                tool_name: extractString(raw, "tool_name"),
                tool_input: typeof raw["tool_input"] === "object" && raw["tool_input"] !== null
                    ? raw["tool_input"]
                    : undefined,
                tool_use_id: extractString(raw, "tool_use_id"),
                error: extractString(raw, "error"),
                is_interrupt: typeof raw["is_interrupt"] === "boolean"
                    ? raw["is_interrupt"]
                    : undefined,
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                transcript_path: extractString(raw, "transcript_path"),
                permission_mode: extractString(raw, "permission_mode"),
            });
            const ptufHR = { decision: ptufRes.decision };
            if (ptufRes.additionalContext !== undefined) {
                ptufHR.additionalContext = ptufRes.additionalContext;
            }
            return ptufHR;
        }
        case "config-change": {
            // ConfigChange: config 変更時の observability hook (Phase η P1-P2)。
            // 公式仕様 (https://code.claude.com/docs/en/hooks) の
            // `hookSpecificOutput.additionalContext` で source / file_path /
            // hints を inject。opt-in block (blockOnSources) で `decision: "block"`
            // を返し config 変更を拒否可能 (reason 付き)。
            //
            // matcher: user_settings / project_settings / local_settings /
            // policy_settings / skills (5 enum)。unknown source は "unknown" に畳む。
            const { handleConfigChange } = await import("./hooks/config-change.js");
            const raw = input;
            const ccRes = await handleConfigChange({
                hook_event_name: String(raw["hook_event_name"] ?? "ConfigChange"),
                source: extractString(raw, "source"),
                file_path: extractString(raw, "file_path"),
                session_id: extractString(raw, "session_id"),
                cwd: extractString(raw, "cwd"),
                transcript_path: extractString(raw, "transcript_path"),
            });
            const ccHR = { decision: ccRes.decision };
            if (ccRes.reason !== undefined) {
                ccHR.reason = ccRes.reason;
            }
            if (ccRes.additionalContext !== undefined) {
                ccHR.additionalContext = ccRes.additionalContext;
            }
            return ccHR;
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
export function errorToResult(err) {
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
            hookType === "subagent-stop" ||
            hookType === "task-created" ||
            hookType === "task-completed" ||
            hookType === "stop" ||
            hookType === "worktree-remove" ||
            hookType === "worktree-create" ||
            hookType === "user-prompt-submit" ||
            hookType === "post-tool-use-failure" ||
            hookType === "config-change") {
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
    else if (hookType === "worktree-create") {
        // WorktreeCreate blocking protocol:
        //   公式仕様 (https://code.claude.com/docs/en/hooks) により、command hook は
        //   raw absolute path を stdout に書き出す。exit 0 = 成功、any non-zero = 失敗。
        //
        //   - worktreePath 設定あり: raw path を stdout、exit 0
        //   - worktreePath 未設定: stderr に reason、exit 1 で blocking 失敗
        //
        //   additionalContext は systemMessage 経由で届くので、失敗時の debug 用に
        //   stderr にも流す (Claude Code の hook log に残る)。
        //
        //   `process.exitCode = 1; return;` pattern: `process.exit(1)` を即呼ぶと
        //   stderr / stdout の非同期 flush が完了する前に process が terminate し得る。
        //   main() を return で抜けて Node.js event loop 自然終了に任せることで、
        //   drain 後に exit code 1 で terminate することを保証する (stream 書込ロスト回避)。
        if (typeof result.worktreePath === "string" && result.worktreePath !== "") {
            process.stdout.write(result.worktreePath + "\n");
        }
        else {
            if (result.reason) {
                process.stderr.write(result.reason + "\n");
            }
            if (result.systemMessage) {
                process.stderr.write(result.systemMessage + "\n");
            }
            process.exitCode = 1;
        }
    }
    else if (hookType === "user-prompt-submit" ||
        hookType === "post-tool-use-failure" ||
        hookType === "config-change") {
        // UserPromptSubmit / PostToolUseFailure / ConfigChange: 公式仕様
        // (https://code.claude.com/docs/en/hooks) の
        // `hookSpecificOutput.additionalContext` / `sessionTitle` に lift して
        // stdout に JSON を書く。decision=block 時は top-level の decision/reason
        // も load する (ConfigChange では opt-in block、UserPromptSubmit では
        // prompt 拒否)。
        //
        // hookEventName mapping (公式 event 名 vs harness dispatch 名):
        //   - user-prompt-submit → "UserPromptSubmit"
        //   - post-tool-use-failure → "PostToolUseFailure"
        //   - config-change → "ConfigChange"
        // content-integrity invariant (see __tests__/content-integrity.test.ts):
        // `hookEventName` 識別子から 100 chars 以内に各公式 event 名リテラルが
        // 並ぶこと。inline lookup table で 3 branch (将来 4+ も) を表現する。
        const hookEventName = {
            "user-prompt-submit": "UserPromptSubmit",
            "post-tool-use-failure": "PostToolUseFailure",
            "config-change": "ConfigChange",
        }[hookType] ?? "UserPromptSubmit";
        const out = {};
        if (result.decision === "block") {
            out["decision"] = "block";
            if (result.reason)
                out["reason"] = result.reason;
        }
        const hso = { hookEventName };
        let hsoHasPayload = false;
        if (result.additionalContext !== undefined) {
            hso["additionalContext"] = result.additionalContext;
            hsoHasPayload = true;
        }
        if (result.sessionTitle !== undefined) {
            hso["sessionTitle"] = result.sessionTitle;
            hsoHasPayload = true;
        }
        if (hsoHasPayload) {
            out["hookSpecificOutput"] = hso;
        }
        // Universal control fields (continue / stopReason / suppressOutput) は
        // 公式 top-level 仕様なのでそのまま lift。
        if (result.continue !== undefined)
            out["continue"] = result.continue;
        if (result.stopReason !== undefined)
            out["stopReason"] = result.stopReason;
        if (result.suppressOutput !== undefined) {
            out["suppressOutput"] = result.suppressOutput;
        }
        process.stdout.write(JSON.stringify(out) + "\n");
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