/**
 * core/src/__tests__/hooks.test.ts
 * PreCompact / SubagentStop hook ハンドラのテスト。
 *
 * CodeRabbit PR #1 Major: hooks.test.ts:200 対応として child_process.execSync を mock 化し、
 * ローカル / CI / Windows 環境で ruff / mypy / pytest / npx が未インストールでも deterministic に
 * 成功 / 失敗 / timeout を検証できるようにする。
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";

// 注: vi.mock() は hoist されるため、実装モジュールの import より先に効く。
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { handlePreCompact } from "../hooks/pre-compact.js";
import { handleSubagentStop, detectAvailableChecks } from "../hooks/subagent-stop.js";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockedExecSync = vi.mocked(execSync);

const tempDirs: string[] = [];

beforeEach(() => {
  mockedExecSync.mockReset();
  // デフォルト: 各 execSync 呼出を成功として返す
  // - gh pr list: 空 array JSON
  // - git branch: "main"
  // - ruff/mypy/pytest/npx: 空文字列 (passed: true 扱い)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecSync as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown }).mockImplementation(
    (...args: unknown[]) => {
      const cmd = args[0];
      const s =
        typeof cmd === "string" ? cmd : Buffer.isBuffer(cmd) ? cmd.toString() : String(cmd);
      if (s.includes("gh pr list")) return "[]";
      if (s.includes("git branch")) return "main\n";
      return "";
    },
  );
});

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

  it("custom_instructions が渡されたら additionalContext に転載される (CodeRabbit PR #1 Major: pre-compact.ts:131)", async () => {
    const dir = makeTempProject();
    const result = await handlePreCompact({
      ...baseInput,
      cwd: dir,
      custom_instructions: "圧縮方針: 担当表と PR 一覧を最優先で保持",
    });
    expect(result.additionalContext).toContain("custom_instructions");
    expect(result.additionalContext).toContain("圧縮方針");
    expect(result.additionalContext).toContain("担当表と PR 一覧を最優先で保持");
  });

  it("custom_instructions が空文字列 / 空白のみの場合はセクションを出さない", async () => {
    const dir = makeTempProject();
    const result = await handlePreCompact({
      ...baseInput,
      cwd: dir,
      custom_instructions: "   \n  ",
    });
    expect(result.additionalContext).not.toContain("[custom_instructions]");
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

  it("execSync が失敗したら passed: false, output に stdout を含む (CodeRabbit PR #1 Major: hooks.test.ts:200)", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedExecSync as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown }).mockImplementation(
      (...args: unknown[]) => {
        const cmd = String(args[0]);
        if (cmd.includes("ruff")) {
          const err = new Error("ruff failed") as Error & { stdout?: unknown };
          err.stdout = "backend/main.py:1: F401 unused import\n";
          throw err;
        }
        return "";
      },
    );
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    const ruff = result.ciResults?.find((r) => r.tool === "ruff");
    expect(ruff?.passed).toBe(false);
    expect(ruff?.output).toContain("unused import");
  });

  it("execSync が stdout 無しで throw (timeout 相当) の場合 passed: false + fallback message", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true, hasTests: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedExecSync as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown }).mockImplementation(
      (...args: unknown[]) => {
        const cmd = String(args[0]);
        if (cmd.includes("pytest")) {
          // timeout 相当: stdout プロパティなしで throw
          throw new Error("Command timed out");
        }
        return "";
      },
    );
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    const pytest = result.ciResults?.find((r) => r.tool === "pytest");
    expect(pytest?.passed).toBe(false);
    expect(pytest?.output).toContain("check failed");
  });

  it("全 CI チェック pass 時は additionalContext に '全 CI チェック PASS' を含む", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.additionalContext).toContain("全 CI チェック PASS");
  });
});

describe("detectAvailableChecks (CodeRabbit PR #1 Major: subagent-stop.ts:75 + Codex 敵対的レビュー Minor)", () => {
  it("backend/ / src/ / app/ が無い pyproject.toml repo では ruff/mypy を skip (false positive 回避)", () => {
    // 旧: `.` fallback で root lint → node_modules / .venv を大量拾いして false positive 発生。
    // 新: 主要 Python layout が 1 つも無ければ ruff/mypy を skip (safer default)。
    const dir = makeTempProject({ hasPyproject: true, hasBackend: false });
    const checks = detectAvailableChecks(dir);
    const tools = checks.map((c) => c.tool);
    expect(tools).not.toContain("ruff");
    expect(tools).not.toContain("mypy");
  });

  it("backend/ があれば backend/ で lint する (現行レイアウト)", () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    const mypy = checks.find((c) => c.tool === "mypy");
    expect(ruff?.command).toContain("ruff check backend/");
    expect(mypy?.command).toContain("mypy backend/");
  });

  it("src/ レイアウトが検出されたら src/ も target に含める", () => {
    const dir = makeTempProject({ hasPyproject: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");
  });

  it("app/ レイアウトが検出されたら app/ も target に含める", () => {
    const dir = makeTempProject({ hasPyproject: true });
    mkdirSync(join(dir, "app"), { recursive: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("app/");
  });

  it("backend/ と src/ が両方あれば両方を target にする", () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("backend/");
    expect(ruff?.command).toContain("src/");
  });

  it("pyproject.toml 無しで package.json だけでは typecheck のみ検出", () => {
    const dir = makeTempProject({ hasPackageJson: true });
    const checks = detectAvailableChecks(dir);
    const tools = checks.map((c) => c.tool);
    expect(tools).toEqual(["typecheck"]);
    expect(checks[0]?.command).toContain("npx tsc --noEmit");
  });

  it("どの project marker も無ければ空配列", () => {
    const dir = makeTempProject();
    const checks = detectAvailableChecks(dir);
    expect(checks).toEqual([]);
  });

  it("tests/ があれば pytest が追加される (backend/src/app 有無と独立)", () => {
    const dir = makeTempProject({ hasPyproject: true, hasBackend: false, hasTests: true });
    const checks = detectAvailableChecks(dir);
    const pytest = checks.find((c) => c.tool === "pytest");
    expect(pytest).toBeDefined();
    expect(pytest?.command).toContain("pytest tests/");
  });
});
