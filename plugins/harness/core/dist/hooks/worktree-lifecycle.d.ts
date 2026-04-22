/**
 * hooks/worktree-lifecycle.ts
 *
 * WorktreeCreate / WorktreeRemove hook handlers.
 *
 * ## 公式仕様 (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **WorktreeCreate (blocking)**: Claude Code 既定の `git worktree` 作成処理を
 *   **完全置換**する blocking hook。command hook の場合は raw absolute path を
 *   stdout に書き出す (HTTP hook は `hookSpecificOutput.worktreePath`)。
 *   exit 0 = 成功、any non-zero exit = worktree 作成失敗。
 *   matcher 非対応、毎回発火。
 *
 * - **WorktreeRemove (non-blocking)**: observability hook。失敗は debug-only で
 *   本体処理に影響しない。matcher 非対応、毎回発火。
 *
 * ## 本 handler の責務
 *
 * 1. **WorktreeRemove**: `/parallel-worktree` 運用や `isolation: worktree` agent
 *    終了時に coordinator への同期リマインダー (Plans.md 担当表) を出す。
 *    `loadConfigSafe` で fail-open を担保。
 *
 * 2. **WorktreeCreate (Phase κ-2 production)**: 実 `git worktree add` を実行し、
 *    作成した worktree の absolute path を HookResult.worktreePath に載せる。
 *    index.ts main() の worktree-create 分岐が worktreePath を raw stdout に書き出す。
 *    失敗時 (name invalid / non-git cwd / git failure) は worktreePath 未設定で返し、
 *    main() が exit 1 に変換して公式 blocking protocol に従う。
 *
 * ## `isolation: worktree` 協調設計の扱い
 *
 * 現状 (Phase κ-2): agent frontmatter `isolation: worktree` は未付与
 * (content-integrity.test.ts Phase κ guard で強制)。`/parallel-worktree` の
 * 手動 `git worktree add` 運用と二重 worktree 作成干渉リスクがあるため。
 *
 * WorktreeCreate hook の infrastructure は本 Phase で整備完了。将来 Phase κ-3
 * 以降で agent 個別の `isolation: worktree` 付与 + `/parallel-worktree` との
 * 共存ロジック (env marker / cwd 判定) を追加する予定。
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md
 * - docs/maintainer/research-subagent-isolation-2026-04-22.md
 * - docs/maintainer/ROADMAP-model-b.md (Phase κ series)
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
    /** 人間可読の diagnostic (成功/失敗両方に含まれる、observability 用)。 */
    additionalContext?: string;
    /**
     * 失敗時の理由 (blocking protocol で worktreePath 未設定になった原因)。
     * main() が exit 1 で stderr に書き出す候補文字列として使われる。
     */
    reason?: string;
    /**
     * 成功時のみ設定される、作成された worktree の absolute path。
     * index.ts main() の worktree-create 分岐が raw stdout に書き出す。
     * 未設定 (failure) だと main() は exit 1 で blocking 失敗を通知。
     */
    worktreePath?: string;
}
export declare function handleWorktreeRemove(input: WorktreeRemoveInput): Promise<WorktreeRemoveResult>;
export declare function handleWorktreeCreate(input: WorktreeCreateInput): Promise<WorktreeCreateResult>;
//# sourceMappingURL=worktree-lifecycle.d.ts.map