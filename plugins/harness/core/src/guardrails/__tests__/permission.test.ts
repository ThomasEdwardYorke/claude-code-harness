/**
 * core/src/guardrails/__tests__/permission.test.ts
 * permission.ts 単体テスト
 *
 * permission-request.sh の全ロジックが正しく移植されていることを検証する。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { evaluatePermission, formatPermissionOutput } from "../permission.js";
import type { HookInput } from "../../types.js";

// fs モジュールをモック
vi.mock("node:fs");

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

function makeInput(
  toolName: string,
  toolInput: Record<string, unknown> = {},
  cwd = "/project"
): HookInput {
  const input: HookInput = { tool_name: toolName, tool_input: toolInput };
  input.cwd = cwd;
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  // デフォルト: 許可リストファイルは存在しない
  mockedExistsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// Edit / Write の自動承認
// ============================================================
describe("Edit / Write の自動承認", () => {
  it("Edit ツールを自動承認する", () => {
    const result = evaluatePermission(
      makeInput("Edit", { file_path: "/project/src/foo.ts" })
    );
    // approve が返り、systemMessage に PermissionRequest JSON が含まれる
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeDefined();
    const parsed = JSON.parse(result.systemMessage!);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("Write ツールを自動承認する", () => {
    const result = evaluatePermission(
      makeInput("Write", { file_path: "/project/src/bar.ts", content: "" })
    );
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeDefined();
    const parsed = JSON.parse(result.systemMessage!);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("MultiEdit ツールを自動承認する", () => {
    const result = evaluatePermission(makeInput("MultiEdit"));
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeDefined();
  });
});

// ============================================================
// Bash: read-only git コマンドの自動承認
// ============================================================
describe("Bash: read-only git コマンドの自動承認", () => {
  const readOnlyGitCmds = [
    "git status",
    "git diff",
    "git log --oneline -5",
    "git branch -a",
    "git rev-parse HEAD",
    "git show HEAD",
    "git ls-files",
  ];

  for (const cmd of readOnlyGitCmds) {
    it(`${cmd} を自動承認する`, () => {
      const result = evaluatePermission(
        makeInput("Bash", { command: cmd })
      );
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      const parsed = JSON.parse(result.systemMessage!);
      expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
    });
  }
});

// ============================================================
// Bash: npm/pnpm/yarn — 許可リストなしは不承認（approve のみ）
// ============================================================
describe("Bash: npm/pnpm/yarn — 許可リストなしは不承認", () => {
  it("許可リストがない場合 npm test はデフォルト動作（approve）", () => {
    mockedExistsSync.mockReturnValue(false);
    const result = evaluatePermission(
      makeInput("Bash", { command: "npm test" })
    );
    // 安全でないため systemMessage なしの approve
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeUndefined();
  });
});

// ============================================================
// Bash: npm/pnpm/yarn — 許可リストありは自動承認
// ============================================================
describe("Bash: npm/pnpm/yarn — 許可リストありは自動承認", () => {
  beforeEach(() => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ allowed: true }) as unknown as Buffer
    );
  });

  const pkgCmds = [
    "npm test",
    "npm run test",
    "npm run lint",
    "npm run typecheck",
    "npm run build",
    "npm run validate",
    "pnpm test",
    "yarn test",
    "yarn lint",
  ];

  for (const cmd of pkgCmds) {
    it(`${cmd} を自動承認する（許可リストあり）`, () => {
      const result = evaluatePermission(
        makeInput("Bash", { command: cmd })
      );
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      const parsed = JSON.parse(result.systemMessage!);
      expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
    });
  }
});

// ============================================================
// Bash: Python / Go / Rust テストの自動承認
// ============================================================
describe("Bash: Python / Go / Rust テストの自動承認", () => {
  const safeCmds = [
    "pytest",
    "pytest -v",
    "python -m pytest",
    "go test ./...",
    "cargo test",
  ];

  for (const cmd of safeCmds) {
    it(`${cmd} を自動承認する`, () => {
      const result = evaluatePermission(
        makeInput("Bash", { command: cmd })
      );
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
    });
  }
});

// ============================================================
// Bash: シェル特殊文字を含むコマンドは不承認
// ============================================================
describe("Bash: シェル特殊文字を含むコマンドは不承認", () => {
  const dangerousCmds = [
    "git status | grep modified",
    "npm test && git push",
    "npm test; echo done",
    "echo $HOME",
    "cat file > output",
    "cmd `dangerous`",
  ];

  for (const cmd of dangerousCmds) {
    it(`"${cmd}" はデフォルト動作（approve のみ）`, () => {
      const result = evaluatePermission(
        makeInput("Bash", { command: cmd })
      );
      // 保守的：approve は返すが systemMessage（自動承認）はなし
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeUndefined();
    });
  }
});

// ============================================================
// Bash: その他のツールはスルー
// ============================================================
describe("その他のツールはデフォルト動作", () => {
  const otherTools = ["Read", "Glob", "Grep", "Task", "Skill"];

  for (const tool of otherTools) {
    it(`${tool} はデフォルト動作（approve）`, () => {
      const result = evaluatePermission(makeInput(tool));
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeUndefined();
    });
  }
});

// ============================================================
// formatPermissionOutput
// ============================================================
describe("formatPermissionOutput", () => {
  it("PermissionResponse JSON を含む systemMessage を正しく出力する", () => {
    const result = evaluatePermission(
      makeInput("Edit", { file_path: "/project/src/foo.ts" })
    );
    const output = formatPermissionOutput(result);
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("systemMessage がない場合は通常の HookResult を出力する", () => {
    const result = evaluatePermission(makeInput("Bash", { command: "rm -rf /" }));
    const output = formatPermissionOutput(result);
    const parsed = JSON.parse(output);
    expect(parsed.decision).toBe("approve");
  });
});
