/**
 * core/src/__tests__/agent-coderabbit-mimic-content.test.ts
 *
 * `coderabbit-mimic` agent prompt のコンテンツ不変条件 (Task 9a).
 *
 * 目的:
 *   `/pseudo-coderabbit-loop --local` 経由で agent が呼ばれたとき、
 *   `.coderabbit.yaml` の `path_instructions` を **scoring 前** に必ず
 *   pre-parse / 適用させる。本物 CodeRabbit が後段ラウンドで拾う
 *   internal tracker ID 等の leak を pseudo フェーズで取りこぼさないよう、
 *   prompt 上の構造的契約を CI 時点で強制する。
 *
 * 対応する harness rule:
 *   - CONTRIBUTING.md §1.2 "Internal tracker IDs ... must NOT be included"
 *   - generality.test.ts blocklist (B-3)
 *
 * 期待 (高水準):
 *   1. Step 0 (= scoring 前段) で `.coderabbit.yaml` を必ず読み walk-up する
 *      指示が prompt に存在する。
 *   2. 各 reviewed file path に対して `path_instructions` のうち match した
 *      rule の instruction body を per-file review context に注入する手順が
 *      明示されている。
 *   3. Japanese 指示 ("コメントも対象") が code comment にも適用される旨が
 *      明示されている (実 .coderabbit.yaml の指示文を尊重する根拠)。
 *   4. internal tracker ID / 内部識別子の検出を actionable として flag する
 *      enforcement が prompt 内に **scoring path から到達可能** な位置にある
 *      (sub-section の奥に埋もれていない)。
 *   5. CONTRIBUTING.md §1.2 など harness 側の generality 規約 / Plugin
 *      Generality Check への参照が prompt に埋め込まれている。
 *
 * すべて文字列含有 + regex マッチで検証する低結合 assertion。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

function readAgent(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "agents", `${name}.md`), "utf-8");
}

describe("coderabbit-mimic agent: .coderabbit.yaml strict pre-parse (Task 9a)", () => {
  const content = readAgent("coderabbit-mimic");

  // -----------------------------------------------------------------
  // 1. Step 0 = .coderabbit.yaml を scoring 前に必ず読む契約
  // -----------------------------------------------------------------
  describe("Step 0: .coderabbit.yaml pre-parse の存在と必須化", () => {
    it("`Step 0` セクションを scoring 前段として宣言する", () => {
      // workflow が Step 1 (準備) から始まる旧構成だと .coderabbit.yaml の
      // path_instructions が後段の Codex prompt 組立段階でしか参照されず、
      // skip 経路を作りやすい。Step 0 を明示することで「scoring 前段で
      // 必ず実行」という workflow 順序を強制する。
      expect(content).toMatch(
        /Step\s*0[\s\S]{0,160}?(?:Pre-parse|事前解析|事前読取り|事前パース|前処理|プリパース)/i,
      );
    });

    it("Step 0 が `.coderabbit.yaml` を読むことを明示する", () => {
      // walk-up 含めた読取り対象が `.coderabbit.yaml` であることを文字列で確定。
      // これが無いと、別ファイル (e.g. `coderabbit.json`) を誤読しても
      // テストが通ってしまう。
      const step0Block = extractStepBlock(content, /Step\s*0/i);
      expect(step0Block).toMatch(/\.coderabbit\.yaml/);
    });

    it("Step 0 が scoring / findings 評価の前段であることを明文化する", () => {
      // 「読みはするが scoring に反映されない」を防ぐため、Step 0 の中で
      // scoring / findings / 評価 / before のどれかと明示的に紐付け。
      const step0Block = extractStepBlock(content, /Step\s*0/i);
      expect(step0Block).toMatch(
        /(?:before\s+scoring|scoring\s*前|前\s*に\s*scoring|findings.*scoring|前段|事前.*finding|finding.*前)/i,
      );
    });

    it("Step 0 を skip 不可 (mandatory / 必須 / 必ず) と明示する", () => {
      // optional に降格すると黙って skip される運用が再発する。
      const step0Block = extractStepBlock(content, /Step\s*0/i);
      expect(step0Block).toMatch(
        /mandatory|必須|必ず|skip\s*(?:不可|禁止|してはいけない)|REQUIRED|non-?skippable/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 2. path_instructions の per-file 適用アルゴリズムが具体的に書かれている
  // -----------------------------------------------------------------
  describe("path_instructions matching algorithm の具体性", () => {
    it("file path から `.coderabbit.yaml` を walk-up する手順が書かれている", () => {
      // worktree / sub-directory 配下からの呼出でも `.coderabbit.yaml` を
      // 確実に拾うため、親ディレクトリ方向への探索 (walk up / 親へ遡る) を要求。
      expect(content).toMatch(
        /(?:walk[\s-]?up|walk\s+upward|親ディレクトリ|親方向|up\s+the\s+(?:tree|directory)|遡|parent\s+dir|repo\s+root\s+まで)/i,
      );
    });

    it("`path_instructions` を読み取る指示がある", () => {
      // Step 0 / matching セクションのいずれかで literal `path_instructions`
      // を抽出することを要求。
      expect(content).toMatch(/path_instructions/);
    });

    it("各 entry を `path` glob と `instructions` body の組として扱う", () => {
      // 構造を誤解して `path` だけ match して body を捨てると、せっかく
      // 読んだ rule が prompt に注入されない。
      expect(content).toMatch(
        /(?:glob[\s\S]{0,80}?instruction|instruction[\s\S]{0,80}?glob|path[\s\S]{0,40}?instructions|`path`[\s\S]{0,80}?`instructions`)/,
      );
    });

    it("matched rule の instruction body を per-file review context に inject する", () => {
      // Codex に渡る prompt の per-file context に matched instruction を
      // 直接埋め込む = scoring 段階で参照可能、というセマンティクスを強制。
      expect(content).toMatch(
        /(?:inject|埋め込|注入|insert\s+into|注ぎ込|含める|include\s+in[\s\S]{0,80}?context)/i,
      );
      expect(content).toMatch(
        /(?:per-?file|file-?level|file\s*context|reviewed\s+file|各\s*ファイル)/i,
      );
    });

    it("matched rule body が REQUIRED CONTEXT として明示される", () => {
      // optional context に置くと LLM が無視しがち。REQUIRED context として
      // 扱う旨を明示する。
      expect(content).toMatch(/REQUIRED\s+CONTEXT|必須コンテキスト|MUST\s+include/i);
    });
  });

  // -----------------------------------------------------------------
  // 3. Japanese 指示 ("コメントも対象") の解釈規約
  // -----------------------------------------------------------------
  describe("Japanese path_instructions の解釈", () => {
    it("コメントにも path_instructions を適用する旨を明文化する", () => {
      // 実 `.coderabbit.yaml` で多用される「コメントも対象」を、
      // agent が code-only と誤解しないよう契約として書く。
      expect(content).toMatch(/コメントも対象|コード\s*コメント\s*にも|code\s+comments?\s+(?:as\s+well|も|too)/i);
    });

    it("コメント + コードの両方に rule が及ぶことを明示する", () => {
      expect(content).toMatch(
        /(?:コメント[\s\S]{0,40}?コード|code[\s\S]{0,40}?comment|both\s+code\s+and\s+comments|コメント\s+AND\s+コード)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 4. Internal tracker ID の R2 / B-3 enforcement
  // -----------------------------------------------------------------
  describe("Internal tracker ID enforcement (R2 / B-3 reachable)", () => {
    it("`internal tracker ID` (or 等価語) を actionable と書く", () => {
      expect(content).toMatch(
        /(?:internal\s+tracker\s+ID|internal\s+tracker\s+id|内部\s*トラッカー\s*ID|内部\s*識別子|tracker\s+ID|review-?round\s+ID|phase\s+ID|round[\s-]?ID)/i,
      );
    });

    it("発見時に actionable として flag する旨を書く", () => {
      // 「actionable として flag」を文字列で固定し、severity 強度を担保。
      expect(content).toMatch(
        /(?:flag\s+as\s+actionable|actionable\s+(?:として|と)\s*(?:flag|扱う|判定|分類|報告)|actionable\s+finding|MUST\s+(?:flag|report)\s+as\s+actionable)/i,
      );
    });

    it("R2 enforcement が scoring path 上の workflow 主要セクションから到達可能", () => {
      // 「禁止事項」の奥に埋もれただけの enforcement だと scoring 段階の
      // Codex prompt に届かない。Step 0 / Workflow / Step 3 のような
      // 主要 section から R2 / tracker 検出への参照が張られていることを
      // 確認する。
      const mainSections = extractAllStepBlocks(content);
      const hasReachableEnforcement = mainSections.some((block) =>
        /tracker\s+ID|内部\s*識別子|R2|generality|内部.*トラッカー/i.test(block),
      );
      expect(hasReachableEnforcement).toBe(true);
    });

    it("CONTRIBUTING.md / Plugin Generality Check への参照を含む", () => {
      // 抽象的に書かれた「generality 規約」だけでなく、harness 側の具体
      // 文書 (CONTRIBUTING.md §3.1 / PR template "Plugin Generality Check") に
      // 紐付けて scoping を厳格化する。
      expect(content).toMatch(
        /CONTRIBUTING\.md|Plugin\s+Generality\s+Check|generality\s+rule|generality\s+regul|harness\s+R2|§\s*1\.2|§\s*3\.1/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 5. 全体不変条件 (size, frontmatter)
  // -----------------------------------------------------------------
  describe("agent prompt の skill discipline 不変条件", () => {
    it("agent prompt は 500 行未満 (skill discipline)", () => {
      const lineCount = content.split(/\r?\n/).length;
      expect(lineCount).toBeLessThan(500);
    });

    it("frontmatter `name: coderabbit-mimic` を維持", () => {
      expect(content).toMatch(/^---[\s\S]*?name:\s*coderabbit-mimic/);
    });
  });
});

/**
 * Step N ブロックを抜き出す helper (次の Step N+ または "## " section または EOF まで).
 * Step 0 / Step 1 のような小数なし表記前提。
 */
function extractStepBlock(content: string, header: RegExp): string {
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (header.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  // ブロック終端 = 次の「Step <N>」見出し or 「## 」level-2 section or EOF
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (/^#{1,4}\s*Step\s*\d/i.test(line)) {
      end = j;
      break;
    }
    if (/^##\s+\S/i.test(line) && !/^##\s*Step/i.test(line)) {
      end = j;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * 全 Step <N> ブロックを抽出 (Step 0..n).
 */
function extractAllStepBlocks(content: string): string[] {
  const blocks: string[] = [];
  const stepHeaderRe = /^#{1,4}\s*Step\s*(\d)/im;
  // 0..9 まで貪欲に拾う (実際には 0..5 程度の想定)。
  for (let n = 0; n <= 9; n++) {
    const headerRe = new RegExp(`Step\\s*${n}\\b`, "i");
    const block = extractStepBlock(content, headerRe);
    if (block) blocks.push(block);
  }
  // 重複防止: header 始点で uniq.
  return Array.from(new Set(blocks));
}
