/**
 * hooks/user-prompt-submit.ts
 *
 * UserPromptSubmit hook handler.
 *
 * ## 公式仕様 (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **Trigger**: user が prompt を submit した直後 / Claude 処理開始前
 * - **Payload**: `prompt` (string, 固有) + 共通 (session_id / transcript_path /
 *   cwd / hook_event_name)
 * - **Output (command hook)**:
 *   - exit 0 + plain stdout → Claude context に追加
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }` を parse
 *   - exit 2 + stderr → block (stderr が理由として返る)
 *   - その他 non-zero → non-blocking error (実行継続)
 * - **matcher 非対応**: 全 prompt で発火 → handler は短時間で完了させる
 * - **prompt modification**: 公式 docs で未定義 (実装不可)
 *
 * ## 本 handler の責務
 *
 * Global plugin が project-local context (e.g. `.claude/rules/*.md`) を
 * 各 user prompt に自動 inject する **Global → Local bridge**。
 * `harness.config.json` の `userPromptSubmit.contextFiles` に列挙された
 * file 内容を読み出し、`hookSpecificOutput.additionalContext` に載せる。
 *
 * - **Fail-open**: config 読込失敗 / file 不在 / read error → silently skip
 *   (decision: "approve" + additionalContext 未設定)
 * - **Path-traversal guard**: `..` 含む or absolute path は reject (silently skip)
 * - **Size cap**: `maxTotalBytes` (default 16 KiB) を超えた分は truncate
 *   + 末尾 marker `[harness] context truncated at N bytes`
 * - **Fence wrap**: `fenceContext: true` (default) で
 *   `===== HARNESS PROJECT-LOCAL CONTEXT =====` / `===== END HARNESS CONTEXT =====`
 *   marker で囲む (Claude / 読み手が harness 由来コンテンツと識別可能)
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (公式 hook 仕様調査)
 * - CHANGELOG.md (feature history)
 */
export interface UserPromptSubmitInput {
    hook_event_name: string;
    /** user submit した prompt 全文 (公式 payload field)。 */
    prompt: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    transcript_path?: string | undefined;
}
export interface UserPromptSubmitResult {
    /** "approve" = 通常 inject、"block" = prompt 拒否 (本 handler は通常 approve のみ)。 */
    decision: "approve" | "block";
    /** Claude context に追加注入する文字列 (`hookSpecificOutput.additionalContext`)。 */
    additionalContext?: string;
    /** block 時の理由。 */
    reason?: string;
    /** Optional Claude Code session title (`hookSpecificOutput.sessionTitle`)。 */
    sessionTitle?: string;
}
/**
 * UserPromptSubmit hook の本体実装。
 *
 * @param input  Claude Code から渡される hook payload
 * @param options.projectRoot  config 読み込みの起点。未指定なら `input.cwd ?? process.cwd()`
 *
 * @returns 必ず `decision: "approve"` を返す (fail-open)。
 *          inject すべき context があるとき `additionalContext` を含む。
 */
export declare function handleUserPromptSubmit(input: UserPromptSubmitInput, options?: {
    projectRoot?: string | undefined;
}): Promise<UserPromptSubmitResult>;
//# sourceMappingURL=user-prompt-submit.d.ts.map