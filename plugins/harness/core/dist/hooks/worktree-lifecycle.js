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
 * 2. **WorktreeCreate (blocking protocol production)**: 実 `git worktree add` を
 *    実行し、作成した worktree の absolute path を HookResult.worktreePath に
 *    載せる。index.ts main() の worktree-create 分岐が worktreePath を raw stdout
 *    に書き出す。失敗時 (name invalid / non-git cwd / git failure) は worktreePath
 *    未設定で返し、main() が exit 1 に変換して公式 blocking protocol に従う。
 *
 * ## `isolation: worktree` 協調設計の扱い
 *
 * 現行: agent frontmatter `isolation: worktree` は未付与 (regression guard 済)。
 * `/parallel-worktree` の手動 `git worktree add` 運用と二重 worktree 作成干渉
 * リスクがあるため。WorktreeCreate hook の infrastructure は整備完了し、将来
 * 特定 agent で `isolation: worktree` を有効化する際には `/parallel-worktree` と
 * の共存ロジック (env marker / cwd 判定 / handler 側 idempotent 再利用) を
 * 組み合わせて二重作成を防ぐ設計に移行する。
 *
 * ## 関連 doc (設計経緯)
 * - docs/maintainer/research-anthropic-official-2026-04-22.md
 * - docs/maintainer/research-subagent-isolation-2026-04-22.md
 * - docs/maintainer/ROADMAP-model-b.md
 * - CHANGELOG.md (feature history)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfigSafe } from "../config.js";
// pre-compact.ts と同じ安全上限: Plans.md を読み込む際の byte 上限。
const MAX_PLANS_SIZE = 512 * 1024;
// ------------------------------------------------------------
// name validation
// ------------------------------------------------------------
//
// WorktreeCreate input の `name` は Claude Code が生成する slug 名だが、
// hook 入力なので最悪 shell injection / path traversal を想定した defensive
// validation を行う。
//
// - 空文字列 / undefined → reject
// - path separator (/ or \) → reject (sibling 規約 `<parent>/<basename>-wt-<name>` を壊す)
// - `.` 先頭 → reject (隠し directory 化)
// - shell metachar ($ ` ; | & < > * ? ! ( ) { } [ ] # " ' newline) → reject
// - 連続空白 / 先頭空白 → reject
// - 長さ上限 64 (filesystem / git branch name の安全域)
/**
 * 長さ上限 64 文字は NAME_ALLOWED_PATTERN の trailing quantifier `{0,63}` が
 * 先頭 1 文字と合わせて enforce する (1 + 63 = 64)。別途の length ガードは
 * regex に届く前に fire しない dead code となるため置かず、regex と「最大長」
 * の契約を一本化している。
 *
 * 追加 git check-ref-format 準拠制約:
 * - 先頭 `.` を reject (既存 startsWith check)
 * - 連続 `..` を reject (git refname 禁止)
 * - 末尾 `.` を reject (git refname 禁止)
 * - `.lock` suffix を reject (git が refs/heads/ 配下の reserved suffix として使う)
 *
 * (regex 側は control char / space / `~ ^ : ? * [ \ /` 等の禁止文字を
 * character class で既に除外している)
 */
const NAME_ALLOWED_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
function validateWorktreeName(name) {
    if (name.length === 0) {
        return { ok: false, reason: "name is empty" };
    }
    if (name.startsWith(".")) {
        return { ok: false, reason: "name cannot start with '.'" };
    }
    if (!NAME_ALLOWED_PATTERN.test(name)) {
        return {
            ok: false,
            reason: "name must match [A-Za-z0-9_] + [A-Za-z0-9_.-]{0,63} (max 64 chars, no path separators / shell metachars)",
        };
    }
    // git check-ref-format --branch 準拠: `..` / trailing `.` / `.lock` 拒否
    if (name.includes("..")) {
        return { ok: false, reason: "name cannot contain '..' (git refname rule)" };
    }
    if (name.endsWith(".")) {
        return { ok: false, reason: "name cannot end with '.' (git refname rule)" };
    }
    if (name.endsWith(".lock")) {
        return {
            ok: false,
            reason: "name cannot end with '.lock' (reserved git ref suffix)",
        };
    }
    return { ok: true };
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
        // 2 段の regression 対応 (pre-compact.ts と同等):
        //  - pseudo-CodeRabbit (PCR-1): 空配列 `[]` は `Array.isArray` + `every(pred)` の両方を
        //    vacuously true で通過するが、`some(...)` が常に false を返す。
        //  - CodeRabbit (PR #3 inline review): `[""]` / `["   "]` は `typeof "string"` を通過
        //    してしまい、`.some(m => content.includes(m))` で空文字列が任意の行を match し
        //    担当表先頭検出が壊れる。
        // 対応: string 要素に絞り込み → trim → 空要素除去 → 非空要素のみ採用、空なら default fallback。
        const normalizedMarkers = Array.isArray(rawMarkers)
            ? rawMarkers
                .filter((m) => typeof m === "string")
                .map((m) => m.trim())
                .filter((m) => m.length > 0)
            : [];
        const markers = normalizedMarkers.length > 0
            ? normalizedMarkers
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
// handleWorktreeCreate (blocking protocol production)
//
// ## Protocol
//
// 公式仕様 (https://code.claude.com/docs/en/hooks):
//   - Command hook: raw absolute path を stdout に書き出す (NOT JSON)
//   - HTTP hook: `hookSpecificOutput.worktreePath` を含む JSON を返す
//   - exit 0 = 成功、any non-zero exit = worktree 作成失敗 (blocking semantics、
//     他の hook とは違い「exit 2 だけが特別」ではない。全ての non-zero が fatal)
//
// 本 handler は command hook として呼ばれる想定で、実 `git worktree add` を実行し、
// 成功時は `worktreePath` に absolute path を載せて返す。失敗時は worktreePath を
// 未設定のまま返し、index.ts main() が exit 1 に変換する。
//
// ## Worktree path の規約
//
// sibling 配置: `<parent-of-cwd>/<basename-of-cwd>-wt-<name>`
// 例: cwd = `/path/to/my-project`, name = `foo` → `/path/to/my-project-wt-foo`
//
// この規約は `/parallel-worktree` の手動 worktree 作成 (`../<project>-wt-<slug>/`) と
// 一致させており、将来的な agent isolation: worktree と coordinator 手動管理の
// 共存ロジックで path 比較による二重検出を容易にする意図がある。
//
// ## Branch 命名
//
// `harness-wt/<name>` prefix を使う:
//   - 既存 branch (feature/*, main, dev 等) との名前空間衝突を回避
//   - git worktree list / branch list で「harness 由来」であることが一目で分かる
//   - 将来の automated cleanup 対象を prefix で特定可能
//
// ## Idempotency
//
// 同 name で 2 回呼ばれた場合: 既存 worktree を検出し、その path を再度返す
// (re-create しない)。`git worktree add` は同 path が既に存在すると失敗するため、
// existsSync で先に判定する。
// ============================================================
/**
 * path を OS-native realpath で正規化。対象が存在しない場合は parent を正規化して
 * basename と合成 (macOS `/var` → `/private/var` symlink 等の差を吸収、Windows の
 * 8.3 短縮名 `RUNNER~1` → `runneradmin` も拡張)。両方失敗なら resolve で fallback。
 *
 * `realpathSync.native` は OS の canonicalization API を呼び出すため、`realpathSync`
 * (Node.js 内部 JS 実装) と違い Windows 短縮名を確実に展開する。
 */
function normalizePath(p) {
    try {
        return realpathSync.native(p);
    }
    catch {
        // nothing
    }
    try {
        return join(realpathSync.native(dirname(p)), basename(p));
    }
    catch {
        return resolve(p);
    }
}
/**
 * Windows 互換の slash 統一: backslash を forward slash に畳む。
 *
 * Git は `git worktree list --porcelain` で常に forward slash を出力するが、
 * Node.js の `realpathSync` / `resolve` は Windows で backslash を返すため、
 * path 比較を行う際に両者を同一 slash 形式に揃える必要がある。
 */
function toForwardSlash(p) {
    return p.replace(/\\/g, "/");
}
/**
 * git worktree list --porcelain の出力をパースして、指定 path 配下 (absolute match)
 * の worktree が既に存在するかを判定する。存在するなら同 path (正規化後) を返す。
 *
 * --porcelain 形式サンプル:
 *   worktree /main/repo
 *   HEAD abc123...
 *   branch refs/heads/main
 *   (空行区切り)
 *   worktree /other/wt
 *   HEAD def456...
 *   branch refs/heads/foo
 *
 * macOS では `/var/folders/...` と `/private/var/folders/...` の symlink 差を
 * realpathSync で吸収 (同一 worktree が別文字列として見えないように)。
 */
function findExistingWorktree(repo, targetPath) {
    try {
        const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
            cwd: repo,
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf-8",
        });
        // Windows 互換のため、比較は forward slash 統一形式で行う。
        // git worktree list は forward slash 固定、realpathSync は OS 依存 (Windows は backslash)。
        const normalizedTarget = toForwardSlash(normalizePath(targetPath));
        for (const line of out.split("\n")) {
            if (line.startsWith("worktree ")) {
                const path = line.slice("worktree ".length).trim();
                if (toForwardSlash(normalizePath(path)) === normalizedTarget) {
                    return path;
                }
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
export async function handleWorktreeCreate(input) {
    // projectRoot は entry で realpath 正規化する (macOS の `/var` → `/private/var`
    // symlink 差を以降の path 計算に波及させない)。worktreePath も結果的にこの
    // 正規化 root を起点にした sibling となるため、1st call / 2nd call / idempotent
    // case で同一文字列を保証できる。
    const projectRoot = normalizePath(input.cwd ?? process.cwd());
    const sections = [];
    sections.push("=== Harness WorktreeCreate: blocking protocol ===");
    // -------------------------
    // (1) name validation
    // -------------------------
    const rawName = input.name;
    if (typeof rawName !== "string") {
        const reason = "name is required (input.name missing)";
        sections.push(`[error] ${reason}`);
        sections.push("=== WorktreeCreate failed ===");
        return {
            decision: "approve",
            reason,
            additionalContext: sections.join("\n"),
        };
    }
    const validation = validateWorktreeName(rawName);
    if (!validation.ok) {
        const reason = `invalid name: ${validation.reason ?? "rejected"}`;
        // name 自体は NG だが sanitize して observability のためだけに記録する
        sections.push(`[error] ${reason}`);
        sections.push(`[name-raw] ${sanitizeForContext(rawName)}`);
        sections.push("=== WorktreeCreate failed ===");
        return {
            decision: "approve",
            reason,
            additionalContext: sections.join("\n"),
        };
    }
    // -------------------------
    // (2) compute sibling worktree path
    // -------------------------
    const parent = dirname(resolve(projectRoot));
    const base = basename(resolve(projectRoot));
    const worktreePath = resolve(parent, `${base}-wt-${rawName}`);
    const branchName = `harness-wt/${rawName}`;
    // additionalContext 全 payload 値に newline sanitize を適用。rawName/projectRoot
    // 経由で worktreePath/branchName が派生するため、POSIX で改行を含む path が
    // 与えられたケースでも additionalContext の section 境界が偽造されない。
    sections.push(`[name] ${sanitizeForContext(rawName)}`);
    sections.push(`[project-root] ${sanitizeForContext(projectRoot)}`);
    sections.push(`[worktree-path] ${sanitizeForContext(worktreePath)}`);
    sections.push(`[branch] ${sanitizeForContext(branchName)}`);
    if (input.agent_type) {
        sections.push(`[agent-type] ${sanitizeForContext(input.agent_type)}`);
    }
    // -------------------------
    // (3) idempotency: 既存 worktree を検出したら再利用
    //
    // 戻り値は realpath 経由で正規化 (macOS の /var ↔ /private/var 差を排除、1st
    // call と 2nd call で同一文字列を保証)。
    // -------------------------
    const existing = findExistingWorktree(projectRoot, worktreePath);
    if (existing !== null) {
        sections.push("[idempotent] already exists, reused existing worktree");
        sections.push("=== WorktreeCreate reused existing ===");
        return {
            decision: "approve",
            worktreePath: normalizePath(existing),
            additionalContext: sections.join("\n"),
        };
    }
    // -------------------------
    // (4) Repo / Unborn HEAD 事前チェック (2 段階)
    //
    // `git worktree add` は non-git / unborn HEAD いずれの場合も汎用 git エラーを
    // 吐くだけで user 視点の診断性が低い。2 段階に切り分けて診断的な reason に
    // 変換する:
    //   (a) 非 git ディレクトリ: "not a git repository"
    //   (b) unborn HEAD (init 直後、commit 前): "repository has no commits"
    // -------------------------
    if (!isGitRepository(projectRoot)) {
        const reason = `cwd is not a git repository: ${sanitizeForContext(projectRoot)}`;
        sections.push(`[error] ${reason}`);
        sections.push("=== WorktreeCreate failed (non-git cwd) ===");
        return {
            decision: "approve",
            reason,
            additionalContext: sections.join("\n"),
        };
    }
    if (!gitHasCommit(projectRoot)) {
        const reason = "repository has no commits (unborn HEAD); WorktreeCreate requires at least one commit";
        sections.push(`[error] ${reason}`);
        sections.push("=== WorktreeCreate failed (unborn HEAD) ===");
        return {
            decision: "approve",
            reason,
            additionalContext: sections.join("\n"),
        };
    }
    // -------------------------
    // (5) git worktree add を実行
    //
    // `-b <branch>` で新 branch を作成し HEAD から分岐。既に branch が存在する場合は
    // `git worktree add` が失敗するため、事前確認せずに try/catch で拾い、fallback で
    // branch を既存扱いで再試行する。
    //
    // 成功時の戻り値は realpath 正規化した path (idempotent case と揃える)。
    // -------------------------
    // execFileSync を使い shell interpolation を排除 (shell injection 防止)。
    // name は validateWorktreeName で制限済みだが二重防御。
    const addResult = tryGitWorktreeAdd(projectRoot, worktreePath, branchName);
    if (addResult.ok) {
        sections.push("[created] new worktree + branch");
        sections.push("=== WorktreeCreate success ===");
        return {
            decision: "approve",
            worktreePath: normalizePath(worktreePath),
            additionalContext: sections.join("\n"),
        };
    }
    // `-b` で失敗した場合、branch が既存の可能性があるため branch 既存前提で再試行。
    // ただし既存 branch が別 worktree に check-out されている場合は git が拒否する
    // (これは正しい挙動、2 つの worktree から同 branch は使えない)。
    const retryResult = tryGitWorktreeAddExistingBranch(projectRoot, worktreePath, branchName);
    if (retryResult.ok) {
        sections.push("[created] worktree attached to existing branch");
        sections.push("=== WorktreeCreate success (existing branch) ===");
        return {
            decision: "approve",
            worktreePath: normalizePath(worktreePath),
            additionalContext: sections.join("\n"),
        };
    }
    // -------------------------
    // (6) Race condition recheck
    //
    // 2 回 add 失敗後、`findExistingWorktree` の初回判定と `git worktree add` の
    // 間に並行 WorktreeCreate 呼出で worktree が作られた可能性がある。ここで
    // もう一度 list を引いて既存 worktree があれば idempotent 再利用として扱う。
    // -------------------------
    const racedExisting = findExistingWorktree(projectRoot, worktreePath);
    if (racedExisting !== null) {
        sections.push("[idempotent] concurrent create detected after add attempt, reused existing worktree");
        sections.push("=== WorktreeCreate reused existing (post-race) ===");
        return {
            decision: "approve",
            worktreePath: normalizePath(racedExisting),
            additionalContext: sections.join("\n"),
        };
    }
    // -------------------------
    // (7) 最終失敗: git stderr を sanitize して返す
    //
    // git stderr は改行を含み得るため、reason に生コピーすると stderr ログで擬似
    // セクションヘッダが作られる余地がある。sanitizeForContext で改行を `\n`
    // literal に畳み、trim して返す。
    // -------------------------
    const rawStderr = (retryResult.stderr || addResult.stderr || "unknown error")
        .trim();
    const reason = `git worktree add failed: ${sanitizeForContext(rawStderr)}`;
    sections.push(`[error] ${reason}`);
    sections.push("=== WorktreeCreate failed ===");
    return {
        decision: "approve",
        reason,
        additionalContext: sections.join("\n"),
    };
}
/**
 * `cwd` が git リポジトリ (通常の worktree / bare repo / linked worktree のいずれか)
 * にあるかを `git rev-parse --git-dir` で確認。非 git ディレクトリなら false。
 *
 * unborn HEAD (= git init 直後 commit 前) でも true を返す (`git-dir` は存在するため)。
 */
function isGitRepository(repo) {
    try {
        execFileSync("git", ["rev-parse", "--git-dir"], {
            cwd: repo,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * repository に少なくとも 1 個 commit があるかを `git rev-parse HEAD` で確認。
 *
 * 呼び出し前提: `cwd` は `isGitRepository(cwd) === true` が確認済の repo。
 * unborn HEAD (= git init 直後、commit 前) では false、commit があれば true。
 * bare / non-git のケースは `isGitRepository` で先に除外する運用のため、ここでは
 * 「unborn HEAD かどうか」だけを判定できる前提になる。
 */
function gitHasCommit(repo) {
    try {
        execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
            cwd: repo,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return true;
    }
    catch {
        return false;
    }
}
function tryGitWorktreeAdd(repo, path, branch) {
    try {
        execFileSync("git", ["worktree", "add", path, "-b", branch], {
            cwd: repo,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { ok: true };
    }
    catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
            ? err.stderr?.toString() ?? ""
            : String(err);
        return { ok: false, stderr };
    }
}
function tryGitWorktreeAddExistingBranch(repo, path, branch) {
    try {
        // -b 無しで既存 branch を使う。branch が存在しない場合はこれも失敗し、
        // 上位で最終的な失敗として集約される。
        execFileSync("git", ["worktree", "add", path, branch], {
            cwd: repo,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { ok: true };
    }
    catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
            ? err.stderr?.toString() ?? ""
            : String(err);
        return { ok: false, stderr };
    }
}
//# sourceMappingURL=worktree-lifecycle.js.map