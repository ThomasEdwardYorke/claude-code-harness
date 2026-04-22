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
export declare function handleWorktreeRemove(input: WorktreeRemoveInput): Promise<WorktreeRemoveResult>;
export declare function handleWorktreeCreate(input: WorktreeCreateInput): Promise<WorktreeCreateResult>;
//# sourceMappingURL=worktree-lifecycle.d.ts.map