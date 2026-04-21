/**
 * hooks/subagent-stop.ts
 *
 * SubagentStop hook handler.
 * Fires when a subagent completes. For worker agents, runs a lightweight
 * CI safety net (ruff/mypy/pytest) to catch regressions before the
 * coordinator proceeds.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { loadConfigSafe } from "../config.js";

export interface SubagentStopInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  agent_type?: string | undefined;
  agent_id?: string | undefined;
  agent_transcript_path?: string | undefined;
  last_assistant_message?: string | undefined;
}

export interface CiCheckResult {
  tool: string;
  passed: boolean;
  output: string;
}

export interface SubagentStopResult {
  decision: "approve";
  ciTriggered: boolean;
  ciResults?: CiCheckResult[];
  additionalContext?: string;
}

const WORKER_AGENT_TYPES = new Set(["worker", "harness:worker"]);

function runCiCheck(
  tool: string,
  command: string,
  projectRoot: string,
): CiCheckResult {
  try {
    const output = execSync(command, {
      cwd: projectRoot,
      timeout: 30000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { tool, passed: true, output: output.slice(0, 500) };
  } catch (err) {
    const message =
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: unknown }).stdout).slice(0, 500)
        : "check failed";
    return { tool, passed: false, output: message };
  }
}

/**
 * pyproject.toml の存在だけで一律 `.` を lint 対象にすると node_modules / .venv
 * を拾って false positive を量産する。実レイアウトを検出して lint target を
 * 絞り込む。候補ディレクトリは `harness.config.json` の `tooling.pythonCandidateDirs`
 * で上書き可能 (stack-neutral default は `["src", "app"]`、`backend/` レイアウト
 * を使うプロジェクトは明示 override する)。
 *
 * 設計メモ:
 * - fail-open 方針 (pre-compact.ts / task-lifecycle.ts と同じ): config の shape が
 *   壊れていても throw せず default にフォールバック。ただし `stop.ts` の先例に
 *   従い、default に落ちた **理由** を `stderr` に emit して silent failure を
 *   防ぐ (コマンド本体は止めない)。
 * - `backend/src/app` いずれかを検出できた場合のみ ruff / mypy を登録、
 *   pytest は `tests/` 独立判定で別枝。
 */
function resolvePythonCandidateDirs(projectRoot: string): string[] {
  const fallback = ["src", "app"];
  try {
    const config = loadConfigSafe(projectRoot);
    const raw = (config.tooling as { pythonCandidateDirs?: unknown } | undefined)
      ?.pythonCandidateDirs;
    if (raw === undefined) {
      // 未指定は静かに default で OK (よくある case)。
      return fallback;
    }
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((d) => typeof d === "string" && d.length > 0)
    ) {
      return raw as string[];
    }
    // Shape-invalid (non-array / empty array / non-string / empty-string entries)。
    // 警告し、安全側の default に落ちる。
    process.stderr.write(
      "[harness subagent-stop] tooling.pythonCandidateDirs shape invalid; using defaults " +
        `["src", "app"] (got ${JSON.stringify(raw)})\n`,
    );
    return fallback;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[harness subagent-stop] tooling.pythonCandidateDirs resolution failed; using defaults: ${msg}\n`,
    );
    return fallback;
  }
}

export function detectAvailableChecks(
  projectRoot: string,
): Array<{ tool: string; command: string }> {
  const checks: Array<{ tool: string; command: string }> = [];

  if (existsSync(resolve(projectRoot, "pyproject.toml"))) {
    const candidateDirs = resolvePythonCandidateDirs(projectRoot);
    const pyTargets = candidateDirs
      .filter((d) => existsSync(resolve(projectRoot, d)))
      .map((d) => `${d}/`);

    if (pyTargets.length > 0) {
      const target = pyTargets.join(" ");
      checks.push(
        { tool: "ruff", command: `ruff check ${target} --no-fix 2>&1` },
        { tool: "mypy", command: `mypy ${target} --no-error-summary 2>&1` },
      );
    }
    // backend/src/app が無い Python repo は ruff/mypy を skip (false positive 回避)。
    // pytest は tests/ の独立判定で別枝。

    if (existsSync(resolve(projectRoot, "tests"))) {
      checks.push({
        tool: "pytest",
        command: "pytest tests/ --tb=short -q --no-header 2>&1",
      });
    }
  }

  if (existsSync(resolve(projectRoot, "package.json"))) {
    checks.push({
      tool: "typecheck",
      command: "npx tsc --noEmit 2>&1",
    });
  }

  return checks;
}

export async function handleSubagentStop(
  input: SubagentStopInput,
): Promise<SubagentStopResult> {
  const agentType = input.agent_type ?? "";
  const isWorker = WORKER_AGENT_TYPES.has(agentType);

  if (!isWorker) {
    return { decision: "approve", ciTriggered: false };
  }

  const projectRoot = input.cwd ?? process.cwd();
  const checks = detectAvailableChecks(projectRoot);

  if (checks.length === 0) {
    return {
      decision: "approve",
      ciTriggered: true,
      ciResults: [],
      additionalContext: "SubagentStop: worker 完了、CI チェック対象なし",
    };
  }

  const results = checks.map((c) => runCiCheck(c.tool, c.command, projectRoot));
  const failed = results.filter((r) => !r.passed);

  const sections: string[] = [];
  sections.push("=== SubagentStop: Worker 完了後 CI チェック結果 ===");

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    sections.push(`[${status}] ${r.tool}`);
    if (!r.passed) {
      sections.push(r.output);
    }
  }

  if (failed.length > 0) {
    sections.push(`\n⚠ ${failed.length} 件の CI チェックが失敗。修正が必要です。`);
  } else {
    sections.push("\n全 CI チェック PASS");
  }

  sections.push("=== SubagentStop end ===");

  return {
    decision: "approve",
    ciTriggered: true,
    ciResults: results,
    additionalContext: sections.join("\n"),
  };
}
