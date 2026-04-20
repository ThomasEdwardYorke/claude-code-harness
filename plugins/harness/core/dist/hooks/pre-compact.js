/**
 * hooks/pre-compact.ts
 *
 * PreCompact hook handler.
 * Fires before context compaction. Reads project state (Plans.md 担当表,
 * open PRs) and returns it as additionalContext so it survives compaction.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
function readAssignmentTable(projectRoot) {
    const plansPath = resolve(projectRoot, "Plans.md");
    if (!existsSync(plansPath))
        return null;
    const content = readFileSync(plansPath, "utf-8");
    const lines = content.split("\n");
    const tableStart = lines.findIndex((l) => l.includes("担当表") || l.includes("Assignment"));
    if (tableStart < 0)
        return null;
    const tableLines = [];
    for (let i = tableStart; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined)
            break;
        tableLines.push(line);
        if (tableLines.length > 2 &&
            line.trim() === "" &&
            (lines[i + 1] === undefined || !lines[i + 1]?.startsWith("|"))) {
            break;
        }
        if (tableLines.length > 50)
            break;
    }
    const result = tableLines.join("\n").trim();
    return result || null;
}
function readOpenPRs(projectRoot) {
    try {
        const result = execSync("gh pr list --limit 10 --json number,title,headRefName,state 2>/dev/null", {
            cwd: projectRoot,
            timeout: 5000,
            encoding: "utf-8",
        });
        const prs = JSON.parse(result);
        if (prs.length === 0)
            return null;
        return prs
            .map((pr) => `#${pr.number} [${pr.headRefName}] ${pr.title}`)
            .join("\n");
    }
    catch {
        return null;
    }
}
function readCurrentBranch(projectRoot) {
    try {
        return execSync("git branch --show-current 2>/dev/null", {
            cwd: projectRoot,
            timeout: 3000,
            encoding: "utf-8",
        }).trim();
    }
    catch {
        return null;
    }
}
export async function handlePreCompact(input) {
    const projectRoot = input.cwd ?? process.cwd();
    const sections = [];
    sections.push("=== Harness PreCompact: 圧縮前保存コンテキスト ===");
    const branch = readCurrentBranch(projectRoot);
    if (branch) {
        sections.push(`[ブランチ] ${branch}`);
    }
    const assignmentTable = readAssignmentTable(projectRoot);
    if (assignmentTable) {
        sections.push("[Plans.md 担当表]");
        sections.push(assignmentTable);
    }
    const openPRs = readOpenPRs(projectRoot);
    if (openPRs) {
        sections.push("[オープン PR]");
        sections.push(openPRs);
    }
    sections.push(`[trigger] ${input.trigger ?? "unknown"}`);
    sections.push("=== PreCompact end ===");
    return {
        decision: "approve",
        additionalContext: sections.join("\n"),
    };
}
//# sourceMappingURL=pre-compact.js.map