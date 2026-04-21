/* generality-exemption: B-1,B-2a,B-2b,B-2c,B-2d,B-2e,B-2f,B-3a,B-3b,B-3c,B-3d,B-3e,B-4a,B-4b,B-5,B-6,B-7,B-8,B-9 — HARNESS-generality-self, detector harness itself must reference patterns it blocks (self-reference unavoidable, until v1.0 redesign) */
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
  // Codex 敵対的レビュー [C-1] 対応: ガードレール範囲を public docs / schema / 非 test 実装へ拡張
  { dir: "schemas", exts: [".json"], recursive: false },
  // core/src 全域を再帰走査 (ただし __tests__ は WARN_TARGETS で別扱い、後段で filter)
  { dir: "core/src", exts: [".ts"], recursive: true },
];

// テスト describe 文に leak が紛れるリスクを別枠で検出する。
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
  {
    // Phase λ 対応: 前身プロジェクト固有の pipeline 検証サブフローを除去。
    // `--test-pipeline` は business-specific flag (前身 project の CSV schema 検証 +
    // `scripts/check-pipeline.sh` を前提) で、汎用 plugin から除去する。project-local
    // な pipeline 検証は `.claude/skills/<project-name>-local-rules/references/pipeline-check.md`
    // 経由で実施する (test-bed 側は Phase ε で移管済み)。
    //
    // Codex [A-N-1] 対応: 旧 regex `/--test-pipeline\b/` は `\b` が `\w\W` 境界で成立するため
    // `--test-pipeline-foo` にも false positive でヒットした。`(?![\w-])` で
    // 後続が word char / hyphen でないことを明示 (`--test-pipeline` 完全一致のみ)。
    id: "B-2f",
    category: "legacy-api",
    pattern: /--test-pipeline(?![\w-])/g,
    message:
      "前身プロジェクトの pipeline 検証サブフロー `--test-pipeline` が shipped spec に含まれています。" +
      "汎用 plugin から除去し、project-local skill (例: `.claude/skills/<project>-local-rules/references/pipeline-check.md`) " +
      "経由で受ける設計にしてください。" +
      "参照: docs/maintainer/leak-audit-2026-04-22.md の Phase λ 項目 (`--test-pipeline` DELETE 決定)。",
    appliesToTests: true,
  },

  // ─────────────── 系列3: 内部タスクトラッカー ID (M-4 拡張: 広い regex) ───────────────
  {
    id: "B-3a",
    category: "tracker-id",
    pattern:
      /(?:Phase\s*\d+[^.\n]{0,40}?申送|Phase\s*\d+\s*Codex[^.\n]{0,40}?申送|申送\s*[A-Z]-\d+|申送\s*M-\d+)/g,
    message:
      "内部タスクトラッカー ID (`Phase N 申送` / `Phase N Codex レビュー申送 C-N` / `申送 M-NN`) が含まれています。" +
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
    pattern: /\b[Aa]-\d+\s*(?:r\d+|round\s*\d+)(?:\s*[A-Z][a-z]+-\d+)?/g,
    message:
      "内部 Codex レビューラウンド ID (`A-N rM` / `A-N round M Major-L` 等) が含まれています。" +
      "maintainer 内部ログの ID を shipped spec に残さないでください。",
    appliesToTests: true,
  },
  {
    id: "B-3d",
    category: "tracker-id",
    pattern: /\b(?:Major|Minor|Trivial|Critical)-\d+\b/g,
    message:
      "内部 Codex レビュー severity ID (`Major-N` / `Minor-N` 等) が tracker label として含まれています。" +
      "shipped spec では description として書くか CHANGELOG.md に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3e",
    category: "tracker-id",
    // Codex [M-4A] 指摘: bare `(C-N)` / `(M-N)` / `(m-N)` が content-integrity.test.ts の
    // describe titles などに残存していた。短すぎる一般語を誤検出しないよう、括弧で囲まれた
    // tracker label 形式に絞る: `(C-1)` / `(M-3)` / `(m-2)` / `(C-12 optional description)` 等
    pattern: /\((?:[CM]|m)-\d+(?:\s+[^)]*)?\)/g,
    message:
      "括弧形式の内部 tracker ID (`(C-N)` / `(M-N)` / `(m-N)`) が含まれています。" +
      "公式に昇格した issue key (例: `HARNESS-42`) に置換するか、" +
      "CHANGELOG.md / docs/maintainer/tracker-migration.md に移管してください。",
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

  // ─────────────── 系列6: Plans.md ファイル名 hardcode (Codex [C-1]) ───────────────
  // core hooks で `"Plans.md"` を hardcoded path として使うと、PLAN_FILE / plansFile 設定を無視する。
  // 純粋な言及 (`Plans.md 担当表` 等) はOKで、`resolve(projectRoot, "Plans.md")` のような実装コードが NG。
  {
    id: "B-6",
    category: "project-file",
    pattern: /resolve\([^,)]+,\s*["']Plans\.md["']\)|readFileSync\([^,)]+["']Plans\.md["']/g,
    message:
      "Plans.md のファイル名が core 実装に hardcode されています。" +
      "`work.plansFile` 設定 (schema 定義済) を読んで fallback するようにしてください。",
    appliesToTests: false,
  },

  // ─────────────── 系列7: 日本語 UI keyword hardcode in core hooks (Codex [C-3]) ───────────────
  // core/src/hooks/*.ts で `担当表` 等を実行時分岐の literal として使うと、i18n が不可能。
  {
    id: "B-7",
    category: "project-file",
    // TS ファイル内の string literal として日本語 UI keyword を hardcoded
    // (description / comment は別、`.includes("担当表")` のような実装コードのみ)
    pattern:
      /\.(?:includes|startsWith|endsWith|match|test|search)\(\s*["'](?:担当表|未着手|進行中|完了|計画|設計|実装)["']\)/g,
    message:
      "日本語 UI キーワードが core 実装の runtime 分岐に hardcode されています。" +
      "`work.assignmentSectionMarkers` / `work.statusKeywords` config 経由で受ける設計にしてください。",
    appliesToTests: false,
  },

  // ─────────────── 系列8: 絶対パス hardcode in shipped spec (Codex [C-1]) ───────────────
  {
    id: "B-8",
    category: "project-file",
    // 代表的な開発者固有パス: /Users/<name>/, /home/<name>/, C:\Users\<name>\
    pattern: /\/Users\/[a-z][a-z0-9_-]+\/|\/home\/[a-z][a-z0-9_-]+\/|C:\\Users\\[A-Za-z]/g,
    message:
      "個人固有の絶対パス (`/Users/<name>/...` 等) が shipped spec に含まれています。" +
      "`/path/to/project` のような placeholder に置換してください。",
    appliesToTests: true,
  },

  // ─────────────── 系列9: Python stack 実行例の universal default 化 (Codex [M-3]) ───────────────
  // 「Python example:」のようなラベルなしで Python コマンドを plugin-wide default として書くのは NG。
  {
    id: "B-9",
    category: "web-stack",
    // `PYTHONPATH=. pytest` / `source .venv/bin/activate` / `python3 -m pip list --outdated` 等
    pattern:
      /(?:source\s+\.venv\/bin\/activate|PYTHONPATH=[.\w\/]+\s+pytest|pip install --upgrade|python3?\s+-m\s+pip)/g,
    message:
      "Python 固有の実行コマンドが universal default として書かれています。" +
      "`Python example:` などのラベルで stack-specific と明示するか、`work.testCommand` config 経由にしてください。",
    appliesToTests: false,
  },

  // B-10 (shipped spec 日本語混入) は本 Phase では policy-based 運用 (CONTRIBUTING §1.2 + 段階移行 plan)。
  // 実装は `docs/maintainer/english-migration.md` で roadmap 化 → 次セッション以降で CI 強制化予定。
];

// ---------------------------------------------------------------------------
// Exemption 検出
// ---------------------------------------------------------------------------

// Markdown / TS コメント形式から exemption 宣言を抽出する regex。
// Codex C-2 minor 指摘対応: 旧 regex は `*` や空文字を capture できず、
// 無効 form (空 / アスタリスク単独 / whitespace) を throw でなく null 素通りにしていた。
// 新 regex は generality-exemption keyword を探し、body は非貪欲に closing marker まで。
const EXEMPTION_FILE_HEAD_PATTERNS = [
  // Markdown: HTML comment (body は --> まで)
  /<!--\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*-->/,
  // TypeScript / JavaScript: block comment (body は block-comment の closing marker まで)
  /\/\*\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*\*\//,
];

/**
 * Parse an exemption declaration from a file head.
 * Codex [C-2] 対応: `all` を禁止し、pattern-id list を必須化する。
 * 形式: `generality-exemption: B-1,B-2a,... — <issue-key>, <reason>`
 * - patternIds: 明示的な pattern-id list (B-\d[a-z]? 形式)
 * - issueKey: `HARNESS-\d+` など (推奨、必須ではない)
 * 返却: { patternIds, reason } or null (exemption 無し)。形式違反時は throw。
 */
function parseExemption(
  content: string,
): { patternIds: Set<string>; reason: string } | null {
  const head = content.slice(0, 800);
  for (const re of EXEMPTION_FILE_HEAD_PATTERNS) {
    const match = re.exec(head);
    if (!match) continue;
    const rawBody = match[1];
    // keyword match はしたが body 欠落 (`<!-- generality-exemption -->`) → throw
    if (rawBody === undefined) {
      throw new Error(
        "generality-exemption declaration has no body. " +
          "Required form: `generality-exemption: B-1,B-2a — HARNESS-42, short reason`. " +
          "Empty declaration is prohibited.",
      );
    }
    const reason = rawBody.trim();
    // 空 / whitespace-only / `*` 単独 等の無効 body を reject
    if (!reason || /^[\s*]+$/.test(reason)) {
      throw new Error(
        "generality-exemption declaration requires an explicit pattern-id list " +
          "(e.g. `generality-exemption: B-1,B-2a — HARNESS-42, short reason`). " +
          "Empty / whitespace-only / `*`-only body is prohibited. Found: '" +
          reason +
          "'",
      );
    }
    // Codex [C-2]: `all` は構造的欠陥なので禁止 (quoted / backticked variants も禁止)
    if (/(?:^|\W)['"`]?all['"`]?(?:$|\W)/i.test(reason)) {
      throw new Error(
        "generality-exemption `all` is prohibited (Codex adversarial review [C-2]). " +
          "Declare explicit pattern IDs (e.g. `B-1,B-2a,B-3c`) so the exemption is scoped. " +
          "Found: " +
          reason,
      );
    }
    // pattern-id を抽出 (B-\d[a-z]? 形式)
    const ids = Array.from(reason.matchAll(/\bB-\d+[a-z]?\b/g)).map((m) => m[0]);
    if (ids.length === 0) {
      throw new Error(
        "generality-exemption must explicitly list pattern IDs " +
          "(e.g. `B-1,B-2a` — issue key, reason). " +
          "None found in: " +
          reason,
      );
    }
    return { patternIds: new Set(ids), reason };
  }
  return null;
}

function hasFileExemption(content: string, patternId: string): boolean {
  const parsed = parseExemption(content);
  if (!parsed) return false;
  return parsed.patternIds.has(patternId);
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
      // __tests__ は WARN_TARGETS で別扱い、重複を避ける
      if (name === "__tests__") continue;
      files.push(...listFiles({ ...target, dir: join(target.dir, name) }));
    }
  }
  return files;
}

/**
 * REPO-level targets: PLUGIN_ROOT 外の repo root 直下 (README.md / docs/en / docs/ja 等)。
 * Codex [C-1] 指摘: 定義のみで使われていなかった死コードを実装と統合。
 */
interface RepoRootTarget {
  relativePath: string; // REPO_ROOT からの相対
  exts: string[];
  recursive: boolean;
}

const REPO_ROOT_TARGETS: RepoRootTarget[] = [
  { relativePath: "README.md", exts: [".md"], recursive: false },
  { relativePath: "docs/en", exts: [".md"], recursive: true },
  { relativePath: "docs/ja", exts: [".md"], recursive: true },
];

function listRepoRootFiles(target: RepoRootTarget): string[] {
  const abs = resolve(REPO_ROOT, target.relativePath);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) {
    return target.exts.some((ext) => abs.endsWith(ext)) ? [abs] : [];
  }
  if (!st.isDirectory()) return [];
  const files: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = join(abs, name);
    const childStat = statSync(full);
    if (childStat.isFile()) {
      if (target.exts.some((ext) => name.endsWith(ext))) files.push(full);
    } else if (childStat.isDirectory() && target.recursive) {
      files.push(
        ...listRepoRootFiles({
          ...target,
          relativePath: join(target.relativePath, name),
        }),
      );
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

// Codex [C-1] 指摘対応: REPO_ROOT_TARGETS (README.md / docs/en / docs/ja) を実際に走査
describe("generality blocklist: repo-level public docs (Codex [C-1] coverage)", () => {
  const repoFiles = REPO_ROOT_TARGETS.flatMap((t) => listRepoRootFiles(t));

  for (const pattern of BLOCK_PATTERNS) {
    // docs/ja は日本語翻訳ディレクトリなので B-7/B-10 系は適用外 (既に B-10 は削除済)
    // ただし B-1..B-5 / B-8 / B-9 は docs でも禁止 (leak 対象)
    describe(`[${pattern.id}] ${pattern.category}`, () => {
      for (const file of repoFiles) {
        const rel = relative(REPO_ROOT, file);
        // docs/ja/** は日本語が正当なので B-7 (日本語 UI keyword hardcode in hooks) は対象外 (そもそも TS でない)
        // docs/ja/** / docs/en/** 両方で branch / legacy-api / tracker-id / project-file / web-stack は禁止
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
