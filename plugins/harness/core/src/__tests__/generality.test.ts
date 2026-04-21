/* generality-exemption: all, detector harness itself must reference patterns it blocks */
/**
 * core/src/__tests__/generality.test.ts
 *
 * 目的: harness plugin を汎用公開 plugin として維持するための **project-local leak 防止テスト**。
 *
 * 背景: parts-management (test bed) との並行開発で、shipped spec に project-specific な業務用語 /
 * ブランチ名 / 内部タスクトラッカー ID / 特定 web stack 前提が混入する事象が発生した
 * (2026-04-22 監査で 119 件検出)。本テストは以下 5 系列の leak を CI で blocking:
 *
 *   - 系列1: specific branch names (feature/new-partslist 等)
 *   - 系列2: 前身プロジェクト業務用語 (upper_script / create_script_from_* / protected-data/ 等)
 *   - 系列3: 内部タスクトラッカー ID (Phase N 申送 / Round N / A-6 r\d+ 等)
 *   - 系列4: project-local ファイル必須参照 (CLAUDE.local.md / .docs/next-session-prompt.md)
 *   - 系列5: 特定 Python web stack の必須化 (checklist 形式で psycopg/defusedxml/WeasyPrint 等)
 *
 * 対象 scope:
 *   - BLOCKLIST_TARGETS (厳格禁止): plugins/harness/agents/*.md, commands/*.md, core/src/hooks/*.ts
 *   - WARN_TARGETS (soft): core/src/__tests__/*.ts (テスト describe 文に混入しやすいため)
 *   - ALLOWLIST (対象外): docs/maintainer/**, CHANGELOG.md, .github/**, node_modules/**, dist/**
 *
 * 例外許容 (exemption):
 *   - Markdown: <!-- generality-exemption: <reason> -->
 *   - TypeScript: /* generality-exemption: <reason> *\/   (* を \ でエスケープ済)
 *   - 行単位: // generality-ok: <reason>   (TS)  /  <!-- generality-ok: <reason> --> (MD)
 *
 * 公式仕様参照:
 *   - https://code.claude.com/docs/en/plugins : plugin は shared/reusable、project-specific は .claude/ 側
 *   - https://code.claude.com/docs/en/plugin-marketplaces : 配布物の品質維持
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");

// ---------------------------------------------------------------------------
// Scope 定義
// ---------------------------------------------------------------------------

interface ScopeTarget {
  dir: string; // PLUGIN_ROOT からの相対
  exts: string[];
  recursive: boolean;
}

const BLOCKLIST_TARGETS: ScopeTarget[] = [
  { dir: "agents", exts: [".md"], recursive: false },
  { dir: "commands", exts: [".md"], recursive: false },
  { dir: "core/src/hooks", exts: [".ts"], recursive: false },
];

// テスト describe 文に leak が紛れるリスクを別枠で検出する (soft warning、ただし実際は厳格 assert)。
const WARN_TARGETS: ScopeTarget[] = [
  { dir: "core/src/__tests__", exts: [".ts"], recursive: false },
];

// ---------------------------------------------------------------------------
// Blocklist パターン定義
// ---------------------------------------------------------------------------

interface BlockPattern {
  id: string;
  category: "branch" | "legacy-api" | "tracker-id" | "project-file" | "web-stack";
  pattern: RegExp;
  message: string;
  // テストファイルでも禁止か (false にすると test では warn のみ)
  appliesToTests: boolean;
}

const BLOCK_PATTERNS: BlockPattern[] = [
  // ─────────────── 系列1: 特定ブランチ名 ───────────────
  {
    id: "B-1",
    category: "branch",
    pattern: /feature\/new-partslist/g,
    message:
      "parts-management の実ブランチ名 `feature/new-partslist` が shipped spec に含まれています。" +
      "例示は generic 値 (`feature/example-feature` / `feature/my-feature` / `main`) に置換してください。" +
      "参照: CONTRIBUTING.md Section 2 (Example Values 規約)",
    appliesToTests: true,
  },

  // ─────────────── 系列2: 前身プロジェクト業務用語 ───────────────
  {
    id: "B-2a",
    category: "legacy-api",
    pattern: /\bupper_script\b/g,
    message:
      "前身プロジェクト (script_generate) の業務 API `upper_script` が含まれています。" +
      "shipped spec に業務 API 名を含めず、project-local skill (CLAUDE.md / AGENTS.md) 参照方式にしてください。",
    appliesToTests: true,
  },
  {
    id: "B-2b",
    category: "legacy-api",
    pattern: /\bcreate_script_from_(url|sentence)\b/g,
    message:
      "前身プロジェクトの業務 API `create_script_from_url` / `create_script_from_sentence` が含まれています。" +
      "汎用 plugin では `public API` / `existing public function signatures` のような抽象表現を使ってください。",
    appliesToTests: true,
  },
  {
    id: "B-2c",
    category: "legacy-api",
    pattern: /protected-data\//g,
    message:
      "前身プロジェクトのディレクトリ `protected-data/` が含まれています。" +
      "project-specific path は harness.config.json で受けるか、project-local skill に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-2d",
    category: "legacy-api",
    pattern: /全9ジャンル/g,
    message:
      "前身プロジェクトの業務用語 `全9ジャンル` が含まれています。shipped spec から除去してください。",
    appliesToTests: true,
  },
  {
    id: "B-2e",
    category: "legacy-api",
    pattern: /\bscript_generate\b/g,
    message:
      "前身プロジェクト名 `script_generate` が shipped spec に含まれています。" +
      "case study は docs/maintainer/ に移管してください。",
    appliesToTests: true,
  },

  // ─────────────── 系列3: 内部タスクトラッカー ID ───────────────
  {
    id: "B-3a",
    category: "tracker-id",
    pattern: /Phase\s*\d+\s*申送/g,
    message:
      "内部タスクトラッカー ID (`Phase N 申送`) が含まれています。" +
      "shipped spec には書かず、CHANGELOG.md / commit message / docs/maintainer/ に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3b",
    category: "tracker-id",
    pattern: /\bRound\s*\d+\b/g,
    message:
      "内部開発ラウンド表記 (`Round N`) が含まれています。maintainer 内部用語です。" +
      "docs/maintainer/session-notes/ に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3c",
    category: "tracker-id",
    pattern: /\bA-\d+\s*r\d+\b/g,
    message:
      "内部 Codex レビューラウンド ID (`A-6 r\\d+`) が含まれています。" +
      "maintainer 内部ログの ID を shipped spec に残さないでください。",
    appliesToTests: true,
  },

  // ─────────────── 系列4: project-local ファイル必須参照 ───────────────
  // 注意: optional / 条件付き参照 ("if exists", "存在すれば") は許容する。
  {
    id: "B-4a",
    category: "project-file",
    pattern: /CLAUDE\.local\.md/g,
    message:
      "parts-management 固有の個人設定ファイル `CLAUDE.local.md` が shipped spec に含まれています。" +
      "plugin は project-local ファイル名を hardcode しないでください。必要なら harness.config.json で受けます。",
    appliesToTests: true,
  },
  {
    id: "B-4b",
    category: "project-file",
    pattern: /next-session-prompt\.md/g,
    message:
      "parts-management 固有の運用ファイル `next-session-prompt.md` が含まれています。" +
      "handoff file の path は `work.handoffFiles` config で受ける設計にしてください。",
    appliesToTests: true,
  },

  // ─────────────── 系列5: 特定 Python web stack の必須化 ───────────────
  // checklist 形式 ("- [ ] ... psycopg ...") で plugin の **必須** チェックとして書かれている場合のみ検出。
  // 単なる例示 ("e.g. psycopg") は warning のみで OK (別枠で後続追加予定)。
  {
    id: "B-5",
    category: "web-stack",
    pattern:
      /-\s*\[\s*\]\s*[^\n]*(?:psycopg|defusedxml|WeasyPrint|openpyxl|y\.?js\s|Tabulator)/gi,
    message:
      "特定 Python/JS web stack (psycopg / defusedxml / WeasyPrint / openpyxl / Y.js / Tabulator) が" +
      "plugin の **必須チェック項目** として固定されています。" +
      "抽象化 (`ORM parameter binding 使用`) + project-local `security.projectChecklistPath` 経由にしてください。",
    appliesToTests: false,
  },
];

// ---------------------------------------------------------------------------
// Exemption 検出
// ---------------------------------------------------------------------------

const EXEMPTION_FILE_HEAD_PATTERNS = [
  // Markdown: HTML comment
  /<!--\s*generality-exemption(?::\s*([^>]+?))?\s*-->/,
  // TypeScript/JavaScript: block comment
  /\/\*\s*generality-exemption(?::\s*([^*]+?))?\s*\*\//,
];

function hasFileExemption(content: string, patternId: string): boolean {
  // ファイル先頭 500 文字以内の宣言のみ有効
  const head = content.slice(0, 500);
  for (const re of EXEMPTION_FILE_HEAD_PATTERNS) {
    const match = re.exec(head);
    if (match) {
      const reason = match[1] ?? "";
      // reason に patternId が含まれるか "all" 宣言なら免除
      if (reason.includes(patternId) || /\ball\b/i.test(reason)) {
        return true;
      }
    }
  }
  return false;
}

function hasLineExemption(line: string): boolean {
  return /(?:\/\/|<!--)\s*generality-ok\b/.test(line);
}

// ---------------------------------------------------------------------------
// ファイル走査
// ---------------------------------------------------------------------------

function listFiles(target: ScopeTarget): string[] {
  const abs = resolve(PLUGIN_ROOT, target.dir);
  if (!existsSync(abs)) return [];
  const entries = readdirSync(abs);
  const files: string[] = [];
  for (const name of entries) {
    const full = join(abs, name);
    const st = statSync(full);
    if (st.isFile()) {
      if (target.exts.some((ext) => name.endsWith(ext))) {
        files.push(full);
      }
    } else if (st.isDirectory() && target.recursive) {
      files.push(...listFiles({ ...target, dir: join(target.dir, name) }));
    }
  }
  return files;
}

function findHits(
  content: string,
  pattern: BlockPattern,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = content.split(/\r?\n/);
  const re = new RegExp(pattern.pattern.source, pattern.pattern.flags);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (hasLineExemption(line)) continue;
    // 各行で regex match (g フラグなので reset 不要に lastIndex=0)
    re.lastIndex = 0;
    const lineMatches = line.match(re);
    if (lineMatches && lineMatches.length > 0) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// テスト生成
// ---------------------------------------------------------------------------

function describeFileBlocklistTests(
  scopeName: string,
  targets: ScopeTarget[],
  patternFilter: (p: BlockPattern) => boolean = () => true,
): void {
  describe(`generality blocklist: ${scopeName}`, () => {
    const allFiles = targets.flatMap((t) =>
      listFiles(t).map((f) => ({ target: t, file: f })),
    );

    for (const pattern of BLOCK_PATTERNS) {
      if (!patternFilter(pattern)) continue;

      describe(`[${pattern.id}] ${pattern.category}`, () => {
        for (const { file } of allFiles) {
          const rel = relative(REPO_ROOT, file);
          it(`${rel} に ${pattern.id} が含まれない`, () => {
            const content = readFileSync(file, "utf-8");
            if (hasFileExemption(content, pattern.id)) {
              return;
            }
            const hits = findHits(content, pattern);
            if (hits.length > 0) {
              const details = hits
                .map((h) => `  L${h.line}: ${h.text}`)
                .join("\n");
              const fullMessage = `\n${pattern.message}\n\nLeak 検出箇所 (${rel}):\n${details}\n`;
              expect.fail(fullMessage);
            }
          });
        }
      });
    }
  });
}

// BLOCKLIST_TARGETS は全 pattern 適用
describeFileBlocklistTests("shipped spec (agents / commands / hooks)", BLOCKLIST_TARGETS);

// WARN_TARGETS (__tests__) は appliesToTests=true の pattern のみ適用
describeFileBlocklistTests(
  "tests describe 文 (内部 ID / ブランチ名漏れ防止)",
  WARN_TARGETS,
  (p) => p.appliesToTests,
);

// ---------------------------------------------------------------------------
// 自己検証: テスト基盤そのものが正しく動くか
// ---------------------------------------------------------------------------

describe("generality test harness 自体の健全性", () => {
  it("BLOCK_PATTERNS の id が全て unique", () => {
    const ids = BLOCK_PATTERNS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("各 pattern の regex に global flag (g) が付いている", () => {
    for (const p of BLOCK_PATTERNS) {
      expect(p.pattern.flags).toContain("g");
    }
  });

  it("BLOCKLIST_TARGETS の各ディレクトリが実在する", () => {
    for (const t of BLOCKLIST_TARGETS) {
      const abs = resolve(PLUGIN_ROOT, t.dir);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it("exemption 検出が正しく動作する (file-head + line)", () => {
    const exemptedMd = `<!-- generality-exemption: B-1, example only -->\n\nfeature/new-partslist`;
    expect(hasFileExemption(exemptedMd, "B-1")).toBe(true);
    expect(hasFileExemption(exemptedMd, "B-2a")).toBe(false);

    const lineExempted = `const branch = "feature/new-partslist"; // generality-ok: fixture`;
    expect(hasLineExemption(lineExempted)).toBe(true);

    const nonExempted = `const branch = "feature/new-partslist";`;
    expect(hasLineExemption(nonExempted)).toBe(false);
  });
});
