/**
 * core/src/__tests__/hooks.test.ts
 * PreCompact / SubagentStop hook ハンドラのテスト
 */

import { describe, it, expect, afterEach } from "vitest";
import { handlePreCompact } from "../hooks/pre-compact.js";
import { handleSubagentStop } from "../hooks/subagent-stop.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempProject(opts?: {
  plansContent?: string;
  hasPyproject?: boolean;
  hasBackend?: boolean;
  hasTests?: boolean;
  hasPackageJson?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-test-"));
  tempDirs.push(dir);
  if (opts?.plansContent) {
    writeFileSync(join(dir, "Plans.md"), opts.plansContent, "utf-8");
  }
  if (opts?.hasPyproject) {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.ruff]\n", "utf-8");
  }
  if (opts?.hasBackend) {
    mkdirSync(join(dir, "backend"), { recursive: true });
    writeFileSync(join(dir, "backend", "__init__.py"), "", "utf-8");
  }
  if (opts?.hasTests) {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "test_dummy.py"), "def test_ok(): pass\n", "utf-8");
  }
  if (opts?.hasPackageJson) {
    writeFileSync(join(dir, "package.json"), '{"name":"test"}', "utf-8");
  }
  return dir;
}

describe("handlePreCompact", () => {
  const baseInput = {
    hook_event_name: "PreCompact",
    session_id: "sess-123",
    trigger: "auto",
  };

  it("担当表がない場合でも正常に動作する", async () => {
    const dir = makeTempProject();
    const result = await handlePreCompact({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(typeof result.additionalContext).toBe("string");

  });

  it("担当表を含む Plans.md がある場合に additionalContext に含まれる", async () => {
    const plans = `# Plans

## 担当表

| slug | task | status |
|---|---|---|
| crud | CRUD API | in_progress |
`;
    const dir = makeTempProject({ plansContent: plans });
    const result = await handlePreCompact({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("担当表");
    expect(result.additionalContext).toContain("crud");

  });

  it("trigger が manual でも auto でも動作する", async () => {
    const dir = makeTempProject();
    const autoResult = await handlePreCompact({ ...baseInput, cwd: dir, trigger: "auto" });
    const manualResult = await handlePreCompact({ ...baseInput, cwd: dir, trigger: "manual" });
    expect(autoResult.decision).toBe("approve");
    expect(manualResult.decision).toBe("approve");

  });

  it("cwd が未指定でも fallback する", async () => {
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      trigger: "auto",
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("PreCompact");
  });

  it("trigger が未指定の場合 unknown と表示する", async () => {
    const dir = makeTempProject();
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: dir,
    });
    expect(result.additionalContext).toContain("unknown");

  });

  it("custom_instructions が渡されても正常動作する", async () => {
    const dir = makeTempProject();
    const result = await handlePreCompact({
      ...baseInput,
      cwd: dir,
      custom_instructions: "keep the plan context",
    });
    expect(result.decision).toBe("approve");

  });

  it("存在しないディレクトリでも例外を投げない", async () => {
    const result = await handlePreCompact({
      ...baseInput,
      cwd: "/tmp/absolutely-nonexistent-" + Date.now(),
    });
    expect(result.decision).toBe("approve");
  });
});

describe("handleSubagentStop", () => {
  const baseInput = {
    hook_event_name: "SubagentStop",
    session_id: "sess-123",
    agent_type: "worker",
    agent_id: "agent-abc",
  };

  it("worker 完了時に ciTriggered=true を返す", async () => {
    const dir = makeTempProject();
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.ciTriggered).toBe(true);

  });

  it("reviewer では CI を実行しない", async () => {
    const result = await handleSubagentStop({
      ...baseInput,
      agent_type: "reviewer",
      cwd: "/tmp",
    });
    expect(result.decision).toBe("approve");
    expect(result.ciTriggered).toBe(false);
  });

  it("scaffolder では CI を実行しない", async () => {
    const result = await handleSubagentStop({
      ...baseInput,
      agent_type: "scaffolder",
      cwd: "/tmp",
    });
    expect(result.ciTriggered).toBe(false);
  });

  it("harness:worker でも CI をトリガーする", async () => {
    const dir = makeTempProject();
    const result = await handleSubagentStop({
      ...baseInput,
      agent_type: "harness:worker",
      cwd: dir,
    });
    expect(result.ciTriggered).toBe(true);

  });

  it("pyproject.toml がある場合 ruff/mypy を検出する", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.ciTriggered).toBe(true);
    expect(result.ciResults).toBeDefined();
    const tools = result.ciResults?.map((r) => r.tool) ?? [];
    expect(tools).toContain("ruff");
    expect(tools).toContain("mypy");

  });

  it("tests/ がある場合 pytest も検出する", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true, hasTests: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    const tools = result.ciResults?.map((r) => r.tool) ?? [];
    expect(tools).toContain("pytest");

  });

  it("package.json がある場合 typecheck を検出する", async () => {
    const dir = makeTempProject({ hasPackageJson: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    const tools = result.ciResults?.map((r) => r.tool) ?? [];
    expect(tools).toContain("typecheck");

  });

  it("CI チェック対象がない空プロジェクトでも正常動作する", async () => {
    const dir = makeTempProject();
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.ciTriggered).toBe(true);
    expect(result.ciResults).toEqual([]);
    expect(result.additionalContext).toContain("CI チェック対象なし");

  });

  it("agent_type が未指定の場合は CI を実行しない", async () => {
    const result = await handleSubagentStop({
      hook_event_name: "SubagentStop",
      cwd: "/tmp",
    });
    expect(result.ciTriggered).toBe(false);
  });

  it("additionalContext に CI 結果サマリを含む", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.additionalContext).toContain("SubagentStop");
    expect(result.additionalContext).toContain("Worker 完了後 CI チェック結果");

  });

  it("公式フィールド agent_transcript_path を受け取れる", async () => {
    const dir = makeTempProject();
    const result = await handleSubagentStop({
      ...baseInput,
      cwd: dir,
      agent_transcript_path: "/tmp/transcript.jsonl",
      last_assistant_message: "Done",
    });
    expect(result.decision).toBe("approve");

  });
});
