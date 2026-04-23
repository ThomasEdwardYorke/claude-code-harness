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
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { loadConfigSafe } from "../config.js";
// ============================================================
// Handler
// ============================================================
/**
 * UserPromptSubmit hook の本体実装。
 *
 * @param input  Claude Code から渡される hook payload
 * @param options.projectRoot  config 読み込みの起点。未指定なら `input.cwd ?? process.cwd()`
 *
 * @returns 必ず `decision: "approve"` を返す (fail-open)。
 *          inject すべき context があるとき `additionalContext` を含む。
 */
export async function handleUserPromptSubmit(input, options) {
    const projectRoot = options?.projectRoot ?? input.cwd ?? process.cwd();
    // Fail-open #1: config 読込失敗時は何も inject せず approve で抜ける
    let contextFiles;
    let maxTotalBytes;
    let fenceContext;
    try {
        const config = loadConfigSafe(projectRoot);
        // defensive narrow: shape-invalid config でも落ちないよう
        const upRaw = config.userPromptSubmit;
        const up = typeof upRaw === "object" && upRaw !== null
            ? upRaw
            : {};
        contextFiles = Array.isArray(up["contextFiles"])
            ? up["contextFiles"].filter((f) => typeof f === "string" && f.length > 0)
            : [];
        const rawMax = up["maxTotalBytes"];
        maxTotalBytes =
            typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 256
                ? Math.min(rawMax, 65536)
                : 16 * 1024;
        fenceContext = typeof up["fenceContext"] === "boolean" ? up["fenceContext"] : true;
    }
    catch {
        return { decision: "approve" };
    }
    // No-op when nothing to inject (fail-open #2)
    if (contextFiles.length === 0) {
        return { decision: "approve" };
    }
    // Aggregate file contents with size cap + path-traversal guard
    const sections = [];
    let totalBytes = 0;
    let truncated = false;
    for (const relPath of contextFiles) {
        // Path-traversal guard: reject `..` segments and absolute paths.
        // Even though loadConfigSafe is responsible for the config file's own
        // safety, we never want a malformed config (or a future config source)
        // to cause arbitrary read of host files. Silent skip — no error noise.
        if (relPath.includes("..") || isAbsolute(relPath)) {
            continue;
        }
        const fullPath = resolve(projectRoot, relPath);
        // Defence-in-depth: after resolve, confirm the path stays under projectRoot.
        // (handles symlinks / unusual segment normalisation that escape the prefix)
        //
        // Platform-aware separator: Windows native path uses `\` after `resolve`,
        // POSIX uses `/`. Hardcoding `/` would cause false-positive rejection on
        // Windows. `node:path.sep` resolves per-platform (Codex Worker review 指摘)。
        const rootPrefix = resolve(projectRoot) + sep;
        const normFull = resolve(fullPath);
        if (!normFull.startsWith(rootPrefix) && normFull !== resolve(projectRoot)) {
            continue;
        }
        if (!existsSync(fullPath))
            continue;
        let content;
        try {
            content = readFileSync(fullPath, "utf-8");
        }
        catch {
            // Read error (perms / FIFO / etc.) — silent skip per fail-open
            continue;
        }
        const remaining = maxTotalBytes - totalBytes;
        if (remaining <= 0) {
            truncated = true;
            break;
        }
        const slice = content.length > remaining ? content.slice(0, remaining) : content;
        if (slice.length < content.length) {
            truncated = true;
        }
        const header = `--- ${relPath} ---\n`;
        sections.push(header + slice);
        totalBytes += header.length + slice.length;
        if (totalBytes >= maxTotalBytes) {
            truncated = true;
            break;
        }
    }
    if (sections.length === 0) {
        return { decision: "approve" };
    }
    let body = sections.join("\n\n");
    if (truncated) {
        body += `\n\n[harness] context truncated at ${maxTotalBytes} bytes`;
    }
    const additionalContext = fenceContext
        ? `===== HARNESS PROJECT-LOCAL CONTEXT =====\n${body}\n===== END HARNESS CONTEXT =====`
        : body;
    return { decision: "approve", additionalContext };
}
//# sourceMappingURL=user-prompt-submit.js.map