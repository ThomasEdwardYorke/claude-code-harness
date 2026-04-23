/**
 * core/src/__tests__/user-prompt-submit.test.ts
 *
 * UserPromptSubmit hook handler のテスト。
 *
 * ## 設計方針
 *
 * - **Global → Local bridge** として project-local 文書 (e.g. `.claude/rules/*.md`)
 *   を `hookSpecificOutput.additionalContext` に inject する fail-open handler。
 * - **Path-traversal guard**: `..` 含む / absolute path / projectRoot 外への
 *   解決 path は silently skip。
 * - **Size cap**: `maxTotalBytes` (default 16 KiB) 超は truncate + marker。
 * - **Fail-open**: config 読込失敗 / 全 contextFiles missing → no inject、approve。
 *
 * 公式仕様: https://code.claude.com/docs/en/hooks (UserPromptSubmit section)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { handleUserPromptSubmit } from "../hooks/user-prompt-submit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

interface MakeProjectOpts {
  files?: Record<string, string>;
  harnessConfig?: Record<string, unknown>;
}

function makeTempProject(opts: MakeProjectOpts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-ups-test-"));
  tempDirs.push(dir);
  if (opts.files) {
    for (const [relPath, content] of Object.entries(opts.files)) {
      const full = resolve(dir, relPath);
      mkdirSync(resolve(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  }
  if (opts.harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(opts.harnessConfig),
      "utf-8",
    );
  }
  return dir;
}

function callHandler(projectRoot: string, prompt = "test prompt") {
  return handleUserPromptSubmit(
    {
      hook_event_name: "UserPromptSubmit",
      prompt,
      cwd: projectRoot,
    },
    { projectRoot },
  );
}

describe("UserPromptSubmit handler — fail-open behaviour", () => {
  it("config 不在 (no harness.config.json) → no inject, approve", async () => {
    const root = makeTempProject();
    const result = await callHandler(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });

  it("contextFiles 空配列 → no inject, approve", async () => {
    const root = makeTempProject({
      harnessConfig: { userPromptSubmit: { contextFiles: [] } },
    });
    const result = await callHandler(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });

  it("contextFiles 全件 non-existing → no inject, approve", async () => {
    const root = makeTempProject({
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["missing-1.md", "missing-2.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });

  it("malformed harness.config.json → fail-open, approve", async () => {
    const root = mkdtempSync(join(tmpdir(), "harness-ups-test-malform-"));
    tempDirs.push(root);
    writeFileSync(join(root, "harness.config.json"), "{not-json", "utf-8");
    const result = await callHandler(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeUndefined();
  });
});

describe("UserPromptSubmit handler — context injection", () => {
  it("contextFiles 1 件 (existing) → file 内容を additionalContext に含める", async () => {
    const root = makeTempProject({
      files: { ".claude/rules/style.md": "Use kebab-case for filenames." },
      harnessConfig: {
        userPromptSubmit: { contextFiles: [".claude/rules/style.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("Use kebab-case for filenames.");
    expect(result.additionalContext).toContain("--- .claude/rules/style.md ---");
  });

  it("contextFiles 2 件 (両方 existing) → 順番に concat、両方 header 付き", async () => {
    const root = makeTempProject({
      files: {
        "rules/a.md": "RULE-A",
        "rules/b.md": "RULE-B",
      },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["rules/a.md", "rules/b.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toContain("--- rules/a.md ---");
    expect(result.additionalContext).toContain("RULE-A");
    expect(result.additionalContext).toContain("--- rules/b.md ---");
    expect(result.additionalContext).toContain("RULE-B");
    // 順序: a が b より前に出る
    const aIdx = result.additionalContext!.indexOf("RULE-A");
    const bIdx = result.additionalContext!.indexOf("RULE-B");
    expect(aIdx).toBeLessThan(bIdx);
  });

  it("contextFiles 2 件 (片方 missing) → existing のみ inject", async () => {
    const root = makeTempProject({
      files: { "rules/a.md": "ONLY-A" },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["rules/a.md", "rules/missing.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toContain("ONLY-A");
    expect(result.additionalContext).not.toContain("rules/missing.md");
  });

  it("fenceContext: true (default) → fence marker で囲まれる", async () => {
    const root = makeTempProject({
      files: { "x.md": "X" },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["x.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toMatch(/^===== HARNESS PROJECT-LOCAL CONTEXT =====/);
    expect(result.additionalContext).toMatch(/===== END HARNESS CONTEXT =====$/);
  });

  it("fenceContext: false → fence marker なし", async () => {
    const root = makeTempProject({
      files: { "x.md": "X" },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["x.md"], fenceContext: false },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).not.toContain("===== HARNESS");
    expect(result.additionalContext).toContain("X");
  });
});

describe("UserPromptSubmit handler — size cap", () => {
  it("maxTotalBytes 超過分は truncate + marker", async () => {
    const big = "X".repeat(2000);
    const root = makeTempProject({
      files: { "big.md": big },
      harnessConfig: {
        userPromptSubmit: {
          contextFiles: ["big.md"],
          maxTotalBytes: 512,
          fenceContext: false,
        },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("[harness] context truncated at 512 bytes");
    // header (`--- big.md ---\n`) + slice ≤ 512 bytes (handler 内 totalBytes 計算)、
    // 加えて truncation marker `\n\n[harness] context truncated at N bytes` (~42 chars)。
    // marker 自体は cap 計算外 (可読性優先) なので cap + 100 chars 程度の余裕で評価。
    expect(result.additionalContext!.length).toBeLessThan(512 + 100);
  });

  it("maxTotalBytes 未定義 → default 16 KiB が適用される", async () => {
    const big = "Y".repeat(20000);
    const root = makeTempProject({
      files: { "big.md": big },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["big.md"], fenceContext: false },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("[harness] context truncated at 16384 bytes");
  });

  it("malformed maxTotalBytes (string) → default が適用される", async () => {
    const root = makeTempProject({
      files: { "x.md": "X".repeat(20000) },
      harnessConfig: {
        userPromptSubmit: {
          contextFiles: ["x.md"],
          maxTotalBytes: "huge",
          fenceContext: false,
        },
      },
    });
    const result = await callHandler(root);
    // default fallback (16 KiB) で truncate
    expect(result.additionalContext).toContain("[harness] context truncated at 16384 bytes");
  });
});

describe("UserPromptSubmit handler — path traversal defence", () => {
  it("`..` 含むパスは silently skip", async () => {
    const root = makeTempProject({
      files: { "ok.md": "OK-CONTENT" },
      harnessConfig: {
        userPromptSubmit: { contextFiles: ["../etc/passwd", "ok.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toContain("OK-CONTENT");
    expect(result.additionalContext).not.toContain("../etc/passwd");
  });

  it("absolute path は silently skip", async () => {
    const root = makeTempProject({
      files: { "ok.md": "OK-CONTENT" },
      harnessConfig: {
        userPromptSubmit: {
          contextFiles: ["/etc/passwd", "ok.md"],
        },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toContain("OK-CONTENT");
    expect(result.additionalContext).not.toContain("/etc/passwd");
  });

  it("非 string entry (number / null) は silently skip", async () => {
    const root = makeTempProject({
      files: { "ok.md": "OK-CONTENT" },
      harnessConfig: {
        userPromptSubmit: { contextFiles: [123, null, "ok.md"] },
      },
    });
    const result = await callHandler(root);
    expect(result.additionalContext).toContain("OK-CONTENT");
  });
});

describe("UserPromptSubmit handler — input contract", () => {
  it("空 prompt でも fail-open, approve 返す", async () => {
    const root = makeTempProject({
      files: { "x.md": "X" },
      harnessConfig: { userPromptSubmit: { contextFiles: ["x.md"] } },
    });
    const result = await handleUserPromptSubmit(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "",
        cwd: root,
      },
      { projectRoot: root },
    );
    expect(result.decision).toBe("approve");
    // 空 prompt でも config 由来の inject は同じく行う (handler は prompt 内容を見ない)
    expect(result.additionalContext).toContain("X");
  });

  it("input.cwd が options.projectRoot で override される", async () => {
    const root = makeTempProject({
      files: { "x.md": "ROOT-X" },
      harnessConfig: { userPromptSubmit: { contextFiles: ["x.md"] } },
    });
    const result = await handleUserPromptSubmit(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "p",
        cwd: "/totally/different/path",
      },
      { projectRoot: root },
    );
    expect(result.additionalContext).toContain("ROOT-X");
  });
});

// ============================================================
// Shipped-spec generality invariant
//
// 理由: harness-plugin-dev.md R2 rule は shipped hook source file
// (plugins/harness/core/src/hooks/*.ts) に内部トラッカー ID
// (`PR #N` / `Issue #N`) を書かないことを要求する。
// commit message / CHANGELOG / docs/maintainer/ には書いてよいが、
// shipped code comment には書かない — git blame で十分辿れる。
//
// 本 assertion は user-prompt-submit.ts に限定したローカルガード。
// plugin 全体への拡張 (generality.test.ts B-10) は follow-up PR で
// 扱う (backlog #5e)。本 PR の変更範囲を最小に保つため。
// ============================================================
describe("user-prompt-submit.ts — shipped-spec generality", () => {
  it("ソース file に内部トラッカー ID (PR #N / Issue #N) を含まない", () => {
    const handlerPath = resolve(
      __dirname,
      "../hooks/user-prompt-submit.ts",
    );
    const src = readFileSync(handlerPath, "utf-8");

    // `PR #13` / `Issue #5` など、shipped comment に埋めるべきでない
    // 開発時トラッカー ID を検出する。
    const matches = src.match(/\b(PR|Issue)\s*#\d+/g);
    if (matches && matches.length > 0) {
      throw new Error(
        `user-prompt-submit.ts contains internal tracker IDs: ${matches.join(", ")}. ` +
          `Replace with generic wording (e.g. "internal security review") ` +
          `and move PR/Issue references to CHANGELOG.md or commit messages.`,
      );
    }
    expect(matches).toBeNull();
  });
});
