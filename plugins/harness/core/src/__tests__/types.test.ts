/**
 * core/src/__tests__/types.test.ts
 * 型定義の基本的な整合性チェック
 */

import { describe, it, expect } from "vitest";
import type {
  HookInput,
  HookResult,
  GuardRule,
  Signal,
  TaskFailure,
  SessionState,
} from "../types.js";

describe("HookInput", () => {
  it("最小限のフィールドで構築できる", () => {
    const input: HookInput = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    expect(input.tool_name).toBe("Bash");
    expect(input.tool_input).toEqual({ command: "ls" });
  });

  it("オプションフィールドを含めて構築できる", () => {
    const input: HookInput = {
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.ts", content: "" },
      session_id: "sess-123",
      cwd: "/project",
      plugin_root: "/plugin",
    };
    expect(input.session_id).toBe("sess-123");
    expect(input.cwd).toBe("/project");
    expect(input.plugin_root).toBe("/plugin");
  });
});

describe("HookResult", () => {
  it("approve 決定を表現できる", () => {
    const result: HookResult = { decision: "approve" };
    expect(result.decision).toBe("approve");
  });

  it("deny 決定と理由を表現できる", () => {
    const result: HookResult = {
      decision: "deny",
      reason: "Protected path",
      systemMessage: "Cannot write to .git/",
    };
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("Protected path");
    expect(result.systemMessage).toBe("Cannot write to .git/");
  });

  it("ask 決定を表現できる", () => {
    const result: HookResult = {
      decision: "ask",
      reason: "Confirm git push?",
    };
    expect(result.decision).toBe("ask");
  });

  it("Phase κ-2 / θ optional fields (worktreePath / continue / stopReason / suppressOutput) を表現できる", () => {
    // 後方互換維持のための compile-time coverage:
    //   optional field 追加が引き続き optional のまま保たれ (required 化せず)、
    //   既存 consumer が decision のみで HookResult を構築できることを保証する。
    const minimal: HookResult = { decision: "approve" };
    expect(minimal.worktreePath).toBeUndefined();
    expect(minimal.continue).toBeUndefined();
    expect(minimal.stopReason).toBeUndefined();
    expect(minimal.suppressOutput).toBeUndefined();

    // WorktreeCreate 成功経路: worktreePath を持つ HookResult
    const worktreeSuccess: HookResult = {
      decision: "approve",
      worktreePath: "/abs/path/to/wt",
    };
    expect(worktreeSuccess.worktreePath).toBe("/abs/path/to/wt");

    // Universal control fields (Phase θ 最小 subset、公式 hooks-reference 準拠)
    const universal: HookResult = {
      decision: "approve",
      continue: false,
      stopReason: "user abort",
      suppressOutput: true,
    };
    expect(universal.continue).toBe(false);
    expect(universal.stopReason).toBe("user abort");
    expect(universal.suppressOutput).toBe(true);
  });
});

describe("GuardRule", () => {
  it("ルール構造が正しく構築できる", () => {
    const rule: GuardRule = {
      id: "block-git-dir",
      toolPattern: /^(Write|Edit)$/,
      evaluate: (ctx) => {
        const path = ctx.input.tool_input["file_path"];
        if (typeof path === "string" && path.includes(".git/")) {
          return { decision: "deny", reason: "Protected .git/ directory" };
        }
        return null;
      },
    };

    expect(rule.id).toBe("block-git-dir");
    expect(rule.toolPattern.test("Write")).toBe(true);
    expect(rule.toolPattern.test("Bash")).toBe(false);

    const mockCtx = {
      input: {
        tool_name: "Write",
        tool_input: { file_path: "/project/.git/config" },
      },
      projectRoot: "/project",
      workMode: false,
      codexMode: false,
      breezingRole: null,
    };

    const result = rule.evaluate(mockCtx);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("deny");
  });

  it("マッチしない場合は null を返す", () => {
    const rule: GuardRule = {
      id: "test-rule",
      toolPattern: /^Bash$/,
      evaluate: () => null,
    };
    expect(rule.evaluate({
      input: { tool_name: "Bash", tool_input: {} },
      projectRoot: "/project",
      workMode: false,
      codexMode: false,
      breezingRole: null,
    })).toBeNull();
  });
});

describe("Signal", () => {
  it("シグナルを構築できる", () => {
    const signal: Signal = {
      type: "task_completed",
      from_session_id: "sess-abc",
      payload: { task_id: "task-1", status: "success" },
      timestamp: new Date().toISOString(),
    };
    expect(signal.type).toBe("task_completed");
    expect(signal.from_session_id).toBe("sess-abc");
    expect(signal.to_session_id).toBeUndefined();
  });
});

describe("TaskFailure", () => {
  it("タスク失敗イベントを構築できる", () => {
    const failure: TaskFailure = {
      task_id: "task-1",
      severity: "error",
      message: "Build failed",
      timestamp: new Date().toISOString(),
      attempt: 1,
    };
    expect(failure.severity).toBe("error");
    expect(failure.attempt).toBe(1);
  });
});

describe("SessionState", () => {
  it("セッション状態を構築できる", () => {
    const state: SessionState = {
      session_id: "sess-xyz",
      mode: "work",
      project_root: "/project",
      started_at: new Date().toISOString(),
    };
    expect(state.mode).toBe("work");
  });
});
