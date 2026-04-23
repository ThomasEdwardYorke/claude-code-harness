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
 *   + 末尾 marker `[harness <nonce>] context truncated at N bytes`
 * - **Fence wrap + per-request nonce**: `fenceContext: true` (default) で
 *   `===== HARNESS PROJECT-LOCAL CONTEXT <nonce> =====` /
 *   `===== END HARNESS CONTEXT <nonce> =====` marker で囲む。
 *   nonce は 12 hex 文字 (48-bit entropy) を request ごとに生成し、
 *   open / close / truncation marker で共有する。攻撃者は次回 nonce を予測
 *   できないため、content 内に埋め込んだ fake fence marker / fake truncate
 *   告知 では context boundary spoofing が成立しない。
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (公式 hook 仕様調査)
 * - CHANGELOG.md (feature history)
 */
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
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
        // Symlink escape hardening (internal security review):
        //   lexical path confinement (startsWith) だけでは `readFileSync()` が
        //   symlink を follow するため、repo-controlled symlink で任意 file
        //   (例: `/etc/passwd` への symlink) を読まれるリスクがある。
        //   対策: (a) `realpathSync` で projectRoot と target を両方 canonical
        //   化して接頭辞比較、(b) `lstatSync` で個別 entry が symlink なら
        //   reject (symlink-free directory tree を強制)。
        //
        //   原 lexical check (`startsWith(rootPrefix)`) も残し defence-in-depth。
        let realRoot;
        try {
            realRoot = realpathSync(projectRoot);
        }
        catch {
            // projectRoot 自体が見えない (test fixture 削除等) — silent skip
            continue;
        }
        if (!existsSync(fullPath))
            continue;
        // Symlink rejection: `lstatSync` は symlink を follow しないので、
        // target file 自体が symlink なら即 reject。親 directory path に
        // symlink がある場合も realpath で吸収され prefix check で検出される。
        let lstat;
        try {
            lstat = lstatSync(fullPath);
        }
        catch {
            continue;
        }
        if (lstat.isSymbolicLink()) {
            continue;
        }
        // File read safety (internal code review):
        //   - `isFile()` 未 gate: FIFO / socket / char device で `readFileSync`
        //     が block する可能性 → `statSync().isFile()` で通常 file のみ許可
        //   - byte vs char: `string.length` は UTF-16 code unit count、
        //     `maxTotalBytes` は byte 意味 → `Buffer.byteLength()` で byte
        //     cap を正確に
        let stat;
        try {
            stat = statSync(fullPath);
        }
        catch {
            continue;
        }
        if (!stat.isFile()) {
            continue;
        }
        // realpath + canonical prefix 比較: symlink を経由した後の実 path が
        // projectRoot 内に収まっているかを canonical form で検証。
        // platform-aware separator (Windows `\` vs POSIX `/`) は sep で吸収。
        let realFull;
        try {
            realFull = realpathSync(fullPath);
        }
        catch {
            continue;
        }
        const realRootPrefix = realRoot + sep;
        if (!realFull.startsWith(realRootPrefix) && realFull !== realRoot) {
            continue;
        }
        let rawContent;
        try {
            rawContent = readFileSync(fullPath, "utf-8");
        }
        catch {
            // Read error (perms / unusual entry) — silent skip per fail-open
            continue;
        }
        // Newline sanitization (internal security review): newline sanitize で
        // fake section-boundary injection を防ぐ。project-local rule file に
        // fence marker 類似 pattern を仕込まれた場合、元 file の `\n` が
        // preserved だと fence が機能せず Claude の context 解釈に
        // attacker-controlled boundary を作れる。`\r\n` / `\n` / `\r` を
        // 2 文字 literal `\\n` に置換することで、fence marker が独立行として
        // 現れる余地を排除する。加えて open / close fence と truncation marker
        // に per-request nonce を付与することで、literal fence 混入による
        // spoofing も無効化する (外側レイヤで hardening)。content 内容は
        // 意味的に残り、readability はわずかに低下する。
        const content = rawContent.replace(/\r\n|[\n\r]/g, "\\n");
        // Byte-based size cap (internal code review): string.length は UTF-16
        // code unit 数、`maxTotalBytes` は byte 意味。Buffer.byteLength で
        // UTF-8 encode 後の byte 数を使う。slice 時も byte 境界で safe に cut。
        const contentBytes = Buffer.byteLength(content, "utf-8");
        const remaining = maxTotalBytes - totalBytes;
        if (remaining <= 0) {
            truncated = true;
            break;
        }
        let slice;
        let sliceBytes;
        if (contentBytes > remaining) {
            // Binary-safe truncate: byte 単位で cut し UTF-8 boundary を尊重。
            // Buffer に encode → slice → 再度 decode。slice 境界が multi-byte
            // char の中なら末尾の壊れた bytes を弾いて valid UTF-8 を保つ。
            const buf = Buffer.from(content, "utf-8").subarray(0, remaining);
            // Node の toString("utf-8") は invalid trailing bytes を replacement char 化
            // するので、replace で取り除いて clean な string を得る。
            slice = buf.toString("utf-8").replace(/�+$/, "");
            sliceBytes = Buffer.byteLength(slice, "utf-8");
            truncated = true;
        }
        else {
            slice = content;
            sliceBytes = contentBytes;
        }
        const header = `--- ${relPath} ---\n`;
        const headerBytes = Buffer.byteLength(header, "utf-8");
        sections.push(header + slice);
        totalBytes += headerBytes + sliceBytes;
        if (totalBytes >= maxTotalBytes) {
            truncated = true;
            break;
        }
    }
    if (sections.length === 0) {
        return { decision: "approve" };
    }
    // Per-request nonce (internal security review — fence spoofing & fake
    // truncate marker injection 対策):
    //   content 内に `===== END HARNESS CONTEXT =====` 等の literal fence が
    //   埋め込まれていても、attacker は次回 nonce を予測できないため、Claude
    //   が見る open / close fence とは別 nonce となり spoofing が成立しない。
    //   同じ nonce を truncation marker にも付与し、fake truncate 告知による
    //   misinformation を防ぐ。12 hex 文字 = 48-bit entropy (衝突確率 1/2^48)。
    const nonce = randomBytes(6).toString("hex");
    let body = sections.join("\n\n");
    if (truncated) {
        body += `\n\n[harness ${nonce}] context truncated at ${maxTotalBytes} bytes`;
    }
    const additionalContext = fenceContext
        ? `===== HARNESS PROJECT-LOCAL CONTEXT ${nonce} =====\n${body}\n===== END HARNESS CONTEXT ${nonce} =====`
        : body;
    return { decision: "approve", additionalContext };
}
//# sourceMappingURL=user-prompt-submit.js.map