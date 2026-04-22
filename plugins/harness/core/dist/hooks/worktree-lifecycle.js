/**
 * hooks/worktree-lifecycle.ts
 *
 * WorktreeCreate / WorktreeRemove hook handlers — Phase η P0-κ (2026-04-22).
 *
 * ## 公式仕様 (research-anthropic-official-2026-04-22.md § 3 フック)
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
// Internal helpers
// ============================================================
/**
 * Plans.md の担当表セクションが存在するかを確認する。
 *
 * WorktreeRemove 時に「担当表から該当 worktree の行を削除し忘れていないか」を
 * coordinator にリマインドするため使用。pre-compact.ts の readAssignmentTable を
 * 踏襲するが、本 hook では「存在有無」だけを見る (内容の抜粋は PreCompact 側が既に
 * context 注入しているため、重複を避ける目的)。
 *
 * ## Known shared tech debt (Codex review 指摘 WL-1)
 *
 * `plansFile` は `harness.config.json` の `work.plansFile` をそのまま使用しており、
 * `../../etc/passwd` 相当の相対パスが書かれた config を読み込ませれば projectRoot
 * 外のファイルに `readFileSync` を呼ばせる boolean oracle attack が理論上可能。
 * ただし (1) 戻り値は boolean (marker 含有有無) のみでデータ漏洩なし、(2) 同じ
 * パターンは `pre-compact.ts:52 readAssignmentTable` にも存在する既存コード慣行、
 * (3) `harness.config.json` 自体への書き込み権が前提で現実的脅威は低い、の 3 点
 * から本 PR のスコープ外とする。pre-compact.ts と同時に別 PR で path traversal
 * guard (`plansPath.startsWith(resolve(projectRoot) + path.sep)` 検査) を入れる
 * のが恒久対応。
 */
function hasAssignmentTable(projectRoot) {
    try {
        const config = loadConfigSafe(projectRoot);
        const rawPlans = config.work
            ?.plansFile;
        const plansFile = typeof rawPlans === "string" && rawPlans.length > 0
            ? rawPlans
            : "Plans.md";
        const rawMarkers = config.work?.assignmentSectionMarkers;
        // Codex pseudo-CodeRabbit review 対応 (PCR-1): 空配列 (`[]`) は `Array.isArray` +
        // `every(predicate)` の両方を vacuously true で通過するが、`some(...)` で
        // 常に false を返すため reminder が永久無音化される。`length > 0` guard を
        // 追加し、空配列は default marker に fallback させる。同問題は pre-compact.ts
        // でも同時修正。
        const markers = Array.isArray(rawMarkers) &&
            rawMarkers.length > 0 &&
            rawMarkers.every((m) => typeof m === "string")
            ? rawMarkers
            : ["担当表", "Assignment", "In Progress"];
        const plansPath = resolve(projectRoot, plansFile);
        if (!existsSync(plansPath))
            return false;
        const stat = statSync(plansPath);
        if (stat.size > MAX_PLANS_SIZE)
            return false;
        const content = readFileSync(plansPath, "utf-8");
        return markers.some((m) => content.includes(m));
    }
    catch {
        return false;
    }
}
// ============================================================
// handleWorktreeRemove (fully implemented, registered in hooks.json)
// ============================================================
// Codex review 対応 (WL-2 / R2-I1): Claude Code は payload を JSON で渡すため
// payload field に改行文字を含ませる経路は限定的だが、additionalContext が Claude の
// 読むコンテキストに注入されることを踏まえ、`\n` / `\r` を可視化しておくことで偽
// section 注入を防ぐ。CRLF (`\r\n`) は 1 つの改行境界として `\\n` に折り畳む
// (`[\n\r]` で 1 文字ずつ置換すると `\\n\\n` の二重表示になり cosmetic に冗長なため)。
function sanitizeForContext(value) {
    return value.replace(/\r\n|[\n\r]/g, "\\n");
}
export async function handleWorktreeRemove(input) {
    const projectRoot = input.cwd ?? process.cwd();
    const sections = [];
    sections.push("=== Harness WorktreeRemove: worktree 終了を検知 ===");
    if (input.worktree_path) {
        sections.push(`[worktree-path] ${sanitizeForContext(input.worktree_path)}`);
    }
    if (input.agent_type) {
        sections.push(`[agent-type] ${sanitizeForContext(input.agent_type)}`);
    }
    if (input.agent_id) {
        sections.push(`[agent-id] ${sanitizeForContext(input.agent_id)}`);
    }
    if (hasAssignmentTable(projectRoot)) {
        sections.push("[reminder] 担当表 (Plans.md) の該当行を coordinator で削除し、完了セクションに移動してください");
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
// `docs/maintainer/research-anthropic-official-2026-04-22.md § 3` (フック) を参照。
//
// Phase κ-2 (isolation: worktree 協調設計) で protocol-compliant 実装
// (stdout に path を出す serializer 分岐 + git worktree 作成ロジック) を
// 追加する時に本 handler を本登録する前提で、現時点では route() 経路だけ
// 整えた scaffold とする。
//
// ## 失敗モードの明示 (Codex review 対応 WL-6)
//
// 本 scaffold を誤って hooks.json に登録すると以下が起きる:
//   (1) Claude Code が WorktreeCreate を発火し、本 handler を invoke
//   (2) 現 index.ts main() が `{decision, reason}` JSON を stdout に出力
//   (3) 公式プロトコルは stdout に絶対 path を期待しているため、JSON 文字列は
//       有効な path としてパースできず worktree 作成が失敗
//   (4) ユーザー視点では `claude --worktree` / isolation: worktree agent 起動が
//       不能になる (エラー: worktreePath 未設定 or 空)
// Phase κ-2 で stdout serializer + git worktree コマンドを追加するまで
// hooks.json への登録を禁止する。
// ============================================================
export async function handleWorktreeCreate(input) {
    const sections = [];
    sections.push("=== Harness WorktreeCreate: scaffold (Phase κ-2 deferred) ===");
    if (input.name) {
        sections.push(`[name] ${sanitizeForContext(input.name)}`);
    }
    if (input.agent_type) {
        sections.push(`[agent-type] ${sanitizeForContext(input.agent_type)}`);
    }
    // 本 scaffold は hooks.json 未登録のため実運用で発火しない。
    // Phase κ-2 で worktreePath 返却 protocol に差し替えるまでの足場。
    // hooks.json に登録すると JSON response が absolute path として解釈できず
    // worktree 作成が失敗する (詳細は handleWorktreeCreate コメントブロック § 失敗モード)。
    sections.push("[note] Phase κ-2 まで hooks.json 未登録 / scaffold 実装 (blocking protocol 準拠は Phase κ-2 で追加)");
    sections.push("=== WorktreeCreate end (scaffold) ===");
    return {
        decision: "approve",
        additionalContext: sections.join("\n"),
    };
}
//# sourceMappingURL=worktree-lifecycle.js.map