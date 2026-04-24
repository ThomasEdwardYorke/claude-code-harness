/* generality-exemption: B-1,B-2a,B-2b,B-2c,B-2d,B-2e,B-2f,B-3a,B-3b,B-3c,B-3d,B-3e,B-4a,B-4b,B-5,B-6,B-7,B-8,B-9 | HARNESS-generality-self | 2099-12-31 | detector harness itself must reference patterns it blocks (self-reference unavoidable, until v1.0 redesign) */
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
 * 例外許容 (exemption) — unified exemption grammar (pipe-separated, 4 required fields):
 *   Format: `generality-exemption: <pattern-ids> | <issue-key> | <expiry> | <reason>`
 *     - pattern-ids: B-\d+[a-z]? CSV list (`all` prohibited)
 *     - issue-key:   [A-Z][A-Z0-9_]*-[A-Za-z0-9_-]+ (e.g. HARNESS-42, HARNESS-generality-self, PARTS-12)
 *     - expiry:      vX.Y.Z (semver) | YYYY-MM-DD (ISO date) | YYYY-Qn (quarter)
 *     - reason:      free text
 *   Placement:
 *     - File-head Markdown: <!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->
 *     - File-head TS:       /* generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale *\/
 *     - Line-level (TS):    // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture
 *     - Line-level (MD):    <!-- generality-exemption: B-1 -->  (short form: pattern-ids のみ許容)
 *   Legacy forms (deprecated & rejected):
 *     - em dash + comma separators (`B-1 — HARNESS-42, v0.5.0, reason`) → throws
 *     - `generality-ok` keyword at line level                          → no longer recognized
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
    // 経由で実施する (test-bed 側は unified exemption grammar で移管済み)。
    //
    // Codex [A-N-1] 対応: 旧 regex `/--test-pipeline\b/` は `\b` が `\w\W` 境界で成立するため
    // `--test-pipeline-foo` にも false positive でヒットした。`(?![\w-])` で
    // 後続が word char / hyphen で **ない** 場合のみ match (suffix 境界のみ厳格化)。
    //
    // Codex 最終 review (m-2) 対応: prefix 側には制約がないため `----test-pipeline` や
    // `foo--test-pipeline` にも match する。本ファイル自身がこれらの例示を含むが、
    // ファイル冒頭の `generality-exemption: ...,B-2f,...` (HARNESS-generality-self) で
    // 自己 hit が無害化されている。case-sensitive (`--Test-Pipeline` は hit しない)。
    // 将来 case-insensitive 化 or prefix 境界強化が必要なら追加検討。
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
// Unified exemption grammar: file-level と line-level で同一 keyword `generality-exemption` を使用。
// 旧 `generality-ok` keyword は廃止 (line-level でも受理されない)。
// File-head declarations must start at a line boundary (optionally indented
// by whitespace / shebang) — docstring samples such as
// ` * - File-head Markdown: <!-- generality-exemption: ... -->` must not be
// misread as actual declarations once the head slice is wide enough to include
// the docstring body (see `EXEMPTION_HEAD_SLICE_BYTES` and Codex MAJOR-1).
const EXEMPTION_FILE_HEAD_PATTERNS = [
  // Markdown: HTML comment (body は --> まで非貪欲)
  /(?:^|\n)\s*<!--\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*-->/,
  // TypeScript / JavaScript: block comment (body は block-comment closing marker まで)
  /(?:^|\n)\s*\/\*\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*\*\//,
];

// Line-level exemption: TS 行コメント or 単一行 MD コメント
const EXEMPTION_LINE_PATTERNS: RegExp[] = [
  // TS line-comment: `// generality-exemption: ...` (行末まで body)
  /\/\/\s*generality-exemption\b\s*(?::\s*(.*?))?\s*$/,
  // MD inline comment: `<!-- generality-exemption: ... -->`
  /<!--\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*-->/,
];

interface ExemptionDeclaration {
  patternIds: Set<string>;
  issueKey: string;
  expiry: string;
  reason: string;
}

// Validation regex (hybrid design for semantic-slug issue keys): semantic-slug issue keys を許容、
// expiry は semver / ISO date / quarter の 3 書式を許容。
// Issue key: uppercase PREFIX, then hyphen, then alphanumeric / underscore / hyphen body.
// Slug forms (e.g. HARNESS-generality-self) are allowed for self-reference cases.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const EXPIRY_SEMVER_RE = /^v\d+\.\d+\.\d+$/;
const EXPIRY_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXPIRY_QUARTER_RE = /^\d{4}-Q[1-4]$/;
// `\d+` allows future expansion to 2+ digit pattern IDs (e.g. B-10, B-99a, B-123).
const PATTERN_ID_EXTRACT_RE = /\bB-\d+[a-z]?\b/g;
// Full-string CSV match for short-form idsPart: rejects any trailing/non-ID text
// so legacy fragments like "B-1, legacy reason" cannot bypass 4-field requirement.
const PATTERN_ID_CSV_RE = /^B-\d+[a-z]?(?:,B-\d+[a-z]?)*$/;
// Subword-safe: requires non-word boundary around `all` so `wall` / `fallback` do not match.
const ALL_KEYWORD_RE = /(?:^|\W)['"`]?all['"`]?(?:$|\W)/i;

/**
 * Parse an exemption body (everything after `generality-exemption:` up to closing marker).
 *
 * Canonical form: `<pattern-ids> | <issue-key> | <expiry> | <reason>` (4 pipe-separated fields).
 * Line-level short form (pattern-ids only; metadata inherited from file-head declaration) is
 * also permitted when `kind === "line"`. Any format violation throws; absence of an exemption
 * comment returns null (null is only reachable from the outer `parseExemption` / line matcher).
 */
function parseExemptionBody(
  rawBody: string | undefined,
  kind: "file" | "line",
): ExemptionDeclaration | null {
  if (rawBody === undefined) {
    throw new Error(
      "generality-exemption declaration body is required and cannot be undefined. " +
        "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | short reason`.",
    );
  }
  const body = rawBody.trim();
  if (!body || /^[\s*]+$/.test(body)) {
    throw new Error(
      "generality-exemption declaration requires explicit fields. " +
        "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | reason`. " +
        "Empty / whitespace-only body found (all characters were whitespace or `*`): '" +
        rawBody +
        "'",
    );
  }
  // Unified exemption grammar migration: legacy 形式 (em-dash / multi-comma / file-level の pipe 無し) を reject
  if (!body.includes("|")) {
    // file-level では pipe + 4 fields が必須
    if (kind === "file") {
      throw new Error(
        "file-level generality-exemption must use pipe (`|`) as separator with 4 fields. " +
          "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | reason`. Found: " +
          body,
      );
    }
    // line-level でも em-dash 混入は legacy として reject
    if (/[—–]/.test(body)) {
      throw new Error(
        "generality-exemption must use pipe (`|`) as separator. " +
          "Legacy em-dash form is no longer accepted. Found: " +
          body,
      );
    }
  }

  const parts = body
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error(
      "generality-exemption body is empty after parsing. Found: " + body,
    );
  }

  // pattern-ids field (parts[0]) の単独 validation。
  // `all` keyword / CSV shape の両方を pattern-ids field に限定することで、
  // reason 内の natural-language な `'all'` 言及や `legacy reason` 文字列を false-positive にしない。
  const idsPart = parts[0];

  // `all` は構造的欠陥なので禁止 — pattern-ids field のみ scope (reason field は free text)。
  if (ALL_KEYWORD_RE.test(idsPart)) {
    throw new Error(
      "generality-exemption `all` is prohibited in the pattern-ids field. " +
        "Declare explicit pattern IDs (e.g. `B-1,B-2a,B-3c`). Found: " +
        JSON.stringify(idsPart),
    );
  }

  const ids = Array.from(idsPart.matchAll(PATTERN_ID_EXTRACT_RE)).map(
    (m) => m[0],
  );
  if (ids.length === 0) {
    throw new Error(
      "generality-exemption must list explicit pattern IDs " +
        "(e.g. `B-1,B-2a`). None found in: " +
        idsPart,
    );
  }

  // idsPart は short form / 4-field form のいずれでも B-\d+[a-z]? の exact CSV である必要がある。
  // Legacy fragments like `B-1, legacy reason` or `,B-1 | ...` or `foo B-1 | ...` は
  // この anchor 付き regex で parse-time reject される。
  if (!PATTERN_ID_CSV_RE.test(idsPart)) {
    throw new Error(
      "generality-exemption pattern-ids field must be an exact CSV of pattern IDs " +
        "(e.g. `B-1,B-2a`). Trailing/interleaved non-ID text is not allowed; " +
        "use the explicit 4-field pipe form for metadata. Found: " +
        JSON.stringify(idsPart),
    );
  }

  // Line-level short form (pattern-ids only; metadata inherited from file-head declaration).
  // Semantic file-head inheritance check is performed by the caller (`hasLineExemption`) when
  // `fileContent` is supplied — this parser only rejects malformed short forms, while the
  // semantic void case (short form without a file-head declaration) is handled one layer up.
  if (kind === "line" && parts.length === 1) {
    return {
      patternIds: new Set(ids),
      issueKey: "",
      expiry: "",
      reason: "",
    };
  }

  // 4-field 厳格モード
  if (parts.length !== 4) {
    throw new Error(
      "generality-exemption must have exactly 4 pipe-separated fields: " +
        "`<pattern-ids> | <issue-key> | <expiry> | <reason>`. " +
        "Found " +
        parts.length +
        " field(s): [" +
        parts.map((p) => JSON.stringify(p)).join(", ") +
        "]",
    );
  }

  const [, issueKey, expiry, reason] = parts;

  if (!ISSUE_KEY_RE.test(issueKey)) {
    throw new Error(
      "generality-exemption issue-key must match `[A-Z][A-Z0-9_]*-[A-Za-z0-9_-]+` " +
        "(e.g. HARNESS-42, HARNESS-generality-self, PARTS-12). Found: " +
        JSON.stringify(issueKey),
    );
  }
  const expiryOk =
    EXPIRY_SEMVER_RE.test(expiry) ||
    EXPIRY_ISO_DATE_RE.test(expiry) ||
    EXPIRY_QUARTER_RE.test(expiry);
  if (!expiryOk) {
    throw new Error(
      "generality-exemption expiry must be semver (`vX.Y.Z`), ISO date (`YYYY-MM-DD`), " +
        "or quarter (`YYYY-Qn`). Found: " +
        JSON.stringify(expiry),
    );
  }
  if (!reason) {
    throw new Error(
      "generality-exemption reason is required and cannot be empty. Body: " +
        body,
    );
  }

  return { patternIds: new Set(ids), issueKey, expiry, reason };
}

// Head slice size: 2048 bytes gives ~10x buffer over a realistic file-head
// declaration (typical length ~200 chars for a 19-ID self-reference exemption).
// Raised from 800 after Codex adversarial review MAJOR-1: block-comment
// declarations whose closing `*/` sat beyond the 800-byte boundary were
// silently dropped by the non-greedy regex, causing exemptions to appear
// valid to humans while being ignored by the parser.
const EXEMPTION_HEAD_SLICE_BYTES = 2048;

function parseExemption(content: string): ExemptionDeclaration | null {
  const head = content.slice(0, EXEMPTION_HEAD_SLICE_BYTES);
  for (const re of EXEMPTION_FILE_HEAD_PATTERNS) {
    const match = re.exec(head);
    if (!match) continue;
    return parseExemptionBody(match[1], "file");
  }
  return null;
}

function hasFileExemption(content: string, patternId: string): boolean {
  const parsed = parseExemption(content);
  if (!parsed) return false;
  return parsed.patternIds.has(patternId);
}

/**
 * Check whether `line` carries a valid generality-exemption comment that
 * covers `patternId`.
 *
 * When `fileContent` is supplied, short-form line-level exemptions (where only
 * pattern-ids are given on the line itself) additionally require the
 * surrounding file to carry a valid 4-field file-head declaration that also
 * covers `patternId`. Without a file-head declaration the short form is
 * semantically void and is rejected so it cannot be used as an escape hatch.
 * If `fileContent` is omitted (parse-only call sites — existing unit tests),
 * the short form is accepted on purely syntactic validity — the caller
 * accepts responsibility for inheritance semantics.
 */
function hasLineExemption(
  line: string,
  patternId: string,
  fileContent?: string,
): boolean {
  for (const re of EXEMPTION_LINE_PATTERNS) {
    const match = re.exec(line);
    if (!match) continue;
    const parsed = parseExemptionBody(match[1], "line");
    if (!parsed) return false;
    if (!parsed.patternIds.has(patternId)) return false;

    // Short-form detection: a short-form declaration is syntactically a line-level
    // comment where only pattern-ids are given (no `|` separators were present,
    // so `issueKey` / `expiry` / `reason` were initialised to empty strings by
    // `parseExemptionBody`). Any of those empties being truthy means the full
    // 4-field form was used at line level and no inheritance check is needed.
    const isShortForm =
      parsed.issueKey === "" && parsed.expiry === "" && parsed.reason === "";
    if (isShortForm && fileContent !== undefined) {
      const fileHead = parseExemption(fileContent);
      if (!fileHead) return false;
      if (!fileHead.patternIds.has(patternId)) return false;
    }
    return true;
  }
  return false;
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
    // Pass full `content` so short-form line exemptions are validated against
    // the file-head 4-field declaration (inheritance semantics).
    if (hasLineExemption(line, pattern.id, content)) continue;
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
    const exemptedMd = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | example only -->\n\nfeature/new-partslist`;
    expect(hasFileExemption(exemptedMd, "B-1")).toBe(true);
    expect(hasFileExemption(exemptedMd, "B-2a")).toBe(false);

    const lineExempted = `const branch = "feature/new-partslist"; // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture`;
    expect(hasLineExemption(lineExempted, "B-1")).toBe(true);
    expect(hasLineExemption(lineExempted, "B-2a")).toBe(false);

    const lineExemptedShort = `const branch = "feature/new-partslist"; // generality-exemption: B-1`;
    expect(hasLineExemption(lineExemptedShort, "B-1")).toBe(true);

    const nonExempted = `const branch = "feature/new-partslist";`;
    expect(hasLineExemption(nonExempted, "B-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unified exemption grammar — `|` separator + 4 必須フィールド
// ---------------------------------------------------------------------------

describe("exemption grammar (unified, pipe-separated)", () => {
  describe("file-level", () => {
    it("accepts valid syntax with 4 fields (semver expiry)", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
      expect(hasFileExemption(md, "B-2a")).toBe(true);
      expect(hasFileExemption(md, "B-3")).toBe(false);
    });

    it("accepts ISO date expiry", () => {
      const md = `<!-- generality-exemption: B-4a | HARNESS-99 | 2026-12-31 | time-bound rationale -->`;
      expect(hasFileExemption(md, "B-4a")).toBe(true);
    });

    it("accepts quarterly expiry (YYYY-Qn)", () => {
      const md = `<!-- generality-exemption: B-5 | HARNESS-10 | 2026-Q2 | quarter-bound rationale -->`;
      expect(hasFileExemption(md, "B-5")).toBe(true);
    });

    it("accepts TS block-comment form", () => {
      const content = `/* generality-exemption: B-6 | HARNESS-7 | v1.0.0 | block-comment form */`;
      expect(hasFileExemption(content, "B-6")).toBe(true);
    });

    it("accepts semantic slug issue-key (backward-compat for HARNESS-generality-self)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-generality-self | 2099-12-31 | detector self-reference -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
    });

    it("accepts cross-project issue-key prefix (e.g. PARTS-12)", () => {
      const md = `<!-- generality-exemption: B-1 | PARTS-12 | v1.0.0 | multi-project tracking -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
    });

    it("throws when issue-key field is missing (only 3 fields present)", () => {
      const md = `<!-- generality-exemption: B-1 | v0.5.0 | reason text -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
    });

    it("throws when expiry field is missing", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | just a reason here -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
    });

    it("throws when reason field is missing (only 3 fields)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/reason/i);
    });

    it("throws when issue-key format is invalid (bare digits, no PREFIX-)", () => {
      const md = `<!-- generality-exemption: B-1 | 42 | v0.5.0 | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
    });

    it("throws when expiry is freeform text (not semver / ISO / quarter)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | someday | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
    });

    it("throws when `all` appears in pattern-id field (existing guard preserved)", () => {
      const md = `<!-- generality-exemption: all | HARNESS-42 | v0.5.0 | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/all/i);
    });

    it("throws when legacy em-dash + comma form is used (pipe is mandatory)", () => {
      const md = `<!-- generality-exemption: B-1 — HARNESS-42, v0.5.0, legacy format -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/pipe|\|/i);
    });

    it("throws when legacy 2-field form (`B-1, reason`) is used", () => {
      const md = `<!-- generality-exemption: B-1, example only -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/pipe|\|/i);
    });
  });

  describe("line-level", () => {
    it("accepts full 4-field form at line level", () => {
      const line = `const x = "feature/foo"; // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
      expect(hasLineExemption(line, "B-2")).toBe(false);
    });

    it("accepts short form with pattern-ids only (metadata inherits from file-head)", () => {
      const line = `const x = "feature/foo"; // generality-exemption: B-1,B-2a`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
      expect(hasLineExemption(line, "B-2a")).toBe(true);
      expect(hasLineExemption(line, "B-3")).toBe(false);
    });

    it("throws when line-level exemption lacks any pattern-id", () => {
      const line = `const x = "feature/foo"; // generality-exemption: free text only`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("rejects `all` at line level as well", () => {
      const line = `const x = "feature/foo"; // generality-exemption: all | reason`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(/all/i);
    });

    it("legacy `generality-ok` keyword is no longer accepted (unified to generality-exemption)", () => {
      const line = `const x = "feature/foo"; // generality-ok: legacy reason`;
      expect(hasLineExemption(line, "B-1")).toBe(false);
    });

    it("MD-form line-level exemption (<!-- ... -->) works too", () => {
      const line = `feature/foo <!-- generality-exemption: B-1 -->`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
    });

    // ------------------------------------------------------------
    // Regression: short-form parser strictness
    // ------------------------------------------------------------
    // Short form (pattern-ids only) must:
    //   (1) Accept ONLY an exact CSV of B-\d+[a-z]? pattern IDs.
    //       Any trailing / interleaved non-ID text MUST be rejected
    //       so legacy fragments like "B-1, legacy reason" cannot bypass
    //       the 4-field requirement via the short-form escape hatch.
    //   (2) Require that the surrounding file has a valid 4-field
    //       file-head declaration when `fileContent` is supplied
    //       (the short-form metadata is defined to *inherit* from the
    //       file head; without one the short form is semantically void).
    // Signature note: `hasLineExemption(line, patternId, fileContent?)`
    // keeps `fileContent` optional so the existing parse-only tests
    // above (no surrounding file context) keep their meaning — those
    // check syntactic parseability only. Production scan (`findHits`)
    // always passes `fileContent` and gets the full semantic check.
    it("short form rejects malformed idsPart with trailing non-ID text ('B-1, legacy reason')", () => {
      const line = `const x = "foo"; // generality-exemption: B-1, legacy reason`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(
        /short form|exact CSV|pattern ID/i,
      );
    });

    it("short form rejects when fileContent has no valid file-head declaration", () => {
      const line = `const x = "foo"; // generality-exemption: B-1`;
      const fileContent = `plain content without any file-head generality-exemption comment`;
      expect(hasLineExemption(line, "B-1", fileContent)).toBe(false);
    });

    it("short form accepts when fileContent carries a valid 4-field file-head declaration", () => {
      const line = `const x = "foo"; // generality-exemption: B-1`;
      const fileContent = `/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | inherited metadata */\nconst x = "foo";`;
      expect(hasLineExemption(line, "B-1", fileContent)).toBe(true);
    });

    it("short form rejects when fileContent file-head declaration does NOT cover requested patternId", () => {
      const line = `const x = "foo"; // generality-exemption: B-2`;
      const fileContent = `/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | only B-1 exempted */\nconst x = "foo";`;
      expect(hasLineExemption(line, "B-2", fileContent)).toBe(false);
    });

    // ------------------------------------------------------------
    // Unicode / look-alike attack-surface invariants for pattern-id parsing.
    //
    // The parser must treat pattern IDs as strict ASCII `B-\d+[a-z]?` tokens.
    // The assertions below lock in that invariant against common bypass
    // vectors (homoglyph letters, zero-width spaces, leading/trailing commas
    // in CSV, and fullwidth pipe look-alikes) so future refactoring cannot
    // accidentally regress them.
    // ------------------------------------------------------------
    it("invariant: Cyrillic look-alike `В-` (U+0412) is rejected — ASCII-only pattern IDs", () => {
      const line = `const x = "foo"; // generality-exemption: В-1`;
      // Cyrillic В is not matched by \b B-\d+ \b; parser finds no pattern IDs → throws.
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("invariant: zero-width space (U+200B) inside idsPart is rejected", () => {
      const zwsp = "​";
      const line = `const x = "foo"; // generality-exemption: B${zwsp}-1`;
      // ZWSP between B and - breaks the \b B- boundary; parser finds no pattern IDs → throws.
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("invariant: leading / trailing comma in CSV idsPart is rejected", () => {
      const lineLead = `const x = "foo"; // generality-exemption: ,B-1`;
      const lineTrail = `const x = "foo"; // generality-exemption: B-1,`;
      expect(() => hasLineExemption(lineLead, "B-1")).toThrow(/short form|exact CSV|pattern ID/i);
      expect(() => hasLineExemption(lineTrail, "B-1")).toThrow(/short form|exact CSV|pattern ID/i);
    });

    it("invariant: fullwidth pipe `｜` (U+FF5C) does not bypass the ASCII pipe requirement", () => {
      const content = `/* generality-exemption: B-1｜HARNESS-42｜v0.5.0｜reason */`;
      // body.includes("|") treats ASCII pipe only; fullwidth form drops into
      // short-form branch and is then rejected by PATTERN_ID_CSV_RE.
      expect(() => hasFileExemption(content, "B-1")).toThrow();
    });

    // ------------------------------------------------------------
    // Codex adversarial MAJOR-1: file-head slice boundary hardening.
    // A file-head block comment (`/* generality-exemption: ... */`) can start
    // before the 800-byte slice boundary and close *after* it, causing the
    // non-greedy `[\s\S]*?` regex to fail match silently — the declaration
    // becomes ineffective. Widen the slice so realistic file headers remain
    // detected even when padded with lengthy shebangs / banner comments.
    // ------------------------------------------------------------
    it("file-head declaration that spans the prior 800-byte boundary remains detected (MAJOR-1)", () => {
      const padding = "x".repeat(790);
      const content = `${padding}\n/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | hardened boundary */\n`;
      expect(hasFileExemption(content, "B-1")).toBe(true);
    });

    it("docstring sample with exemption-like text must NOT be misread as a declaration", () => {
      // Regression: when the head slice was widened from 800 to 2048 bytes to
      // fix MAJOR-1, a non-anchored regex would greedily match documentation
      // samples inside an adjacent docstring (e.g. ` * Sample: <!-- generality-exemption: ... -->`).
      // The line-start anchor on EXEMPTION_FILE_HEAD_PATTERNS must prevent that.
      const content = `/**\n * Format reference:\n * - File-head Markdown: <!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | sample -->\n */\nconst something = 1;\n`;
      // There is no real file-head declaration here — only a docstring sample.
      expect(hasFileExemption(content, "B-1")).toBe(false);
    });
  });

  describe("parser return shape", () => {
    it("parseExemption returns { patternIds, issueKey, expiry, reason } on success", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.patternIds.has("B-1")).toBe(true);
      expect(parsed!.patternIds.has("B-2a")).toBe(true);
      expect(parsed!.issueKey).toBe("HARNESS-42");
      expect(parsed!.expiry).toBe("v0.5.0");
      expect(parsed!.reason).toBe("rationale");
    });

    it("returns null when no exemption present", () => {
      expect(parseExemption("plain content without exemption")).toBeNull();
    });
  });

  describe("pattern-ids field scoping (idsPart CSV strictness + all-keyword scope)", () => {
    // Both checks must operate on parts[0] (pattern-ids field) only, NOT on the full body.
    // Previous behavior scanned the entire body for the `all` keyword, which false-positively
    // rejected valid declarations whose reason field mentioned `all` as a word. It also skipped
    // CSV-shape validation for full 4-field declarations, letting malformed idsPart like
    // ",B-1 | ..." or "foo B-1 | ..." slip past the parser.
    it("rejects full-form idsPart with leading comma ',B-1 | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: ,B-1 | HARNESS-42 | v0.5.0 | leading comma -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("rejects full-form idsPart with non-ID prefix 'foo B-1 | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: foo B-1 | HARNESS-42 | v0.5.0 | non-ID prefix -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("rejects full-form idsPart with trailing suffix 'B-1 legacy | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: B-1 legacy | HARNESS-42 | v0.5.0 | trailing suffix -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("accepts full-form idsPart as exact CSV 'B-1,B-2a | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | exact csv -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.patternIds.has("B-1")).toBe(true);
      expect(parsed!.patternIds.has("B-2a")).toBe(true);
    });

    it("reason field containing standalone 'all' does NOT trigger all-keyword rejection", () => {
      // Previously ALL_KEYWORD_RE.test(body) inspected the whole body, so a reason like
      // "rationale for 'all' exemptions" would throw. After scoping to parts[0], reason is free text.
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | rationale for 'all' exemptions -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.reason).toMatch(/all/);
      expect(parsed!.patternIds.has("B-1")).toBe(true);
    });

    it("idsPart equal to 'all' is still rejected (scoped check preserved)", () => {
      const md = `<!-- generality-exemption: all | HARNESS-42 | v0.5.0 | scoped all -->`;
      expect(() => parseExemption(md)).toThrow(/all/i);
    });

    it("idsPart containing 'all' plus real pattern-id is rejected (pattern-ids field hygiene)", () => {
      const md = `<!-- generality-exemption: all,B-1 | HARNESS-42 | v0.5.0 | mixed rejected -->`;
      expect(() => parseExemption(md)).toThrow(/all|exact CSV|pattern ID/i);
    });
  });
});
