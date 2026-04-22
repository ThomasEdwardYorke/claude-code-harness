/**
 * hooks/worktree-lifecycle.ts
 *
 * WorktreeCreate / WorktreeRemove hook handlers — Phase η P0-κ (2026-04-22).
 *
 * ## 公式仕様 (research-anthropic-official-2026-04-22.md § 1-4)
 *
 * - **WorktreeCreate**: Claude Code 既定の `git worktree` 作成処理を **完全置換** する
 *   blocking hook。`command` stdout に absolute path を書き出すプロトコル必須。
 *   matcher 非対応、毎回発火。observability 用途だけで登録すると作成自体が失敗する。
 *
 * - **WorktreeRemove**: non-blocking observability hook。失敗は debug-only で
 *   本体処理に影響しない。matcher 非対応、毎回発火。
 *
 * ## 本 Phase の設計判断
 *
 * 1. **WorktreeRemove**: `hooks.json` に登録し、`/parallel-worktree` 運用や
 *    `isolation: worktree` agent 終了時に coordinator への同期リマインダーを出す。
 *    既存の `pre-compact.ts` と同じく `loadConfigSafe` で fail-open を担保。
 *
 * 2. **WorktreeCreate**: **hooks.json には登録しない**。既定挙動を置換する blocking
 *    protocol 準拠実装は Phase κ-2 (`isolation: worktree` + `WorktreeCreate/Remove`
 *    hook 協調設計) で行う。本 Phase では `route()` / `HookType` union の scaffold
 *    のみ整備し、追加実装の前進路を確保する。handler は呼ばれれば approve + scaffold
 *    notice を返すだけ (副作用なし)。
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md
 * - docs/maintainer/research-subagent-isolation-2026-04-22.md
 * - docs/maintainer/ROADMAP-model-b.md (Phase 1 hook events、Phase κ-2)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSafe } from "../config.js";

// pre-compact.ts と同じ安全上限: Plans.md を読み込む際の byte 上限。
const MAX_PLANS_SIZE = 512 * 1024;

// ============================================================
// Shared types
// ============================================================

export interface WorktreeRemoveInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  /** Claude Code が削除しようとしている worktree の absolute path (公式 payload)。 */
  worktree_path?: string | undefined;
  /** subagent isolation worktree 終了時のみ付与 (公式 payload: optional)。 */
  agent_type?: string | undefined;
  /** 同上。agent instance identifier。 */
  agent_id?: string | undefined;
  /** 公式 payload common field。現 handler では未使用だが型定義のみ保持。 */
  transcript_path?: string | undefined;
}

export interface WorktreeRemoveResult {
  decision: "approve";
  additionalContext?: string;
}

export interface WorktreeCreateInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  /** 公式 payload: 作成対象 worktree の論理名 (slug)。 */
  name?: string | undefined;
  /** subagent isolation 経由の WorktreeCreate 時のみ付与。 */
  agent_type?: string | undefined;
  agent_id?: string | undefined;
  transcript_path?: string | undefined;
}

export interface WorktreeCreateResult {
  decision: "approve";
  additionalContext?: string;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Plans.md の担当表セクションが存在するかを確認する。
 *
 * WorktreeRemove 時に「担当表から該当 worktree の行を削除し忘れていないか」を
 * coordinator にリマインドするため使用。pre-compact.ts の readAssignmentTable を
 * 踏襲するが、本 hook では「存在有無」だけを見る (内容の抜粋は PreCompact 側が既に
 * context 注入しているため、重複を避ける目的)。
 */
function hasAssignmentTable(projectRoot: string): boolean {
  try {
    const config = loadConfigSafe(projectRoot);
    const rawPlans = (config.work as { plansFile?: unknown } | undefined)
      ?.plansFile;
    const plansFile =
      typeof rawPlans === "string" && rawPlans.length > 0
        ? rawPlans
        : "Plans.md";
    const rawMarkers = (
      config.work as { assignmentSectionMarkers?: unknown } | undefined
    )?.assignmentSectionMarkers;
    const markers =
      Array.isArray(rawMarkers) && rawMarkers.every((m) => typeof m === "string")
        ? (rawMarkers as string[])
        : ["担当表", "Assignment", "In Progress"];

    const plansPath = resolve(projectRoot, plansFile);
    if (!existsSync(plansPath)) return false;

    const stat = statSync(plansPath);
    if (stat.size > MAX_PLANS_SIZE) return false;

    const content = readFileSync(plansPath, "utf-8");
    return markers.some((m) => content.includes(m));
  } catch {
    return false;
  }
}

// ============================================================
// handleWorktreeRemove (fully implemented, registered in hooks.json)
// ============================================================

export async function handleWorktreeRemove(
  input: WorktreeRemoveInput,
): Promise<WorktreeRemoveResult> {
  const projectRoot = input.cwd ?? process.cwd();
  const sections: string[] = [];

  sections.push("=== Harness WorktreeRemove: worktree 終了を検知 ===");

  if (input.worktree_path) {
    sections.push(`[worktree-path] ${input.worktree_path}`);
  }

  if (input.agent_type) {
    sections.push(`[agent-type] ${input.agent_type}`);
  }

  if (input.agent_id) {
    sections.push(`[agent-id] ${input.agent_id}`);
  }

  if (hasAssignmentTable(projectRoot)) {
    sections.push(
      "[reminder] 担当表 (Plans.md) の該当行を coordinator で削除し、完了セクションに移動してください",
    );
  }

  sections.push("=== WorktreeRemove end ===");

  return {
    decision: "approve",
    additionalContext: sections.join("\n"),
  };
}

// ============================================================
// handleWorktreeCreate (scaffold only, NOT registered in hooks.json)
//
// ## 重要: なぜ hooks.json に登録しないのか
//
// WorktreeCreate は既定 git worktree 作成を「完全置換」する blocking hook で、
// observability だけを目的に登録すると Claude Code 側が期待する
// `worktreePath` が返らず、worktree 作成自体が失敗する。詳細は研究レポート
// `docs/maintainer/research-anthropic-official-2026-04-22.md § 1` を参照。
//
// Phase κ-2 (isolation: worktree 協調設計) で protocol-compliant 実装
// (stdout に path を出す serializer 分岐 + git worktree 作成ロジック) を
// 追加する時に本 handler を本登録する前提で、現時点では route() 経路だけ
// 整えた scaffold とする。
// ============================================================

export async function handleWorktreeCreate(
  input: WorktreeCreateInput,
): Promise<WorktreeCreateResult> {
  const sections: string[] = [];

  sections.push(
    "=== Harness WorktreeCreate: scaffold (Phase κ-2 deferred) ===",
  );

  if (input.name) {
    sections.push(`[name] ${input.name}`);
  }

  if (input.agent_type) {
    sections.push(`[agent-type] ${input.agent_type}`);
  }

  // 本 scaffold は hooks.json 未登録のため実運用で発火しない。
  // Phase κ-2 で worktreePath 返却 protocol に差し替えるまでの足場。
  sections.push(
    "[note] Phase κ-2 まで hooks.json 未登録 / scaffold 実装 (blocking protocol 準拠は Phase κ-2 で追加)",
  );

  sections.push("=== WorktreeCreate end (scaffold) ===");

  return {
    decision: "approve",
    additionalContext: sections.join("\n"),
  };
}
