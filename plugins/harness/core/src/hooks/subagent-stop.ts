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
import { loadConfigWithError } from "../config.js";

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
 *
 * ## セキュリティ: shell injection 防止
 *
 * `runCiCheck()` は dir name を shell command template に埋め込み `execSync`
 * で実行する。config / リポジトリから不信任入力 (例: `"$(touch PWNED)"`)
 * が到達すると command substitution で任意コード実行の余地が生まれる。
 * したがって各 entry は厳密な allowlist regex
 * `/^[a-zA-Z0-9_.-]+$/` (英数字 + `_` / `-` / `.` のみ、path separator /
 * 空白 / shell metachar 不可) に**必ず合致**することを要求し、不一致の
 * entries は reject + stderr 警告 + 残余があればそれを採用、全 reject
 * なら default にフォールバックする。
 */
const SAFE_DIR_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

function resolvePythonCandidateDirs(projectRoot: string): string[] {
  const fallback = ["src", "app"];

  // `loadConfigWithError` distinguishes "file absent" from "file broken"
  // so we surface a warning on parse failures (the old `loadConfigSafe`
  // path silently swallowed those, leaving this function with a dead
  // error branch: shape-invalid warnings fired, parse-level failures
  // never reached the check).
  const outcome = loadConfigWithError(projectRoot);
  if (outcome.error !== undefined) {
    process.stderr.write(
      `[harness subagent-stop] harness.config.json parse failed: ${outcome.error}; using defaults ["src", "app"].\n`,
    );
    return fallback;
  }

  const raw = (outcome.config.tooling as { pythonCandidateDirs?: unknown } | undefined)
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
    // Shell-injection ガード: allowlist regex 外の entry は reject し、
    // shell metacharacter / path separator / whitespace を含む候補が
    // `execSync` へ届かないことを保証。
    const safe: string[] = [];
    const rejected: string[] = [];
    for (const d of raw as string[]) {
      if (SAFE_DIR_NAME_REGEX.test(d)) {
        safe.push(d);
      } else {
        rejected.push(d);
      }
    }
    if (rejected.length > 0) {
      process.stderr.write(
        `[harness subagent-stop] tooling.pythonCandidateDirs: rejected ${JSON.stringify(rejected)} — each entry must match /^[a-zA-Z0-9_.-]+$/ (no path separators, whitespace, or shell metacharacters). Kept: ${JSON.stringify(safe)}.\n`,
      );
    }
    return safe.length > 0 ? safe : fallback;
  }
  // Shape-invalid (non-array / empty array / non-string / empty-string entries)。
  // 警告し、fail-open 方針で default に落ちる。
  process.stderr.write(
    "[harness subagent-stop] tooling.pythonCandidateDirs shape invalid; using defaults " +
      `["src", "app"] (got ${JSON.stringify(raw)})\n`,
  );
  return fallback;
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
