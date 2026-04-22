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

type HookType =
  | "pre-tool"
  | "post-tool"
  | "permission"
  | "session-start"
  | "session-end"
  | "pre-compact"
  | "subagent-stop"
  | "task-created"
  | "task-completed"
  | "stop"
  | "worktree-remove"
  | "worktree-create";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseInput(raw: string): HookInput {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("tool_name" in parsed) ||
    typeof (parsed as Record<string, unknown>)["tool_name"] !== "string"
  ) {
    throw new Error("Invalid hook input: missing required field 'tool_name'");
  }
  const obj = parsed as Record<string, unknown>;
  const result: HookInput = {
    tool_name: obj["tool_name"] as string,
    tool_input:
      typeof obj["tool_input"] === "object" && obj["tool_input"] !== null
        ? (obj["tool_input"] as Record<string, unknown>)
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
function parseSessionInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

function extractString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

export async function route(
  hookType: HookType,
  input: HookInput | Record<string, unknown>,
): Promise<HookResult> {
  switch (hookType) {
    case "pre-tool": {
      const { evaluatePreTool } = await import("./guardrails/pre-tool.js");
      return evaluatePreTool(input as HookInput);
    }
    case "post-tool": {
      const { evaluatePostTool } = await import("./guardrails/post-tool.js");
      return evaluatePostTool(input as HookInput);
    }
    case "permission": {
      const { evaluatePermission, formatPermissionOutput } = await import(
        "./guardrails/permission.js"
      );
      const permResult = evaluatePermission(input as HookInput);
      const permJson = formatPermissionOutput(permResult);
      return { decision: permResult.decision, systemMessage: permJson };
    }
    case "pre-compact": {
      const { handlePreCompact } = await import("./hooks/pre-compact.js");
      const raw = input as Record<string, unknown>;
      const compactResult = await handlePreCompact({
        hook_event_name: String(raw["hook_event_name"] ?? "PreCompact"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        trigger: extractString(raw, "trigger"),
        custom_instructions: extractString(raw, "custom_instructions"),
      });
      const compactHookResult: HookResult = { decision: compactResult.decision };
      if (compactResult.additionalContext !== undefined) {
        compactHookResult.reason = compactResult.additionalContext;
      }
      return compactHookResult;
    }
    case "subagent-stop": {
      const { handleSubagentStop } = await import("./hooks/subagent-stop.js");
      const raw = input as Record<string, unknown>;
      const stopResult = await handleSubagentStop({
        hook_event_name: String(raw["hook_event_name"] ?? "SubagentStop"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        agent_type: extractString(raw, "agent_type"),
        agent_id: extractString(raw, "agent_id"),
        agent_transcript_path: extractString(raw, "agent_transcript_path"),
        last_assistant_message: extractString(raw, "last_assistant_message"),
      });
      const stopHookResult: HookResult = { decision: stopResult.decision };
      if (stopResult.additionalContext !== undefined) {
        stopHookResult.reason = stopResult.additionalContext;
      }
      return stopHookResult;
    }
    case "task-created": {
      const { handleTaskCreated } = await import("./hooks/task-lifecycle.js");
      const raw = input as Record<string, unknown>;
      const taskResult = await handleTaskCreated({
        hook_event_name: String(raw["hook_event_name"] ?? "TaskCreated"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        task_id: extractString(raw, "task_id"),
        task_subject: extractString(raw, "task_subject"),
        task_status: extractString(raw, "task_status"),
      });
      const taskHookResult: HookResult = { decision: taskResult.decision };
      if (taskResult.additionalContext !== undefined) {
        taskHookResult.reason = taskResult.additionalContext;
      }
      return taskHookResult;
    }
    case "task-completed": {
      const { handleTaskCompleted } = await import("./hooks/task-lifecycle.js");
      const raw = input as Record<string, unknown>;
      const taskResult = await handleTaskCompleted({
        hook_event_name: String(raw["hook_event_name"] ?? "TaskCompleted"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        task_id: extractString(raw, "task_id"),
        task_subject: extractString(raw, "task_subject"),
        task_status: extractString(raw, "task_status"),
      });
      const taskHookResult: HookResult = { decision: taskResult.decision };
      if (taskResult.additionalContext !== undefined) {
        taskHookResult.reason = taskResult.additionalContext;
      }
      return taskHookResult;
    }
    case "stop": {
      const { handleStop } = await import("./hooks/stop.js");
      const raw = input as Record<string, unknown>;
      const stopRes = await handleStop({
        hook_event_name: String(raw["hook_event_name"] ?? "Stop"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
      });
      const stopHR: HookResult = { decision: stopRes.decision };
      if (stopRes.additionalContext !== undefined) {
        stopHR.reason = stopRes.additionalContext;
      }
      return stopHR;
    }
    case "worktree-remove": {
      const { handleWorktreeRemove } = await import(
        "./hooks/worktree-lifecycle.js"
      );
      const raw = input as Record<string, unknown>;
      const wrRes = await handleWorktreeRemove({
        hook_event_name: String(raw["hook_event_name"] ?? "WorktreeRemove"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        worktree_path: extractString(raw, "worktree_path"),
        agent_type: extractString(raw, "agent_type"),
        agent_id: extractString(raw, "agent_id"),
        transcript_path: extractString(raw, "transcript_path"),
      });
      const wrHR: HookResult = { decision: wrRes.decision };
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
      const { handleWorktreeCreate } = await import(
        "./hooks/worktree-lifecycle.js"
      );
      const raw = input as Record<string, unknown>;
      const wcRes = await handleWorktreeCreate({
        hook_event_name: String(raw["hook_event_name"] ?? "WorktreeCreate"),
        session_id: extractString(raw, "session_id"),
        cwd: extractString(raw, "cwd"),
        name: extractString(raw, "name"),
        agent_type: extractString(raw, "agent_type"),
        agent_id: extractString(raw, "agent_id"),
        transcript_path: extractString(raw, "transcript_path"),
      });
      const wcHR: HookResult = { decision: wcRes.decision };
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
export function errorToResult(err: unknown): HookResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    decision: "approve",
    reason: `Core engine error (safe fallback): ${message}`,
  };
}

async function main(): Promise<void> {
  const hookType = (process.argv[2] ?? "pre-tool") as HookType;
  let result: HookResult;

  try {
    const raw = await readStdin();

    if (
      hookType === "session-start" ||
      hookType === "session-end" ||
      hookType === "pre-compact" ||
      hookType === "subagent-stop" ||
      hookType === "task-created" ||
      hookType === "task-completed" ||
      hookType === "stop" ||
      hookType === "worktree-remove" ||
      hookType === "worktree-create"
    ) {
      const parsed = parseSessionInput(raw);
      result = await route(hookType, parsed);
    } else if (!raw.trim()) {
      result = { decision: "approve", reason: "Empty input" };
    } else {
      const input = parseInput(raw);
      result = await route(hookType, input);
    }
  } catch (err) {
    result = errorToResult(err);
  }

  if (hookType === "permission" && result.systemMessage !== undefined) {
    process.stdout.write(result.systemMessage + "\n");
  } else if (hookType === "worktree-create") {
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
    } else {
      if (result.reason) {
        process.stderr.write(result.reason + "\n");
      }
      if (result.systemMessage) {
        process.stderr.write(result.systemMessage + "\n");
      }
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}

// Only run main() when this module is the entry point — tests import safely.
const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("\\index.js"));
if (isEntry) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${message}\n`);
    process.exit(1);
  });
}
