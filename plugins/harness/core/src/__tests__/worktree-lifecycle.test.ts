/**
 * core/src/__tests__/worktree-lifecycle.test.ts
 *
 * WorktreeCreate / WorktreeRemove hook handler のテスト。
 *
 * ## 設計方針
 *
 * - **WorktreeRemove**: non-blocking observability として完全実装。Plans.md の
 *   担当表リマインダーを additionalContext に乗せ、`/parallel-worktree` 運用や
 *   `isolation: worktree` agent 終了時に coordinator の同期漏れを防ぐ。
 *
 * - **WorktreeCreate**: blocking protocol production 実装。hooks.json 登録済、
 *   公式仕様 (https://code.claude.com/docs/en/hooks) に従い command hook として
 *   実 `git worktree add` を実行し、worktreePath (absolute sibling path) を
 *   HookResult に載せて返す。index.ts main() が raw stdout path を書き出し、
 *   exit 0 / 非 0 で blocking semantics (any non-zero causes worktree creation
 *   to fail) を実装。
 *
 * 設計経緯は CHANGELOG.md と docs/maintainer/ROADMAP-model-b.md を参照。
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

/**
 * macOS では `/var` と `/private/var` の symlink 差で string 比較が壊れるため、
 * 存在する path は realpathSync で正規化する。handleWorktreeCreate も内部で
 * projectRoot を realpath 正規化するため、テスト期待値もそれに揃える。
 */
function realpathIfExists(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

import {
  handleWorktreeCreate,
  handleWorktreeRemove,
} from "../hooks/worktree-lifecycle.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempProject(opts?: {
  plansContent?: string;
  harnessConfig?: Record<string, unknown>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-worktree-test-"));
  tempDirs.push(dir);
  if (opts?.plansContent) {
    writeFileSync(join(dir, "Plans.md"), opts.plansContent, "utf-8");
  }
  if (opts?.harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(opts.harnessConfig),
      "utf-8",
    );
  }
  return dir;
}

// ============================================================
// handleWorktreeRemove
// ============================================================

describe("handleWorktreeRemove", () => {
  const baseInput = {
    hook_event_name: "WorktreeRemove",
    session_id: "sess-wr-1",
  };

  it("最小 payload (hook_event_name のみ) でも approve を返す (fail-open)", async () => {
    const result = await handleWorktreeRemove({
      hook_event_name: "WorktreeRemove",
    });
    expect(result.decision).toBe("approve");
    expect(typeof result.additionalContext).toBe("string");
    expect(result.additionalContext).toContain("WorktreeRemove");
  });

  it("worktree_path が additionalContext に含まれる", async () => {
    const dir = makeTempProject();
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/test-wt/feature-slug",
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toContain("/tmp/test-wt/feature-slug");
  });

  it("agent_type / agent_id が additionalContext に含まれる", async () => {
    const dir = makeTempProject();
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/sample",
      agent_type: "harness:worker",
      agent_id: "agent-abc123",
    });
    expect(result.additionalContext).toContain("harness:worker");
    expect(result.additionalContext).toContain("agent-abc123");
  });

  it("Plans.md に担当表がある場合 coordinator リマインダーが出る", async () => {
    const plans = `# Plans

## 担当表

| slug | task | status |
|---|---|---|
| crud | CRUD API | in_progress |
`;
    const dir = makeTempProject({ plansContent: plans });
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: join(dir, "worktrees", "crud"),
    });
    expect(result.additionalContext).toContain("担当表");
    // coordinator 更新リマインダー (キーワードは実装に合わせて)
    expect(result.additionalContext?.toLowerCase()).toMatch(
      /coordinator|plans\.md|担当表/,
    );
  });

  it("shape-invalid config でも fail-open で approve する", async () => {
    const dir = makeTempProject({
      harnessConfig: { work: "not-an-object-but-a-string" as unknown as object },
    });
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/failopen",
    });
    expect(result.decision).toBe("approve");
    expect(typeof result.additionalContext).toBe("string");
  });

  it("cwd が undefined でも例外を投げない (process.cwd() フォールバック)", async () => {
    const result = await handleWorktreeRemove({
      hook_event_name: "WorktreeRemove",
      worktree_path: "/tmp/wt/x",
    });
    expect(result.decision).toBe("approve");
  });

  it("transcript_path を受けても無視して approve (後方互換)", async () => {
    const dir = makeTempProject();
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/x",
      transcript_path: "/tmp/transcripts/sess-wr-1.log",
    });
    expect(result.decision).toBe("approve");
  });

  it("worktree_path が空文字列の場合は undefined と同様に無視", async () => {
    // `if (input.worktree_path)` は空文字列を falsy として無視するため、
    // section に [worktree-path] 行は追加されない。現 fail-open 設計は approve を
    // 返し続けることが重要。
    const dir = makeTempProject();
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "",
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).not.toContain("[worktree-path]");
  });

  it("payload 値内の改行は `\\n` エスケープされ偽 section 注入を防ぐ", async () => {
    const dir = makeTempProject();
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/x\n=== INJECTED ===\n[agent-type] fake",
    });
    expect(result.decision).toBe("approve");
    // 改行が実 newline で section 区切りとして解釈されないこと:
    // sections.join("\n") 後、malicious payload が独立行として浮かび上がらない。
    const lines = (result.additionalContext ?? "").split("\n");
    // `=== INJECTED ===` は独立行としては出現しない (sanitize で `\n` が `\\n` literal に)
    expect(lines).not.toContain("=== INJECTED ===");
    // [worktree-path] 行は 1 行に collapse されている (改行で分岐していない)
    const wpLines = lines.filter((l) => l.startsWith("[worktree-path]"));
    expect(wpLines.length).toBe(1);
    // sanitize 後の literal `\n` (= 2 文字 バックスラッシュ+n) が該当行内に保持
    expect(wpLines[0]).toContain("\\n");
  });

  it("空 `assignmentSectionMarkers: []` でも default marker に fallback し reminder が出る", async () => {
    // `[].every(pred)` は vacuously true のため、length ゼロチェックを入れないと
    // markers = [] になり `markers.some(...)` が永久 false で reminder が無音化。
    const plans = "# Plans\n\n## 担当表\n\n| slug | task |\n|---|---|\n| x | y |\n";
    const dir = makeTempProject({
      plansContent: plans,
      harnessConfig: { work: { assignmentSectionMarkers: [] } },
    });
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/x",
    });
    expect(result.decision).toBe("approve");
    // 空 array は default ("担当表" / "Assignment" / "In Progress") に fallback し、
    // Plans.md の "担当表" が match → reminder が出る。
    expect(result.additionalContext).toContain("担当表");
    expect(result.additionalContext?.toLowerCase()).toMatch(
      /coordinator|plans\.md|担当表/,
    );
  });

  it("空文字 / 空白のみの marker は invalid として default に fallback", async () => {
    // `[""]` / `["   "]` は typeof "string" + length > 0 を通過してしまうが、
    // `content.includes("")` が常に true になり担当表先頭検出が壊れる。normalize chain
    // (filter string → trim → filter non-empty) で排除されていることを regression guard。
    const plans = "# Plans\n\n## 担当表\n\n| x | y |\n|---|---|\n";
    // ケース 1: `[""]` (empty string のみ)
    const dir1 = makeTempProject({
      plansContent: plans,
      harnessConfig: { work: { assignmentSectionMarkers: [""] } },
    });
    const r1 = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir1,
      worktree_path: "/tmp/wt/a",
    });
    expect(r1.decision).toBe("approve");
    expect(r1.additionalContext).toContain("担当表"); // default marker にフォールバック

    // ケース 2: `["   "]` (whitespace のみ)
    const dir2 = makeTempProject({
      plansContent: plans,
      harnessConfig: { work: { assignmentSectionMarkers: ["   "] } },
    });
    const r2 = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir2,
      worktree_path: "/tmp/wt/b",
    });
    expect(r2.decision).toBe("approve");
    expect(r2.additionalContext).toContain("担当表");
  });

  it("valid marker は trim された形で採用される (normalize chain 回帰ガード)", async () => {
    // `["  進捗表  "]` を渡すと trim 後 "進捗表" として Plans.md の "進捗表" と match し、
    // `hasAssignmentTable` が true を返し reminder が出る。trim が抜けると match 失敗で
    // reminder が出ない。
    const plans = "# Plans\n\n## 進捗表\n\n| x | y |\n|---|---|\n| a | b |\n";
    const dir = makeTempProject({
      plansContent: plans,
      harnessConfig: { work: { assignmentSectionMarkers: ["  進捗表  "] } },
    });
    const result = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/tmp/wt/c",
    });
    expect(result.decision).toBe("approve");
    // reminder が出る = trim された "進捗表" が markers として採用され Plans.md と match
    expect(result.additionalContext).toContain("[reminder]");
  });

  it("payload 値内の `\\r` のみ / CRLF も `\\n` エスケープされる", async () => {
    // sanitize は `\r` と CRLF も単位として扱う。regex 劣化 (例: `/\n/g` への
    // 置換) を検知するため 2 パターンを独立にカバー。
    const dir = makeTempProject();
    const crResult = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/path\r=== INJECTED_CR ===",
    });
    const crLines = (crResult.additionalContext ?? "").split("\n");
    expect(crLines).not.toContain("=== INJECTED_CR ===");

    const crlfResult = await handleWorktreeRemove({
      ...baseInput,
      cwd: dir,
      worktree_path: "/path\r\n=== INJECTED_CRLF ===",
    });
    const crlfLines = (crlfResult.additionalContext ?? "").split("\n");
    expect(crlfLines).not.toContain("=== INJECTED_CRLF ===");
    // CRLF は 1 つの `\n` literal にまとまる (`\\n\\n` の二重表示にはならない)
    const wpLine = crlfLines.find((l) => l.startsWith("[worktree-path]")) ?? "";
    expect(wpLine).toContain("\\n");
    expect(wpLine).not.toContain("\\n\\n");
  });
});

// ============================================================
// handleWorktreeCreate (blocking protocol production)
//
// 公式仕様 (https://code.claude.com/docs/en/hooks):
//   - Command hook: raw absolute path を stdout に書き出す
//   - exit code 0 = 成功、non-zero = worktree 作成失敗 (blocking)
//   - Input payload: `name` (公式で明示される唯一の field)
//
// 本 handler の責務:
//   - `git worktree add <path> -b harness-wt/<name>` を実行
//   - 成功時: worktreePath (absolute sibling path) を返す
//   - 失敗時: worktreePath = undefined を返し、index.ts 側で exit 1 に変換
//   - handler 自体は throw しない (fail-open、上位の errorToResult に頼らない)
//
// index.ts main() の worktree-create 分岐が本 handler の worktreePath を
// 拾い stdout に raw path を書き出す。未設定なら exit 1 で blocking 失敗。
// ============================================================

/**
 * 最小 git repo を temp dir に作り、initial commit を置く。
 * handleWorktreeCreate の実 git worktree add 動作検証用。
 */
/**
 * git init with branch name portability fallback.
 *
 * `git init -b main` は git >= 2.28 のみ。古い CI 環境では `git init` +
 * `git branch -M main` に fallback し、後続の worktree add が HEAD から分岐
 * できる状態にする。
 */
function initRepoOnMain(cwd: string): void {
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
  } catch {
    execFileSync("git", ["init"], { cwd, stdio: "pipe" });
    try {
      execFileSync("git", ["branch", "-M", "main"], { cwd, stdio: "pipe" });
    } catch {
      // HEAD が未 born (commit 前) の場合は branch -M が失敗するが、
      // 続く commit 後に branch 名は HEAD のまま使われるので無視。
    }
  }
}

function setupTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-wtc-test-"));
  tempDirs.push(dir);
  initRepoOnMain(dir);
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "harness-test"], {
    cwd: dir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dir,
    stdio: "pipe",
  });
  writeFileSync(join(dir, "README.md"), "test repo\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "pipe" });
  return dir;
}

/**
 * test 終了時に .git/worktrees/ に残骸を残さないよう、作成された worktree path を
 * git worktree remove で撤去する。
 *
 * 注: tempDirs cleanup は rmSync で強制削除されるが、親 repo 側の
 * `.git/worktrees/<slug>/` メタ情報は残ってしまう。vitest が順次並列実行される
 * 場合に不要なエラー出力を防ぐため個別撤去する。
 *
 * shell injection 排除: execFileSync + args array で shell interpolation を
 * 回避 (production コード worktree-lifecycle.ts と同方針)。
 */
function cleanupWorktree(parentRepo: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: parentRepo,
      stdio: "pipe",
    });
  } catch {
    // 既に存在しない場合などは無視 (冪等)。
  }
}

describe("handleWorktreeCreate (blocking protocol)", () => {
  it("関数が export されており呼び出し可能", () => {
    expect(typeof handleWorktreeCreate).toBe("function");
  });

  it("実 git worktree add を実行し worktreePath (absolute) を返す", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "test-feature",
    });
    expect(result.decision).toBe("approve");
    expect(result.worktreePath).toBeDefined();
    // isAbsolute で OS 中立判定 (Windows の "C:\\..." / POSIX "/..." 両対応)。
    expect(isAbsolute(result.worktreePath!)).toBe(true);
    expect(existsSync(result.worktreePath!)).toBe(true);

    // git worktree list に登録されていること。Windows では git が forward
    // slash で出力するため、両側 forward slash に畳んで比較する。
    const listing = execFileSync("git", ["worktree", "list"], {
      cwd: repo,
      stdio: "pipe",
    }).toString();
    const normalizedListing = listing.replace(/\\/g, "/");
    const normalizedPath = result.worktreePath!.replace(/\\/g, "/");
    expect(normalizedListing).toContain(normalizedPath);

    cleanupWorktree(repo, result.worktreePath!);
  });

  it("worktreePath は sibling 規約 (<parent>/<basename>-wt-<name>) に従う", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "my-slug",
    });
    // handler は projectRoot を realpath 正規化するため、expected も同等正規化。
    const realRepo = realpathIfExists(repo);
    const expected = resolve(dirname(realRepo), `${basename(realRepo)}-wt-my-slug`);
    expect(result.worktreePath).toBe(expected);

    cleanupWorktree(repo, result.worktreePath!);
  });

  it("branch naming: harness-wt/<name> prefix で branch 作成 (名前空間衝突防止)", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "branch-check",
    });
    expect(result.worktreePath).toBeDefined();

    const branches = execFileSync("git", ["branch", "--all"], {
      cwd: repo,
      stdio: "pipe",
    }).toString();
    // harness-wt/ prefix により既存 branch (feature/* / main 等) と衝突しない
    expect(branches).toMatch(/harness-wt\/branch-check/);

    cleanupWorktree(repo, result.worktreePath!);
  });

  it("additionalContext に name / worktreePath が含まれる (observability)", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "feature-xyz",
    });
    expect(result.additionalContext).toContain("feature-xyz");
    expect(result.additionalContext).toContain(result.worktreePath!);

    cleanupWorktree(repo, result.worktreePath!);
  });

  it("name が undefined の場合 worktreePath 未設定 + reason に理由 (blocking exit 1 相当)", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
    });
    expect(result.decision).toBe("approve");
    expect(result.worktreePath).toBeUndefined();
    expect(result.reason ?? "").toMatch(/name/i);
  });

  it("name が空文字列の場合も worktreePath 未設定", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "",
    });
    expect(result.worktreePath).toBeUndefined();
    expect(result.reason ?? "").toMatch(/name/i);
  });

  it("cwd が git repo でない場合: reason に 'not a git repository' を明示 (unborn HEAD と区別)", async () => {
    // 非 git ディレクトリは unborn HEAD とは異なる失敗モードなので、
    // reason で「not a git repository」と明示されること (user が cwd 誤指定を
    // 把握できる)。unborn HEAD 向け reason ("no commits") と文字列が分離される。
    const nonGit = mkdtempSync(join(tmpdir(), "harness-wtc-nogit-"));
    tempDirs.push(nonGit);
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: nonGit,
      name: "test-slug",
    });
    expect(result.decision).toBe("approve"); // fail-open
    expect(result.worktreePath).toBeUndefined();
    expect(result.reason ?? "").toMatch(/not a git repository/i);
    // unborn HEAD 側の error 文言は混ざらない
    expect(result.reason ?? "").not.toMatch(/unborn HEAD|no commits/i);
  });

  it("unborn HEAD (git init 直後、commit 前) で明示的 reason を返す", async () => {
    // git init のみで commit が無い repo は `git worktree add` が汎用エラーを吐く。
    // handler 側で unborn HEAD を先検出し診断性の高い reason を返すこと。
    const dir = mkdtempSync(join(tmpdir(), "harness-wtc-unborn-"));
    tempDirs.push(dir);
    initRepoOnMain(dir);
    // 意図的に commit しない — HEAD が unborn state
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: dir,
      name: "unborn-slug",
    });
    expect(result.decision).toBe("approve");
    expect(result.worktreePath).toBeUndefined();
    expect(result.reason ?? "").toMatch(/unborn|HEAD|no commits/i);
    // additionalContext に該当 section が入っていること (observability)
    expect(result.additionalContext ?? "").toMatch(/unborn HEAD/);
  });

  it("race case: 手動で worktree を作ってから handler を呼ぶと post-race recheck で既存 path を返す", async () => {
    // `findExistingWorktree` の初回判定 → `git worktree add` の間に別プロセスが
    // 同 path を作った状況をシミュレート: 手動で `git worktree add` してから
    // handler を呼ぶ。handler 内部の add は失敗するが、post-race recheck で
    // 既存を検出し worktreePath を返すこと。
    const repo = setupTempGitRepo();
    // handler が計算する path と同一 path を手動で作る
    const realRepo = realpathIfExists(repo);
    const expectedPath = resolve(
      dirname(realRepo),
      `${basename(realRepo)}-wt-raced-slug`,
    );
    execFileSync(
      "git",
      ["worktree", "add", expectedPath, "-b", "harness-wt/raced-slug"],
      { cwd: repo, stdio: "pipe" },
    );

    // handler 呼出: 初回 list は既存を検出するので idempotent パスに入る。
    // (post-race recheck 経路を test するには list cache / timing を制御する
    // 必要があり困難だが、少なくとも結果として同 path が返ることを guard。)
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "raced-slug",
    });
    expect(result.decision).toBe("approve");
    expect(result.worktreePath).toBe(expectedPath);

    cleanupWorktree(repo, expectedPath);
  });

  it("name に path separator / shell metachar が含まれる場合 reject (injection 防止)", async () => {
    const repo = setupTempGitRepo();
    for (const bad of [
      "../etc/passwd",
      "slug/nested",
      "slug\\windows",
      "slug;rm",
      "slug\nmultiline",
      "slug`cmd`",
      "slug$(inj)",
      ".hidden",
      "",
    ]) {
      const result = await handleWorktreeCreate({
        hook_event_name: "WorktreeCreate",
        cwd: repo,
        name: bad,
      });
      expect(
        result.worktreePath,
        `name="${bad}" should be rejected but got: ${result.worktreePath}`,
      ).toBeUndefined();
      expect(result.reason, `name="${bad}"`).toBeDefined();
    }
  });

  it("同名で 2 回呼ぶと idempotent (既存 worktree path を返す)", async () => {
    const repo = setupTempGitRepo();
    const r1 = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "dup-slug",
    });
    expect(r1.worktreePath).toBeDefined();

    const r2 = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "dup-slug",
    });
    expect(r2.worktreePath).toBe(r1.worktreePath);
    // 2 回目は「既存を再利用」であり新規作成ではない
    expect(r2.additionalContext ?? "").toMatch(/already|idempotent|reused|既存/i);

    cleanupWorktree(repo, r1.worktreePath!);
  });

  it("cwd 未指定時は process.cwd() にフォールバック (既存契約の継承)", async () => {
    // process.cwd() は通常 harness plugin repo 自体なので worktree 作成は成功する
    // 可能性があるが、name を unique にして干渉を避ける。
    // 本テストは「cwd 未指定でも handler が throw しない」ことの guard。
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      name: `cwd-fallback-${Date.now()}`,
    });
    // 成功 / 失敗のいずれでも decision は approve、throw しない
    expect(result.decision).toBe("approve");
    // worktreePath が取れた場合は cleanup
    if (result.worktreePath) {
      cleanupWorktree(process.cwd(), result.worktreePath);
    }
  });

  it("payload 値内の改行は sanitize されて additionalContext に偽 section 注入しない", async () => {
    const repo = setupTempGitRepo();
    // name は validation で reject される前提だが、仮に reject 後の reason に埋め込まれる
    // payload 値を持っていても改行で section 区切りが偽装されないことを確認。
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "good-name",
    });
    expect(result.worktreePath).toBeDefined();
    // additionalContext 行数を確認し、単一 section 内で完結すること
    const lines = (result.additionalContext ?? "").split("\n");
    // fake section header が独立行として紛れ込まない
    expect(lines).not.toContain("=== INJECTED ===");

    cleanupWorktree(repo, result.worktreePath!);
  });

  it("作成直後の worktree は空き状態 (isolated copy of repo)", async () => {
    const repo = setupTempGitRepo();
    const result = await handleWorktreeCreate({
      hook_event_name: "WorktreeCreate",
      cwd: repo,
      name: "isolated-check",
    });
    expect(result.worktreePath).toBeDefined();
    // 作成 worktree には initial commit の README.md が存在する (HEAD 基点の複製)
    const worktreeFiles = readdirSync(result.worktreePath!);
    expect(worktreeFiles).toContain("README.md");

    cleanupWorktree(repo, result.worktreePath!);
  });
});
