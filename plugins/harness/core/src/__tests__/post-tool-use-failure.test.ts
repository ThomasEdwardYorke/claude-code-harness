/**
 * core/src/__tests__/post-tool-use-failure.test.ts
 *
 * PostToolUseFailure hook handler のテスト。
 *
 * ## 設計方針
 *
 * - **observability hook**: 必ず `decision: "approve"`、失敗そのものを block せず
 *   `additionalContext` で Claude に診断 + hint を渡す。
 * - **fail-open**: config malformed / error 空 → silent skip で approve。
 * - **corrective hints**: 6 pattern の built-in hint (permission denied /
 *   no such file / command not found / signal abort / timeout / connection refused)。
 * - **truncate**: error 文字列が `maxErrorLength` 超なら truncate + marker。
 *
 * 公式仕様: https://code.claude.com/docs/en/hooks (PostToolUseFailure section)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handlePostToolUseFailure } from "../hooks/post-tool-use-failure.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempProject(harnessConfig?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-ptuf-test-"));
  tempDirs.push(dir);
  if (harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(harnessConfig),
      "utf-8",
    );
  }
  return dir;
}

function call(
  projectRoot: string,
  overrides: Partial<Parameters<typeof handlePostToolUseFailure>[0]> = {},
) {
  return handlePostToolUseFailure(
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      error: "",
      cwd: projectRoot,
      ...overrides,
    },
    { projectRoot },
  );
}

describe("PostToolUseFailure — fail-open and enable/disable", () => {
  it("config 不在 → default enabled、error 空 → no-op approve", async () => {
    const root = makeTempProject();
    const result = await call(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });

  it("enabled: false → additionalContext 未設定", async () => {
    const root = makeTempProject({ postToolUseFailure: { enabled: false } });
    const result = await call(root, { error: "Command exited with non-zero status code 1" });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });

  it("malformed harness.config.json → fail-open default", async () => {
    const root = mkdtempSync(join(tmpdir(), "harness-ptuf-malform-"));
    tempDirs.push(root);
    writeFileSync(join(root, "harness.config.json"), "{not-json", "utf-8");
    const result = await call(root, { error: "some error" });
    // fail-open: enabled defaults true、additionalContext 生成
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("some error");
  });

  it("error 空文字 → no-op approve", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "" });
    expect(result.additionalContext).toBeUndefined();
  });

  it("error 未指定 (undefined) → no-op approve", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: undefined });
    expect(result.additionalContext).toBeUndefined();
  });
});

describe("PostToolUseFailure — context injection", () => {
  it("error ある → [harness PostToolUseFailure] + tool name + error を含む", async () => {
    const root = makeTempProject();
    const result = await call(root, {
      tool_name: "Bash",
      error: "Command exited with non-zero status code 1",
    });
    expect(result.additionalContext).toContain("[harness PostToolUseFailure]");
    expect(result.additionalContext).toContain("tool=Bash");
    expect(result.additionalContext).toContain("Command exited with non-zero status code 1");
  });

  it("tool_name 未指定 → tool=unknown", async () => {
    const root = makeTempProject();
    const result = await call(root, { tool_name: undefined, error: "boom" });
    expect(result.additionalContext).toContain("tool=unknown");
  });

  it("is_interrupt: true → (interrupted) を含む", async () => {
    const root = makeTempProject();
    const result = await call(root, {
      error: "User requested cancellation",
      is_interrupt: true,
    });
    expect(result.additionalContext).toContain("(interrupted)");
  });

  it("is_interrupt: false → (interrupted) を含まない", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "boom", is_interrupt: false });
    expect(result.additionalContext).not.toContain("(interrupted)");
  });
});

describe("PostToolUseFailure — corrective hints", () => {
  it("permission denied → chmod / chown hint", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "bash: /etc/shadow: Permission denied" });
    expect(result.additionalContext).toContain("chmod");
  });

  it("no such file or directory → verify the path hint", async () => {
    const root = makeTempProject();
    const result = await call(root, {
      error: "cat: /nonexistent/file.txt: No such file or directory",
    });
    expect(result.additionalContext).toContain("verify the path");
  });

  it("command not found → install / alternative hint", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "bash: foobarxyz: command not found" });
    expect(result.additionalContext).toContain("install");
  });

  it("exit status 137 (SIGKILL/OOM) → signal-based abort hint", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "Process terminated with exit code 137" });
    expect(result.additionalContext).toContain("signal-based abort");
  });

  it("timed out → raise the timeout hint", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "Operation timed out after 30 seconds" });
    expect(result.additionalContext).toContain("timed out");
    expect(result.additionalContext).toContain("raise the timeout");
  });

  it("connection refused → verify URL / port hint", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "curl: (7) Connection refused" });
    expect(result.additionalContext).toContain("network endpoint unreachable");
  });

  it("unknown error pattern → hint なし (raw error のみ)", async () => {
    const root = makeTempProject();
    const result = await call(root, { error: "some-unique-error-xyz-123" });
    expect(result.additionalContext).toContain("some-unique-error-xyz-123");
    expect(result.additionalContext).not.toContain("hint:");
  });

  it("correctiveHints: false → hint 付与なし、raw error のみ", async () => {
    const root = makeTempProject({ postToolUseFailure: { correctiveHints: false } });
    const result = await call(root, { error: "Permission denied" });
    expect(result.additionalContext).toContain("Permission denied");
    expect(result.additionalContext).not.toContain("hint:");
    expect(result.additionalContext).not.toContain("chmod");
  });
});

describe("PostToolUseFailure — truncation", () => {
  it("maxErrorLength 超過 → truncate + marker", async () => {
    const big = "X".repeat(3000);
    const root = makeTempProject({ postToolUseFailure: { maxErrorLength: 512 } });
    const result = await call(root, { error: big });
    expect(result.additionalContext).toContain("[harness] error truncated at 512 chars");
    // raw full string 3000 は含まない
    expect(result.additionalContext!.length).toBeLessThan(2000);
  });

  it("maxErrorLength 未定義 → default 1024 適用", async () => {
    const big = "Y".repeat(2000);
    const root = makeTempProject();
    const result = await call(root, { error: big });
    expect(result.additionalContext).toContain("[harness] error truncated at 1024 chars");
  });

  it("maxErrorLength malformed → default 1024 fallback", async () => {
    const root = makeTempProject({ postToolUseFailure: { maxErrorLength: "huge" } });
    const result = await call(root, { error: "Z".repeat(2000) });
    expect(result.additionalContext).toContain("[harness] error truncated at 1024 chars");
  });

  it("maxErrorLength 下限 (256) より小さい → default 1024 fallback", async () => {
    const root = makeTempProject({ postToolUseFailure: { maxErrorLength: 10 } });
    const result = await call(root, { error: "a".repeat(100) });
    // 10 < 256 で fallback、100 文字は 1024 以下なので truncate 発生しない
    expect(result.additionalContext).toContain("a".repeat(100));
    expect(result.additionalContext).not.toContain("truncated");
  });
});
