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
import {
  handleTaskCreated,
  handleTaskCompleted,
} from "../hooks/task-lifecycle.js";
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
  hasSrc?: boolean;
  hasApp?: boolean;
  hasTests?: boolean;
  hasPackageJson?: boolean;
  harnessConfig?: Record<string, unknown>;
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
  if (opts?.hasSrc) {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "__init__.py"), "", "utf-8");
  }
  if (opts?.hasApp) {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "__init__.py"), "", "utf-8");
  }
  if (opts?.hasTests) {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "test_dummy.py"), "def test_ok(): pass\n", "utf-8");
  }
  if (opts?.hasPackageJson) {
    writeFileSync(join(dir, "package.json"), '{"name":"test"}', "utf-8");
  }
  if (opts?.harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(opts.harnessConfig),
      "utf-8",
    );
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

  it("pyproject.toml + 主要 Python layout (src/ / app/) で ruff/mypy を検出する", async () => {
    // stack-neutral default `["src", "app"]` に合わせて src/ を作成。
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.ciTriggered).toBe(true);
    expect(result.ciResults).toBeDefined();
    const tools = result.ciResults?.map((r) => r.tool) ?? [];
    expect(tools).toContain("ruff");
    expect(tools).toContain("mypy");

  });

  it("tests/ がある場合 pytest も検出する", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true, hasTests: true });
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
    // stack-neutral default `["src", "app"]` に合わせて src/ を作成。
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true });
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

  it("execSync が失敗したら passed: false, output に stdout を含む", async () => {
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedExecSync as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown }).mockImplementation(
      (...args: unknown[]) => {
        const cmd = String(args[0]);
        if (cmd.includes("ruff")) {
          const err = new Error("ruff failed") as Error & { stdout?: unknown };
          err.stdout = "src/main.py:1: F401 unused import\n";
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
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true, hasTests: true });
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
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true });
    const result = await handleSubagentStop({ ...baseInput, cwd: dir });
    expect(result.additionalContext).toContain("全 CI チェック PASS");
  });
});

describe("detectAvailableChecks (stack-neutral default ['src', 'app'] + tooling.pythonCandidateDirs override)", () => {
  it("Python layout が 1 つも無ければ ruff/mypy を skip (false positive 回避)", () => {
    // `.` fallback を禁じているので、src/ / app/ がなければ ruff/mypy を
    // スキップ。pyproject.toml だけでは lint は走らない。
    const dir = makeTempProject({ hasPyproject: true });
    const checks = detectAvailableChecks(dir);
    const tools = checks.map((c) => c.tool);
    expect(tools).not.toContain("ruff");
    expect(tools).not.toContain("mypy");
  });

  it("default で src/ を ruff / mypy target にする", () => {
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    const mypy = checks.find((c) => c.tool === "mypy");
    expect(ruff?.command).toContain("ruff check src/");
    expect(mypy?.command).toContain("mypy src/");
  });

  it("default で app/ を ruff / mypy target にする", () => {
    const dir = makeTempProject({ hasPyproject: true, hasApp: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("app/");
  });

  it("default では backend/ を ruff target に含めない (stack-neutral: backend は opt-in)", () => {
    // default は `["src", "app"]`。backend/ レイアウトを使うプロジェクトは
    // harness.config.json の tooling.pythonCandidateDirs で明示 override する。
    const dir = makeTempProject({ hasPyproject: true, hasBackend: true });
    const checks = detectAvailableChecks(dir);
    const tools = checks.map((c) => c.tool);
    // backend/ だけでは src/ / app/ 不在扱い → ruff / mypy は skip。
    expect(tools).not.toContain("ruff");
    expect(tools).not.toContain("mypy");
  });

  it("src/ + app/ の両方があれば両方を ruff target にする", () => {
    const dir = makeTempProject({ hasPyproject: true, hasSrc: true, hasApp: true });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");
    expect(ruff?.command).toContain("app/");
  });

  it("harness.config.json で tooling.pythonCandidateDirs=['backend'] を override すると backend が target になる", () => {
    const dir = makeTempProject({
      hasPyproject: true,
      hasBackend: true,
      harnessConfig: { tooling: { pythonCandidateDirs: ["backend"] } },
    });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    const mypy = checks.find((c) => c.tool === "mypy");
    expect(ruff?.command).toContain("backend/");
    expect(mypy?.command).toContain("backend/");
  });

  it("tooling.pythonCandidateDirs=['backend', 'src'] で backend + src の両方が target になる", () => {
    const dir = makeTempProject({
      hasPyproject: true,
      hasBackend: true,
      hasSrc: true,
      harnessConfig: { tooling: { pythonCandidateDirs: ["backend", "src"] } },
    });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("backend/");
    expect(ruff?.command).toContain("src/");
  });

  it("shape-invalid tooling config (非配列 / 非文字列) では default にフォールバック (fail-open)", () => {
    // Codex M-1A 方針: config が壊れていても throw せず default。
    const dir = makeTempProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: { tooling: { pythonCandidateDirs: "not-an-array" } },
    });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    // default `["src", "app"]` にフォールバック → src/ が拾われる
    expect(ruff?.command).toContain("src/");
  });

  it("空配列の tooling.pythonCandidateDirs は default にフォールバック (安全側)", () => {
    const dir = makeTempProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: { tooling: { pythonCandidateDirs: [] } },
    });
    const checks = detectAvailableChecks(dir);
    const ruff = checks.find((c) => c.tool === "ruff");
    // 空配列だと target が無いので、defaults を使う方が user intent に近い。
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

  it("tests/ があれば pytest が追加される (src/app/backend 有無と独立)", () => {
    const dir = makeTempProject({ hasPyproject: true, hasTests: true });
    const checks = detectAvailableChecks(dir);
    const pytest = checks.find((c) => c.tool === "pytest");
    expect(pytest).toBeDefined();
    expect(pytest?.command).toContain("pytest tests/");
  });
});

describe("handleTaskCreated / handleTaskCompleted (Codex M-1B: config-driven coverage)", () => {
  const baseInput = {
    hook_event_name: "TaskCreated",
    session_id: "sess-test",
    task_id: "T-42",
    task_subject: "Add tests",
  };

  it("Plans.md が存在する場合、reminder を生成する (default plansFile)", async () => {
    const dir = makeTempProject({ plansContent: "# Plans\n" });
    const result = await handleTaskCreated({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("Add tests");
    expect(result.additionalContext).toContain("Plans.md");
    expect(result.additionalContext).toContain("assignment section");
  });

  it("Plans.md が存在しない場合、reminder は出さない", async () => {
    const dir = makeTempProject();
    const result = await handleTaskCreated({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("Add tests");
    expect(result.additionalContext).not.toContain("assignment section");
  });

  it("harness.config.json で `work.plansFile` を override できる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-tl-"));
    tempDirs.push(dir);
    // custom plans file name
    writeFileSync(join(dir, "TODO.md"), "# TODO\n", "utf-8");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ work: { plansFile: "TODO.md" } }),
      "utf-8",
    );
    const result = await handleTaskCreated({ ...baseInput, cwd: dir });
    expect(result.additionalContext).toContain("TODO.md");
    expect(result.additionalContext).not.toContain("Plans.md");
  });

  it("shape-invalid config (plansFile が number) でも hook が throw しない (fail-open)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-tl-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ work: { plansFile: 123 } }),
      "utf-8",
    );
    writeFileSync(join(dir, "Plans.md"), "# Plans\n", "utf-8");
    const result = await handleTaskCreated({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    // fall back to default "Plans.md"
    expect(result.additionalContext).toContain("Add tests");
  });

  it("broken config.json でも hook は throw せず fallback する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-tl-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "harness.config.json"), "{ invalid json", "utf-8");
    writeFileSync(join(dir, "Plans.md"), "# Plans\n", "utf-8");
    const result = await handleTaskCreated({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
  });

  it("handleTaskCompleted も同じ config 経路で動作する", async () => {
    const dir = makeTempProject({ plansContent: "# Plans\n" });
    const result = await handleTaskCompleted({
      ...baseInput,
      hook_event_name: "TaskCompleted",
      cwd: dir,
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("Add tests");
    expect(result.additionalContext).toContain("completion section");
  });
});

describe("handlePreCompact config override (Codex M-1B)", () => {
  const baseInput = {
    hook_event_name: "PreCompact",
    session_id: "sess-test",
    trigger: "auto",
  };

  it("custom `work.assignmentSectionMarkers` で日本語マーカーを差し替え可能", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-pc-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "Plans.md"),
      "# Plans\n\n## 進捗表\n| task | status |\n|---|---|\n| T-1 | doing |\n",
      "utf-8",
    );
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ work: { assignmentSectionMarkers: ["進捗表"] } }),
      "utf-8",
    );
    const result = await handlePreCompact({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("進捗表");
  });

  it("custom `work.plansFile` 経由で TODO.md を読み込める", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-pc-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "TODO.md"),
      "# TODO\n\n## Assignment\n| a | b |\n|---|---|\n",
      "utf-8",
    );
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ work: { plansFile: "TODO.md" } }),
      "utf-8",
    );
    const result = await handlePreCompact({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("Assignment");
  });

  it("shape-invalid config (markers が string) でも hook は throw しない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-test-pc-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "Plans.md"),
      "# Plans\n\n## 担当表\n| task |\n|---|\n",
      "utf-8",
    );
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ work: { assignmentSectionMarkers: "not-an-array" } }),
      "utf-8",
    );
    const result = await handlePreCompact({ ...baseInput, cwd: dir });
    expect(result.decision).toBe("approve");
    // fallback default markers が効いて担当表を拾う
    expect(result.additionalContext).toContain("担当表");
  });
});

// NOTE: previous revisions carried a tautological `expect(true).toBe(true)`
// describe block here as a design-intent pointer to `generality.test.ts`'s
// internal `parseExemption()` function. That tautology was removed — see
// `generality.test.ts` for the actual runtime assertions covering the
// exemption parser invariants (body-less / whitespace / `*` / pattern-id
// missing rejection).
