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
const WORKER_AGENT_TYPES = new Set(["worker", "harness:worker"]);
function runCiCheck(tool, command, projectRoot) {
    try {
        const output = execSync(command, {
            cwd: projectRoot,
            timeout: 30000,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { tool, passed: true, output: output.slice(0, 500) };
    }
    catch (err) {
        const message = err instanceof Error && "stdout" in err
            ? String(err.stdout).slice(0, 500)
            : "check failed";
        return { tool, passed: false, output: message };
    }
}
function detectAvailableChecks(projectRoot) {
    const checks = [];
    if (existsSync(resolve(projectRoot, "pyproject.toml"))) {
        checks.push({ tool: "ruff", command: "ruff check backend/ --no-fix 2>&1" }, { tool: "mypy", command: "mypy backend/ --no-error-summary 2>&1" });
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
export async function handleSubagentStop(input) {
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
    const sections = [];
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
    }
    else {
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
//# sourceMappingURL=subagent-stop.js.map