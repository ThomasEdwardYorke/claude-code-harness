/**
 * hooks/pre-compact.ts
 *
 * PreCompact hook handler.
 * Fires before context compaction. Reads project state (task/plan file
 * assignment table, open PRs) and returns it as additionalContext so it
 * survives compaction. File paths and section keywords are configurable via
 * `harness.config.json` (work.plansFile / work.assignmentSectionMarkers).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { loadConfigSafe } from "../config.js";

const MAX_PLANS_SIZE = 512 * 1024;

export interface PreCompactInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  trigger?: string | undefined;
  custom_instructions?: string | undefined;
}

export interface PreCompactResult {
  decision: "approve";
  additionalContext?: string;
}

function readAssignmentTable(projectRoot: string): string | null {
  try {
    const config = loadConfigSafe(projectRoot);
    // Codex [M-1A] fail-open: shape-invalid config でも hook が落ちないよう defensive narrow。
    const rawPlans = (config.work as { plansFile?: unknown } | undefined)?.plansFile;
    const plansFile = typeof rawPlans === "string" && rawPlans.length > 0
      ? rawPlans
      : "Plans.md";
    const rawMarkers = (config.work as { assignmentSectionMarkers?: unknown } | undefined)
      ?.assignmentSectionMarkers;
    const markers = Array.isArray(rawMarkers) && rawMarkers.every((m) => typeof m === "string")
      ? (rawMarkers as string[])
      : ["担当表", "Assignment", "In Progress"];

    const plansPath = resolve(projectRoot, plansFile);
    if (!existsSync(plansPath)) return null;

    const stat = statSync(plansPath);
    if (stat.size > MAX_PLANS_SIZE) return null;

    const content = readFileSync(plansPath, "utf-8");
    const lines = content.split("\n");

    const tableStart = lines.findIndex((l) =>
      markers.some((m) => l.includes(m)),
    );
    if (tableStart < 0) return null;

    const tableLines: string[] = [];
    for (let i = tableStart; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) break;
      tableLines.push(line);
      if (
        tableLines.length > 2 &&
        line.trim() === "" &&
        (lines[i + 1] === undefined || !lines[i + 1]?.startsWith("|"))
      ) {
        break;
      }
      if (tableLines.length > 50) break;
    }

    const result = tableLines.join("\n").trim();
    return result || null;
  } catch {
    return null;
  }
}

function readOpenPRs(projectRoot: string): string | null {
  try {
    const result = execSync("gh pr list --limit 10 --json number,title,headRefName,state 2>/dev/null", {
      cwd: projectRoot,
      timeout: 5000,
      encoding: "utf-8",
    });
    const prs = JSON.parse(result) as Array<{
      number: number;
      title: string;
      headRefName: string;
      state: string;
    }>;
    if (prs.length === 0) return null;
    return prs
      .map((pr) => `#${pr.number} [${pr.headRefName}] ${pr.title}`)
      .join("\n");
  } catch {
    return null;
  }
}

function readCurrentBranch(projectRoot: string): string | null {
  try {
    return execSync("git branch --show-current 2>/dev/null", {
      cwd: projectRoot,
      timeout: 3000,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

export async function handlePreCompact(
  input: PreCompactInput,
): Promise<PreCompactResult> {
  const projectRoot = input.cwd ?? process.cwd();
  const sections: string[] = [];

  sections.push("=== Harness PreCompact: 圧縮前保存コンテキスト ===");

  // 呼び出し側が custom_instructions で渡した圧縮方針 / 保持指示は、PreCompact の趣旨上
  // 最優先で additionalContext に残す (CodeRabbit PR #1 Major: pre-compact.ts:131)。
  const customInstructions = input.custom_instructions?.trim();
  if (customInstructions) {
    sections.push("[custom_instructions]");
    sections.push(customInstructions);
  }

  const branch = readCurrentBranch(projectRoot);
  if (branch) {
    sections.push(`[ブランチ] ${branch}`);
  }

  const assignmentTable = readAssignmentTable(projectRoot);
  if (assignmentTable) {
    sections.push("[assignment-table]");
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
