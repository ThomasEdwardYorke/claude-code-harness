/**
 * hooks/post-tool-use-failure.ts
 *
 * PostToolUseFailure hook handler.
 *
 * ## 公式仕様 (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **Trigger**: tool の実行が失敗した時 (exception / non-zero exit / interrupt)
 *   PostToolUse と mutually exclusive (成功時は PostToolUse、失敗時は本 hook)
 * - **Payload**: `tool_name` / `tool_input` / `tool_use_id` / `error` (string) /
 *   `is_interrupt` (optional) + 共通 (session_id / transcript_path / cwd /
 *   hook_event_name / permission_mode)
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }` を parse
 *   - exit 0 + `hookSpecificOutput.additionalContext` → Claude context 注入
 *   - `decision: "block"` + reason → tool failure を明示 block (本 handler は使わない)
 *   - その他 non-zero → non-blocking error (実行継続)
 * - **matcher**: tool name base (PostToolUse と同じ)、本 harness は全 tool 登録
 *
 * ## 本 handler の責務
 *
 * tool 失敗時に診断情報 + 既知 error pattern の corrective hint を
 * `hookSpecificOutput.additionalContext` へ inject し、Claude が次 turn で
 * 修復判断する材料を増やす observability hook。
 *
 * - **Fail-open**: config 読込失敗 / error 文字列空 → silent skip で approve
 * - **Truncate**: error 文字列が `maxErrorLength` 超なら truncate + marker
 * - **Built-in hints (correctiveHints: true)**: 6 pattern (permission denied /
 *   no such file / command not found / signal abort / timeout / connection refused)
 * - **non-blocking**: 必ず `decision: "approve"` を返す (failure そのものを
 *   block するのは設計外 — 本 hook は観察 + 助言に徹する)
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (hook 仕様調査)
 * - CHANGELOG.md (feature history)
 */
export interface PostToolUseFailureInput {
    hook_event_name: string;
    /** 失敗した tool 名 (公式 payload)。 */
    tool_name?: string | undefined;
    /** 失敗した tool の arguments (公式 payload)。 */
    tool_input?: Record<string, unknown> | undefined;
    /** Tool invocation id (公式 payload)。 */
    tool_use_id?: string | undefined;
    /** Error 文字列 (公式 payload、e.g. "Command exited with non-zero status code 1")。 */
    error?: string | undefined;
    /** ユーザー割り込みフラグ (公式 payload optional)。 */
    is_interrupt?: boolean | undefined;
    session_id?: string | undefined;
    cwd?: string | undefined;
    transcript_path?: string | undefined;
    permission_mode?: string | undefined;
}
export interface PostToolUseFailureResult {
    /** 本 handler は常に approve (observability hook)。 */
    decision: "approve";
    /** 診断 + hint (`hookSpecificOutput.additionalContext` として lift)。 */
    additionalContext?: string;
}
/**
 * PostToolUseFailure hook の本体実装。
 *
 * @param input  Claude Code から渡される hook payload
 * @param options.projectRoot  config 読み込みの起点。未指定なら `input.cwd ?? process.cwd()`
 *
 * @returns 必ず `decision: "approve"` を返す (observability hook, fail-open)。
 *          診断情報 + hint が生成できるとき `additionalContext` を含む。
 */
export declare function handlePostToolUseFailure(input: PostToolUseFailureInput, options?: {
    projectRoot?: string | undefined;
}): Promise<PostToolUseFailureResult>;
//# sourceMappingURL=post-tool-use-failure.d.ts.map