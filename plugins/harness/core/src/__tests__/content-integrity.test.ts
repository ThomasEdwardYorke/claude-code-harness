/**
 * core/src/__tests__/content-integrity.test.ts
 * agents / commands Markdown の不変条件を検証するリグレッションテスト。
 *
 * 詳細履歴は CHANGELOG.md を参照。
 * ここで守りたい不変条件を破壊する修正は CI で即検知される。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

/**
 * Regex metacharacter escape (MDN RegExp guide 推奨形式).
 * new RegExp() で文字列を literal match させたい時に使う。
 * Phase μ release guard を含む future describe で共用するため module scope に置く。
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readAgent(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "agents", `${name}.md`), "utf-8");
}

function readCommand(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "commands", `${name}.md`), "utf-8");
}

function listMdFiles(subdir: string): string[] {
  return readdirSync(resolve(PLUGIN_ROOT, subdir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function extractFrontmatter(content: string): string {
  // Windows の core.autocrlf=true で .md が CRLF 化された場合にも対応 (PR #1 Windows CI 再発防止)。
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    throw new Error(
      "frontmatter (between --- fences) not found at the top of the Markdown file",
    );
  }
  return match[1]!;
}

const AGENT_NAMES = listMdFiles("agents");
const COMMAND_NAMES = listMdFiles("commands");

describe("extractFrontmatter の改行互換性 (PR #1 Windows CI 再発防止)", () => {
  it("LF 改行の frontmatter を抽出できる", () => {
    const lf = "---\nname: test\n---\nbody";
    expect(extractFrontmatter(lf)).toBe("name: test");
  });

  it("CRLF 改行の frontmatter も抽出できる (Windows core.autocrlf 互換)", () => {
    const crlf = "---\r\nname: test\r\ntype: agent\r\n---\r\nbody";
    const fm = extractFrontmatter(crlf);
    expect(fm).toContain("name: test");
    expect(fm).toContain("type: agent");
  });

  it("frontmatter が無いと throw する", () => {
    expect(() => extractFrontmatter("# just body")).toThrow(
      /frontmatter.*not found/,
    );
  });
});

describe("coderabbit-mimic agent の Codex CLI 呼出", () => {
  const content = readAgent("coderabbit-mimic");

  it("codex-companion task を --prompt-file と stdin の二重入力で呼ばない", () => {
    // codex-companion.mjs の readTaskPrompt は --prompt-file があれば stdin を
    // 無視する。余計な `cat ... | node ... --prompt-file ...` は silently
    // drop されて誤解を生むので禁止する。
    const dualInputPattern = /cat\s+\S+\s*\|\s*node\s+[^\n]*--prompt-file/;
    expect(content).not.toMatch(dualInputPattern);
  });

  it("codex-companion task は --prompt-file 単独で呼び出す", () => {
    expect(content).toMatch(/node\s+"\$CODEX_COMPANION"\s+task\s+--prompt-file/);
  });
});

describe("pseudo-coderabbit-loop command の日時計算", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it("GNU 限定の date -d フラグを使わない (BSD/macOS 互換)", () => {
    // `date -u -d` / `date -d` は GNU date にしかないため、
    // macOS / BSD 環境では silent に 0 秒を返して rate-limit 計算が壊れる。
    const gnuOnlyPattern = /date\s+(-u\s+)?-d\s+"\$/;
    expect(content).not.toMatch(gnuOnlyPattern);
  });

  it("ISO 8601 timestamp を python3 datetime.fromisoformat で解釈する", () => {
    expect(content).toMatch(/python3[\s\S]*?datetime[\s\S]*?fromisoformat/);
  });

  it("python3 不在 / parse 失敗時に silent で ELAPSED=900+ へ落ちず WARN を出す", () => {
    // python3 が無い / parse 失敗で PAST_TS=0 になると ELAPSED が常に 900 超となり
    // rate-limit cooldown が無効化される。warn 出力 + 安全側の cooldown 強制を期待。
    expect(content).toMatch(/WARN[\s\S]*?cooldown|cooldown[\s\S]*?WARN/i);
    expect(content).toMatch(/python3[\s\S]*?(command\s+-v|which|not\s+available|不在)/i);
  });
});

describe("pseudo-coderabbit-loop command の profile 読取り fallback", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it(".coderabbit.yaml がある環境で silent に chill へ落ちず WARN を出す (固定文言で厳密判定)", () => {
    // 近傍の無関係な WARN で false-positive しないよう固定文言でアサート。
    expect(content).toMatch(/profile could not be parsed/);
  });

  it("stdlib regex fallback が reviews 直下のインデントだけを拾う", () => {
    // 深い階層 (例: reviews.labels.profile) を誤読しないよう、インデント深さを
    // first_indent で明示的に制約している実装であること。
    expect(content).toMatch(/reviews:.*\n.*first_indent|first_indent.*reviews/s);
  });

  it("stdlib regex fallback が inline YAML comment `# ...` を許容する", () => {
    // `profile: assertive  # comment` のような valid YAML を parse 失敗にしない。
    // pattern 末尾に `(?:\s+#.*)?` が追加されていることを確認。
    expect(content).toMatch(/\(\?:\\s\+#\.\*\)\?/);
  });

  it("stdlib fallback は quoted heredoc (`<<'PYEOF'`) で bash エスケープ依存を排除", () => {
    // bash double-quote 内の `\$` が `$` に変換される挙動に依存すると rewrite 時に破綻しやすい。
    // `<< 'PYEOF'` または `<<'PYEOF'` quoted heredoc で python スクリプトを bash 解釈から隔離する。
    expect(content).toMatch(/python3\s*<<\s*['"]?PYEOF['"]?|<<\s*['"]PYEOF['"]/);
  });

  it("BASE_BRANCH の main fallback が実際に発火する", () => {
    // `git config --get ... | sed ... || echo main` は sed が exit 0 で返すため fallback 発火しない。
    // 別段で取得 + 空チェック `:-main` のパターンが必要。
    expect(content).toMatch(
      /(?:BASE_BRANCH=\$\{?\w+:-main\}?|BASE_BRANCH="?\$\{?[A-Z_]+:-main\}?"?|BASE_BRANCH=\$\{[A-Z_]+:-\s*main\s*\})/,
    );
  });

  it("strict profile を harness-local extension として明示する", () => {
    // CodeRabbit 公式 reviews.profile は chill/assertive のみ (2026-04 時点、
    // https://docs.coderabbit.ai/reference/configuration)。strict は本 plugin 独自拡張。
    expect(content).toMatch(
      /strict[\s\S]{0,500}?(harness|local|extension|拡張|公式外|CodeRabbit 公式に(?:は)?(?:存在し)?ない|non-official)/i,
    );
  });

  it("assertive で nitpick を採用する", () => {
    // 現状: `nitpick (profile が strict の場合のみ)` は公式挙動とずれる。
    // 公式: assertive が nitpick を出す mode。strict は harness 拡張で上限強化のみ。
    expect(content).toMatch(
      /(?:nitpick[\s\S]{0,100}?assertive|assertive[\s\S]{0,100}?nitpick)(?!(?:[\s\S]{0,50}の場合のみ))/i,
    );
  });

  it("YAML 由来 profile を CodeRabbit 公式 allowlist (chill|assertive) で検証する", () => {
    // pseudo-coderabbit-loop.md 側でも、YAML 由来値を allowlist で検証し、
    // strict / typo は WARN を出して chill に fallback すること。
    expect(content).toMatch(
      /(?:allowlist|公式|chill\|assertive|chill.*assertive|chill".*"assertive)[\s\S]{0,400}?(?:WARN|警告|fallback|chill)/i,
    );
  });
});

describe("tdd-implement command の profile 引数伝播", () => {
  const content = readCommand("tdd-implement");

  it("argument-hint に --profile= allowlist を含む", () => {
    expect(content).toMatch(/argument-hint[\s\S]{0,200}?--profile=\(?chill\|assertive\|strict/);
  });

  it("Phase 5.5 の /pseudo-coderabbit-loop 呼出で受け取った $PROFILE を直列化する", () => {
    // 旧: `/pseudo-coderabbit-loop --local --profile=chill` のハードコード
    // 新: `--profile=$PROFILE` または materialized 実値を渡す
    expect(content).toMatch(/pseudo-coderabbit-loop[\s\S]{0,200}?--profile=\$\{?PROFILE\}?|pseudo-coderabbit-loop[\s\S]{0,200}?--profile=\$\{?profile\}?/i);
  });

  it("rate-limit 分岐でも profile を handoff する", () => {
    // rate-limit fallback (`/pseudo-coderabbit-loop <pr>`) で --profile= が抜けると
    // chain の profile 整合が PR-mode 経路で崩れる。
    expect(content).toMatch(
      /rate[\s-]?limit[\s\S]{0,200}?pseudo-coderabbit-loop[\s\S]{0,100}?--profile=/i,
    );
  });

  it("末尾 token のみ --profile= を option として扱う", () => {
    // 任意位置の --profile=... を option 扱いすると task description 本文の
    // `--profile=assertive` 記述まで誤認する。末尾 token 限定が安全。
    expect(content).toMatch(
      /(?:末尾\s*token|last\s*token|ARGS_TOKENS\[-1\]|末尾のみ|末尾オプション|末尾の\s*--profile)/i,
    );
  });

  it("末尾 token 抽出が bash 前提であることを明示する", () => {
    // zsh は配列が 1-based なので `ARGS_TOKENS[LAST_IDX]` の挙動が bash と異なり、
    // silent に profile override が失われる。bash 前提を明記 (または両対応実装)。
    expect(content).toMatch(/bash\s*前提|bash\s+only|require\s+bash|emulate\s+-L\s+sh|setopt\s+ksharrays/i);
  });
});

describe("parallel-worktree command の profile 引数伝播", () => {
  const content = readCommand("parallel-worktree");

  it("argument-hint に --profile= allowlist を含む", () => {
    expect(content).toMatch(/argument-hint[\s\S]{0,300}?--profile=\(?chill\|assertive\|strict/);
  });

  it("<profile> 抽象 placeholder を使わず、$PROFILE / 実値例に置き換える", () => {
    // `/pseudo-coderabbit-loop --local --profile=<profile>` のような抽象 placeholder は、
    // 受け手側で未束縛 → silent degradation の原因になる。
    expect(content).toMatch(
      /pseudo-coderabbit-loop[\s\S]{0,200}?--profile=(?:\$\{?PROFILE\}?|chill|assertive|strict)(?!\w)/,
    );
  });

  it("Phase 6 rate-limit fallback でも profile を handoff する", () => {
    // 並列経路でも CodeRabbit rate-limit 後に --profile= が欠落すると、PR-mode の
    // pseudo review が別 profile で走り chain が崩れる。
    expect(content).toMatch(
      /rate[\s-]?limit[\s\S]{0,300}?pseudo-coderabbit-loop[\s\S]{0,150}?--profile=/i,
    );
  });

  it("縮退モード (1 サブタスク) で /tdd-implement に --profile= を渡す", () => {
    // `--max-parallel=1` や 1 サブタスク時も solo 相当で profile を揃えるべき。
    expect(content).toMatch(
      /(?:縮退|degraded|max-parallel=1|サブタスク[数\s]*=\s*1)[\s\S]{0,400}?tdd-implement[\s\S]{0,200}?--profile=/i,
    );
  });
});

describe("harness-work command の Agent-tool プロンプト materialize", () => {
  const content = readCommand("harness-work");

  it("wt:avoid Agent-tool 経路の Phase 5.5 記述で literal $PROFILE を残さない", () => {
    // Skill handoff と同様、Agent prompt (旧称 Task prompt) も materialize が必要。
    // `/pseudo-coderabbit-loop --local --profile=$PROFILE` のまま Agent prompt 文字列で
    // 渡すと、subagent 側で slot 展開されない (Anthropic 公式の動的置換は $ARGUMENTS のみ)。
    // prompt 組立段階での実値埋込規約が明記されていること。
    expect(content).toMatch(
      /(Task[\s\S]{0,600}?(?:materialize|実値[\s\S]{0,40}?(?:置換|埋め込))|tdd_enforced_prompt[\s\S]{0,300}?(?:materialize|実値))/,
    );
  });
});

describe("coderabbit-mimic agent の静的解析呼出安全性", () => {
  const content = readAgent("coderabbit-mimic");

  it("ruff check 等の analyzer が空白入りパスで壊れない (xargs -0 / 分割安全)", () => {
    // `$(grep '.py$' files.txt)` のような unquoted command substitution を avoid し、
    // NULL 区切り (git diff -z) + xargs -0 に変えていること。
    expect(content).toMatch(/xargs\s+-0/);
    expect(content).toMatch(/git\s+diff\s+-z|-z\s+--name-only/);
  });

  it("origin/$BASE_BRANCH 不在時は検証済み fallback のみ許容、HEAD 空 diff は禁止", () => {
    // fetch 失敗・未取得 branch 環境で `git diff origin/$BASE_BRANCH..HEAD` が fatal 落ちしないよう、
    // rev-parse --verify による base ref 確認 + fallback を持つこと。
    expect(content).toMatch(/rev-parse\s+--verify[\s\S]{0,200}?origin\/\$BASE_BRANCH/);
    expect(content).toMatch(/BASE_REF[\s\S]{0,80}?(?:origin\/\$BASE_BRANCH|fallback)/);
    // r7 Major severity: `BASE_REF=HEAD` (空 diff fallback) は false-clear review を生むので禁止。
    // 検証済み ref が無ければ hard error (exit 1) が期待される。
    expect(content).not.toMatch(/BASE_REF\s*=\s*["']?HEAD["']?\s*$/m);
    expect(content).toMatch(/no valid base ref[\s\S]{0,200}?exit\s+1|exit\s+1[\s\S]{0,200}?(?:false-clear|base ref)/);
  });
});

describe("pseudo-coderabbit-loop command の $ARGUMENTS 取り込み", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it("documented な slash-command 動的引数 $ARGUMENTS を実際に parse する", () => {
    // Arguments セクションに --profile / --worktree / pr-number を advertise していながら
    // Step 0 で受け取っていないと end-to-end で effectful にならない。
    expect(content).toMatch(/\$ARGUMENTS|\$\{ARGUMENTS\}/);
  });

  it("argv を配列化してから case 完全一致 (for tok in $ARGUMENTS は word splitting で壊れる)", () => {
    // bash の `for tok in $ARGUMENTS` は IFS 依存。`read -r -a TOKENS <<< "$ARGUMENTS"` 等で
    // 配列化してから `for tok in "${TOKENS[@]}"` で展開し、各要素を quote 保持する。
    expect(content).toMatch(
      /read\s+-r\s+-a\s+\w+[\s\S]{0,200}?<<<\s+"\$ARGUMENTS"|read\s+-ra\s+\w+[\s\S]{0,200}?<<<\s+"\$ARGUMENTS"/,
    );
  });

  it("--local flag が後段 (gh 呼出) を分岐する", () => {
    // `CLI_LOCAL="yes"` を設定するだけで使われていないと pre-push mode / offline が機能しない。
    // gh CLI を叩く前に `[ -n "$CLI_LOCAL" ]` 等で分岐していること。
    expect(content).toMatch(/(?:\[\s+-n\s+"\$CLI_LOCAL"\s+\]|-z\s+"\$CLI_LOCAL"|CLI_LOCAL[\s\S]{0,50}?(?:then|\|\|))/);
  });

  it("positional PR 番号 CLI_PR を $PR に反映する", () => {
    // `CLI_PR` に値を入れただけで `PR="..."` に反映しないと gh api /pulls/${PR} が空になる。
    expect(content).toMatch(/PR=\s*"?\$\{?CLI_PR:?-?\$?PR\}?"?|PR="\$CLI_PR"/);
  });

  it("MODE=\"pr\" で gh 呼出が実際に gate されている", () => {
    // 変数定義だけで使われていないと GitHub API が無条件実行される。
    // Step 1 / Step 4 / Step 5 の gh api / gh pr コマンドが `$MODE` の検査で囲まれていること。
    const gateCount = (content.match(/if\s+\[\s+"?\$\{?MODE\}?"?\s+=\s+"pr"\s+\]/g) || []).length;
    expect(gateCount).toBeGreaterThanOrEqual(2);
  });
});

describe("coderabbit-mimic agent の一時ファイル隔離", () => {
  const content = readAgent("coderabbit-mimic");

  it("WORKDIR=$(mktemp -d ...) 実体が shell で定義されている", () => {
    // prose の `mktemp -d` だけで pass しないよう shell 断片にアンカー。
    expect(content).toMatch(/WORKDIR\s*=\s*\$\(mktemp\s+-d/);
  });

  it("trap 'rm -rf \"$WORKDIR\"' EXIT で cleanup する", () => {
    expect(content).toMatch(/trap\s+['"]rm\s+-rf\s+"\$WORKDIR"['"]\s+EXIT/);
  });

  it("Codex プロンプトの heredoc は quoted + placeholder 置換方式で shell 展開を防ぐ", () => {
    // round 4 で unquoted heredoc に変えたが、round 7 で prompt 本文内の `$VAR` / `$(...)` が
    // shell で展開される security risk が指摘された。quoted heredoc に戻し、`$WORKDIR` は
    // `@@WORKDIR@@` のような sentinel に書き、後段で sed 置換する方式に統一する。
    const quotedHeredoc = /cat\s+>\s+"\$WORKDIR\/prompt\.md"\s+<<\s*'[A-Z_]+'/;
    expect(content).toMatch(quotedHeredoc);
    // placeholder 置換ステップが存在する
    expect(content).toMatch(/sed[\s\S]{0,200}?(?:@@WORKDIR@@|@WORKDIR@|<WORKDIR>)/);
  });
});

describe("coderabbit-mimic agent の JSON 妥当性検証", () => {
  const content = readAgent("coderabbit-mimic");

  it("jq が無い環境でも JSON 検証できる fallback を持つ", () => {
    // jq / python3 / node のいずれかに degrade できる実装であること。
    expect(content).toMatch(/command\s+-v\s+jq[\s\S]{0,800}?(python3|node)/);
  });
});

describe("harness-work command の profile 読取り fallback", () => {
  const content = readCommand("harness-work");

  it("Pre-flight の profile 解釈で silent な chill fallback をしない", () => {
    // pseudo-coderabbit-loop と同じ WARN 固定文言を含めて retrograde を検知。
    expect(content).toMatch(/profile could not be parsed/);
  });

  it("yq / python3 の存在を command -v で明示チェックする", () => {
    // 素朴な `yq ... || python3 ...` の silent degradation を排除した実装を要求。
    const hasBinaryGuard =
      /command\s+-v\s+(yq|python3)/;
    expect(content).toMatch(hasBinaryGuard);
  });

  it("stdlib fallback は quoted heredoc で bash エスケープ依存を排除", () => {
    // harness-work 側でも同じ regex / heredoc を使うため、同じ堅牢さを要求。
    expect(content).toMatch(/python3\s*<<\s*['"]?PYEOF['"]?|<<\s*['"]PYEOF['"]/);
  });

  it("Pre-flight で解決した $PROFILE が Phase 5.5 記述 + Skill handoff に接続される", () => {
    // literal `PROFILE` を pass しないよう `$` を必須化。
    // 説明文 `--profile=$PROFILE` が存在する
    expect(content).toMatch(/--profile=\$\{?PROFILE\}?/);
    // Skill({...}) / Task の handoff args にも `--profile=...` が直列化される
    const skillHandoff = /Skill\([\s\S]{0,400}?(?:tdd-implement|parallel-worktree)[\s\S]{0,400}?--profile=\$\{?PROFILE\}?/;
    expect(content).toMatch(skillHandoff);
  });

  it("handoff 時は PROFILE 実値への materialize 責任を明示する", () => {
    // Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` のみ保証。
    // `${PROFILE}` は undocumented なので、LLM が事前に実値に置換してから Skill を呼ぶ責任を明記。
    expect(content).toMatch(/materialize|実値[\s\S]{0,80}?(?:置換|埋め込)|literal[\s\S]{0,80}?(?:受け手|literal|そのまま|渡[さっす]?)/i);
  });

  it("Anthropic 公式の positional argument 表記は 0-based ($0 が第1引数、厳密化済)", () => {
    // 旧: `$1..$N のみ保証` は 1-based 前提。残存を広いパターンで禁止。
    // 新: `$ARGUMENTS / $ARGUMENTS[N] / $N (0-based)` の公式表記に揃える。
    //
    // 過去 review round の指摘: backtick 付きや前置テキストを含む残存を見逃さないよう、
    // どこに `$1..$N` が出現しても FAIL する広いパターンに修正する。
    expect(content).not.toMatch(/\$1\s*\.\.\s*\$N/);
    // 公式仕様に則った 0-based 表記の説明があること
    expect(content).toMatch(/0-?based|\$0[\s\S]{0,100}?第\s*1|第\s*1[\s\S]{0,40}?\$0|\$ARGUMENTS\[N\]/);
  });

  it("handoff 例が少なくとも 1 つは実値 materialize 済み", () => {
    // 文面に「materialize」と書くだけで pass しないよう、実値埋込済み (chill/assertive/strict) の
    // Skill 呼出例が最低 1 つは存在することを assert。
    const materialized =
      /Skill\([\s\S]{0,500}?(?:tdd-implement|parallel-worktree)[\s\S]{0,500}?--profile=(?:chill|assertive|strict)(?!\w)/;
    expect(content).toMatch(materialized);
  });

  it("harness.config.json の profile key path が設定例と実装で一致", () => {
    // 旧: 実装が `.pseudoCoderabbitProfile` 直下なのに設定例は `.tddEnforce.pseudoCoderabbitProfile`。
    // 正しい path に統一され、JSON 破損時には WARN を出すこと。
    expect(content).toMatch(/\.tddEnforce\.pseudoCoderabbitProfile/);
    expect(content).toMatch(/jq\s+empty[\s\S]{0,200}?harness\.config\.json[\s\S]{0,200}?WARN|WARN[\s\S]{0,200}?harness\.config\.json[\s\S]{0,200}?(?:JSON|jq)/i);
  });

  it("profile 値の優先順位 (引数 > harness.config.json > .coderabbit.yaml > chill) が明記される", () => {
    // pseudoCoderabbitProfile との優先順位が明文化されているか。
    expect(content).toMatch(
      /pseudoCoderabbitProfile[\s\S]{0,800}?(?:優先|順位|precedence|fallback|\.coderabbit\.yaml)/,
    );
  });

  it("CLI --profile= 抽出が case 文で完全一致判定", () => {
    // r5 の `grep -oE -- '--profile=(chill|assertive|strict)'` は substring match のため
    // `--profile=strict1` を `--profile=strict` に誤抽出する (過去 review 指摘)。
    // argv 配列化 + case 文で完全一致比較。
    // CodeRabbit PR #1 Major: argv 全走査ではなく末尾 token 限定に変更 (task description 本文の
    // `--profile=...` 引用文言を option と誤認しない)。どちらの実装でも完全一致 case 文は必須。
    expect(content).toMatch(
      /case\s+"?\$(?:tok|LAST_TOK)"?\s+in[\s\S]{0,400}?--profile=chill\|--profile=assertive\|--profile=strict/,
    );
  });

  it("YAML 由来 profile を CodeRabbit 公式 allowlist (chill|assertive) で検証し、strict/typo は WARN + chill へ fallback", () => {
    // strict は harness-local extension であり、YAML 由来では採用しない方針を強制。
    expect(content).toMatch(
      /(?:allowlist|公式|chill\|assertive|chill.*assertive|chill".*"assertive)[\s\S]{0,400}?(?:WARN|警告|fallback|chill)/i,
    );
  });
});

describe("coderabbit-mimic agent の STDERR_LOG cleanup / 参照", () => {
  const content = readAgent("coderabbit-mimic");

  it("STDERR_LOG の参照方法または cleanup が明記されている", () => {
    // 分離した stderr ログが parse 失敗時のデバッグに使われる or 成功時に削除される
    // ことを示す記述 (rm / tail / 参照方法 / cleanup) が存在すること。
    const hasLifecycle = /STDERR_LOG[\s\S]{0,600}?(rm\s|tail\s|cleanup|削除|参照)/i;
    expect(content).toMatch(hasLifecycle);
  });
});

describe("worker agent の Co-Authored-By プレースホルダー", () => {
  const content = readAgent("worker");

  it("Co-Authored-By 行がコミットテンプレートに含まれる", () => {
    expect(content).toMatch(/Co-Authored-By:\s+Claude[^<]*<noreply@anthropic\.com>/);
  });

  it("モデル名プレースホルダーの置換指示が明記される", () => {
    // リテラル <model> / <実行中モデル名> のような placeholder は、
    // worker が実行時に自分のモデル名 (例: Claude Opus 4.7 (1M context))
    // で置換する必要がある。指示が明文化されているか検証。
    const hasReplacementInstruction =
      /実行中モデル名|実行時.*モデル名|place\s*holder|自分のモデル名|モデル名で置換|モデル名に置換/i.test(
        content,
      );
    expect(hasReplacementInstruction).toBe(true);
  });
});

describe("harness-setup check の expected 配列", () => {
  const binSource = readFileSync(
    resolve(PLUGIN_ROOT, "bin", "harness"),
    "utf-8",
  );

  const mustInclude = [
    "agents/codex-sync.md",
    "agents/coderabbit-mimic.md",
    "agents/security-auditor.md",
    "commands/parallel-worktree.md",
    "commands/pseudo-coderabbit-loop.md",
    "commands/tdd-implement.md",
  ];

  it.each(mustInclude)(
    "bin/harness cmdCheck の expected に '%s' が含まれる",
    (path) => {
      expect(binSource).toContain(path);
    },
  );
});

describe("全 agent / command に frontmatter が存在する", () => {
  // extractFrontmatter は frontmatter が無いと throw するため、
  // 欠落・破損は「テスト実行時の例外」として検知される。

  it.each(AGENT_NAMES)("%s agent に frontmatter が存在する", (name) => {
    expect(() => extractFrontmatter(readAgent(name))).not.toThrow();
  });

  it.each(COMMAND_NAMES)("%s command に frontmatter が存在する", (name) => {
    expect(() => extractFrontmatter(readCommand(name))).not.toThrow();
  });
});

describe("subagent frontmatter — Claude Code 公式仕様 (2026 年 4 月確認済)", () => {
  // 公式: https://code.claude.com/docs/en/sub-agents
  // - 正式キーは `tools` (allowlist) と `disallowedTools` (denylist)。`allowedTools` は非公式
  // - `memory` の正式値は user|project|local (none は未設定を意味する UI 表示のみ)
  // - `effort` は low|medium|high|xhigh|max の 5 値

  it.each(AGENT_NAMES)("%s agent は非公式キー 'allowedTools' を frontmatter に使わない", (name) => {
    const fm = extractFrontmatter(readAgent(name));
    expect(fm).not.toMatch(/^allowedTools\s*:/m);
  });

  it.each(AGENT_NAMES)("%s agent は 'memory: none' を使わない (公式値外)", (name) => {
    const fm = extractFrontmatter(readAgent(name));
    expect(fm).not.toMatch(/^memory\s*:\s*none\b/m);
  });

  it.each(AGENT_NAMES)("%s agent の effort (設定がある場合) は公式 5 値のいずれか", (name) => {
    const fm = extractFrontmatter(readAgent(name));
    const effort = /^effort\s*:\s*([a-z]+)/m.exec(fm)?.[1];
    if (effort) {
      expect(["low", "medium", "high", "xhigh", "max"]).toContain(effort);
    }
  });

  it.each(AGENT_NAMES)("%s agent の memory (設定がある場合) は公式 3 値のいずれか", (name) => {
    const fm = extractFrontmatter(readAgent(name));
    const memory = /^memory\s*:\s*([a-z]+)/m.exec(fm)?.[1];
    if (memory) {
      expect(["user", "project", "local"]).toContain(memory);
    }
  });
});

describe("slash command frontmatter — Claude Code 公式仕様", () => {
  // 公式: https://code.claude.com/docs/en/skills
  // - キーはハイフン区切り: allowed-tools / argument-hint / description
  // - camelCase (allowedTools / argumentHint) は非公式

  it.each(COMMAND_NAMES)("%s command は 'allowedTools' camelCase を使わない", (name) => {
    const fm = extractFrontmatter(readCommand(name));
    expect(fm).not.toMatch(/^allowedTools\s*:/m);
  });

  it.each(COMMAND_NAMES)("%s command は 'argumentHint' camelCase を使わない", (name) => {
    const fm = extractFrontmatter(readCommand(name));
    expect(fm).not.toMatch(/^argumentHint\s*:/m);
  });
});

describe("coderabbit-review command の clear 判定", () => {
  const content = readCommand("coderabbit-review");

  it("gh pr checks の CodeRabbit check 名で REVIEW_CLEAR を短絡しない (unstable)", () => {
    // Step 7.5 自身が `gh pr checks` の CodeRabbit check 名を「安定しない」「DO NOT USE」
    // と明記している。監視ループで `STATUS == "pass"` による REVIEW_CLEAR 短絡は false-clear
    // を招くため、clear 判定は Step 7 の 3 段判定 (APPROVED / unresolved=0 / rate-limit marker 不在)
    // に一本化する。
    expect(content).not.toMatch(/STATUS\s*=\s*\$\(gh\s+pr\s+checks[\s\S]{0,500}?REVIEW_CLEAR/);
    expect(content).not.toMatch(/if\s+\[\s+"\$STATUS"\s*=\s*"pass"\s+\][\s\S]{0,100}?REVIEW_CLEAR/);
  });
});

describe("hook handler — Claude Code 公式 payload 使用", () => {
  // 公式: https://code.claude.com/docs/en/hooks
  // - Claude への context 注入は `additionalContext`
  // - `systemMessage` は「ユーザーに見せる warning」用で、context 注入ではない
  // - hooks.json 側の `statusMessage` は spinner 文言 (handler 定義フィールド、OK)

  const hookFiles = [
    "pre-compact.ts",
    "subagent-stop.ts",
    "stop.ts",
    "task-lifecycle.ts",
  ];

  it.each(hookFiles)("core/src/hooks/%s は context 注入に additionalContext を使う", (file) => {
    const path = resolve(PLUGIN_ROOT, "core/src/hooks", file);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/additionalContext/);
  });

  it.each(hookFiles)(
    "core/src/hooks/%s は systemMessage を Claude context 注入用に誤用しない",
    (file) => {
      const path = resolve(PLUGIN_ROOT, "core/src/hooks", file);
      const src = readFileSync(path, "utf-8");
      // context 注入目的で systemMessage を return payload に入れていないこと
      expect(src).not.toMatch(/systemMessage\s*:\s*sections/);
      expect(src).not.toMatch(/systemMessage\s*:\s*context/);
    },
  );
});

describe("--no-commit フラグの parallel 経路伝播", () => {
  // /harness-work の `--no-commit` option が /parallel-worktree / /tdd-implement まで
  // handoff chain で伝播する規約 (materialize) が明記されていること。
  it("harness-work.md が --no-commit を argv から抽出する記述を持つ", () => {
    const content = readCommand("harness-work");
    expect(content).toMatch(/--no-commit[\s\S]{0,300}?(?:NO_COMMIT|抽出|parse|for\s+tok\s+in)/);
  });

  it("harness-work.md の handoff 例で $NO_COMMIT / --no-commit を materialize する", () => {
    const content = readCommand("harness-work");
    expect(content).toMatch(
      /(?:tdd-implement|parallel-worktree)[\s\S]{0,400}?(?:\$\{?NO_COMMIT\}?|--no-commit)/,
    );
  });

  it("parallel-worktree.md が各 worktree への /tdd-implement handoff で --no-commit を forward する", () => {
    const content = readCommand("parallel-worktree");
    expect(content).toMatch(/(?:NO_COMMIT|--no-commit)[\s\S]{0,300}?(?:forward|伝播|materialize|tdd-implement)/i);
  });

  it("tdd-implement.md が --no-commit 受け取り + commit step skip 規約を持つ", () => {
    const content = readCommand("tdd-implement");
    expect(content).toMatch(/--no-commit[\s\S]{0,300}?(?:skip|抑制|スキップ|commit\s+step)/i);
  });
});

describe("Plans.md 更新責務の明示", () => {
  // coordinator (harness-work / harness-plan) 専任、leaf worktree (tdd-implement 内) は touch しない
  // という規約が各 skill に明記されていること。
  it("harness-work.md が Plans.md 更新の coordinator 専任原則を明記する", () => {
    const content = readCommand("harness-work");
    expect(content).toMatch(/Plans\.md[\s\S]{0,200}?(?:coordinator\s*専任|coordinator\s*only|leaf[\s\S]{0,40}?(?:触らない|touch\s*(?:しない|not)))/i);
  });

  it("tdd-implement.md が leaf 内での Plans.md touch 禁止を明記する", () => {
    const content = readCommand("tdd-implement");
    expect(content).toMatch(/Plans\.md[\s\S]{0,200}?(?:coordinator|leaf[\s\S]{0,40}?(?:触らない|touch))/i);
  });
});

describe("Auto Mode Detection v4.1 の依存グラフ判定実体化", () => {
  // harness-work v4 の Auto Mode Detection は「件数ベース」の判定のみ。
  // 依存グラフ / worktree ラベル判定は Phase 2 スコープであることを明示する。
  it("harness-work.md の Auto Mode Detection セクションが 件数ベース判定 + 依存グラフ未実装を明記する", () => {
    const content = readCommand("harness-work");
    // 件数ベースの判定説明 (1/2-3/4+)
    expect(content).toMatch(
      /(?:1\s*件|2[-〜～]3\s*件|4\s*件\s*以上|Solo|Parallel|Breezing)[\s\S]{0,800}?(?:件数|task\s*count)/i,
    );
    // 依存グラフ / worktree ラベル判定は Phase 2 スコープとして残件明記
    expect(content).toMatch(
      /(?:依存グラフ|dependency\s*graph|wt:|worktree\s*ラベル)[\s\S]{0,400}?(?:Phase\s*2|TODO|次セッション|未実装|spec[\s\S]{0,20}?only)/i,
    );
  });
});

describe("shell 互換: bash fail-fast guard (Codex 敵対的レビュー Major: zsh read -r -a silent fail)", () => {
  // 背景: `read -r -a` / 配列 0-based / `unset 'arr[idx]'` は bash 拡張。zsh 5.9 は
  // `emulate -L bash` でも `read -r -a` を解釈できず `bad option: -a` で failする (Codex 実測)。
  // 根本対策: BASH_VERSION を明示確認 + fail-fast で silent degrade を撲滅。
  // Claude Code の Bash tool は通常 /bin/bash を使うため実害は限定的だが保険として明示。
  const commands = [
    "harness-work",
    "tdd-implement",
    "parallel-worktree",
    "pseudo-coderabbit-loop",
  ];

  it.each(commands)(
    "%s command が BASH_VERSION 未設定時に exit 1 する fail-fast guard を持つ",
    (name) => {
      const content = readCommand(name);
      expect(content).toMatch(/-z\s+"\$\{?BASH_VERSION:?-?\}?"[\s\S]{0,300}?exit\s+1/);
    },
  );
});

describe("coderabbit-mimic agent の CODEX_COMPANION fail-fast (CodeRabbit Major: coderabbit-mimic.md:239)", () => {
  const content = readAgent("coderabbit-mimic");

  it("node \"$CODEX_COMPANION\" task 直前で空/不在チェックが入る", () => {
    // `ls ... | tail -n1` が空でもそのまま node を呼ぶと分かりにくい Node 側 error で落ちる。
    // セットアップ不足を明示的に判別できるよう事前に guard する。
    expect(content).toMatch(/-z\s+"\$CODEX_COMPANION"|!\s+-f\s+"\$CODEX_COMPANION"|command\s+-v[\s\S]{0,50}?CODEX_COMPANION/);
    // exit で止まる (silent continue しない)
    expect(content).toMatch(/CODEX_COMPANION[\s\S]{0,400}?exit\s+1/);
  });
});

describe("parallel-worktree.md の CODEX_COMPANION fail-fast (CodeRabbit Major: parallel-worktree.md:134)", () => {
  const content = readCommand("parallel-worktree");

  it("node \"$CODEX_COMPANION\" task 直前で空/不在チェックが入る", () => {
    expect(content).toMatch(/-z\s+"\$CODEX_COMPANION"|!\s+-f\s+"\$CODEX_COMPANION"|command\s+-v[\s\S]{0,50}?CODEX_COMPANION/);
    expect(content).toMatch(/CODEX_COMPANION[\s\S]{0,500}?exit\s+1/);
  });
});

describe("harness-work の CFG_PROFILE allowlist 検証 (CodeRabbit Major: harness-work.md:267)", () => {
  const content = readCommand("harness-work");

  it("jq 取得値を chill/assertive/strict の allowlist で検証している", () => {
    // CFG_PROFILE_RAW or 似た中間変数を case 文で allowlist 検証、未知値は WARN + 空に落とす。
    expect(content).toMatch(
      /CFG_PROFILE[\s\S]{0,400}?case\s+"?\$(?:CFG_PROFILE|\w+)"?\s+in[\s\S]{0,300}?chill\|assertive\|strict/,
    );
    // 未知値は WARN を出す
    expect(content).toMatch(/CFG_PROFILE[\s\S]{0,600}?WARN[\s\S]{0,200}?(?:allowlist|ignored|無視|空)/i);
  });
});

describe("harness-work の CLI --profile= 抽出が末尾 token 限定 (CodeRabbit Major: harness-work.md:252)", () => {
  const content = readCommand("harness-work");

  it("末尾 token 参照 (ARGS_TOKENS[LAST_IDX] or 同等) で profile を抽出する", () => {
    // 全 TOKENS scan だと task description 本文の `--profile=assertive` 記述を誤認する。
    // LAST_IDX / ARGS_TOKENS[-1] / 末尾 token 限定の実装であること。
    expect(content).toMatch(
      /(?:LAST_IDX\s*=|ARGS_TOKENS\[-1\]|末尾\s*token|last\s*token|末尾のみ)/i,
    );
  });

  it("末尾以外の --profile= 検出時に WARN を出す (Codex 敵対的レビュー Major: silent ignore 回帰防止)", () => {
    // 旧: 全 token scan で `--profile=assertive T-12` のような並びも拾えた。
    // 新: 末尾限定で silent ignore されると品質ゲート強度が静かに下がる。中間位置の WARN を要求。
    expect(content).toMatch(
      /for\s+i\s+in\s+"\$\{!ARGS_TOKENS\[@\]\}"[\s\S]{0,400}?--profile=\*[\s\S]{0,200}?WARN/,
    );
  });
});

describe("pseudo-coderabbit-loop の PR 番号を全数字でのみ受理する (CodeRabbit Major: pseudo-coderabbit-loop.md:98)", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it("CLI_PR 代入前に完全数字判定 (^[0-9]+$ or 同等) を行う", () => {
    // `[0-9]*` は `42abc` も match するため厳密化必須。
    // bash regex `[[ "$tok" =~ ^[0-9]+$ ]]` or 完全数字パターン限定。
    expect(content).toMatch(
      /(?:\[\[\s*"?\$tok"?\s*=~\s*\^\[0-9\]\+\$\s*\]\]|\$\{tok\/\/\[0-9\]\/\}|extglob[\s\S]{0,100}?\+\(\[0-9\]\))/,
    );
  });
});

describe("tdd-implement の PROFILE 継承 (CodeRabbit Major: tdd-implement.md:189)", () => {
  const content = readCommand("tdd-implement");

  it("PROFILE が既にセットされている場合は上書きしない (if [ -z ${PROFILE:-} ] ガード)", () => {
    // 旧: 無条件 PROFILE="chill" で upstream profile を破壊する。
    // 新: [ -z "${PROFILE:-}" ] ガード経由で fallback のみ適用。
    expect(content).toMatch(
      /\[\s+-z\s+"\$\{?PROFILE:?-?\}?"\s+\][\s\S]{0,200}?PROFILE="?chill/,
    );
  });
});

describe("tdd-implement の Phase 5.5 完了条件が言語非依存 (CodeRabbit Major: tdd-implement.md:225)", () => {
  const content = readCommand("tdd-implement");

  it("完了条件が ruff / mypy 固定ではなく test / lint / typecheck の総称で記述される", () => {
    // 旧: `全 tests pass、ruff / mypy clean` は Python 専用。
    // 新: 言語非依存 (そのプロジェクトの test/lint/typecheck) の文言を含む。
    expect(content).toMatch(/プロジェクトの\s*test[\s\S]{0,50}?lint[\s\S]{0,50}?(?:typecheck|type\s*check)/i);
  });
});

describe("scaffolder.md の文言 / layout (CodeRabbit PR #1)", () => {
  const content = readAgent("scaffolder");

  it("dispatch 文言が『参照/検証される』系に弱められている (CodeRabbit Minor: scaffolder.md:20)", () => {
    // 旧: `This agent is called from /harness-review ...` (強すぎる)
    // 新: `referenced/validated by` 等の弱い表現
    expect(content).not.toMatch(/^This agent is called from/m);
    expect(content).toMatch(/referenced\/validated|参照\/検証|referenced|validated/i);
  });

  it("scaffold mode で legacy `.claude/agents/` / `.claude/commands/` を生成対象にしない (CodeRabbit Major Outside: scaffolder.md:57-63)", () => {
    // 新 layout (plugins/harness/agents/) を scaffold 対象にする
    expect(content).toMatch(/plugins\/harness\/agents\//);
    expect(content).toMatch(/plugins\/harness\/commands\//);
    // legacy path を「生成する」ように書かれていないこと (禁止指示は OK)
    // scaffold mode セクションで `.claude/agents/` を missing files として list していないこと
    const scaffoldSection = /### scaffold mode[\s\S]*?(?=\n###\s)/.exec(content)?.[0] ?? "";
    expect(scaffoldSection).not.toMatch(/^\s*-\s*`\.claude\/agents\//m);
    expect(scaffoldSection).not.toMatch(/^\s*-\s*`\.claude\/commands\//m);
  });
});

describe("worker.md の commit prefix / build 検証整合 (CodeRabbit PR #1)", () => {
  const content = readAgent("worker");

  it("prefix 一覧から `security` を独立 prefix として掲載しない (CodeRabbit Minor: worker.md:125)", () => {
    // Conventional Commits 準拠 + repo 規約と整合。
    // `security` を列挙リストに含めると repo の commit message 規約から外れる。
    const prefixLine = /prefix:\s*(?:`[^`]+`\s*\/?\s*)+/.exec(content)?.[0] ?? "";
    // security を独立 prefix として掲載していない
    expect(prefixLine).not.toMatch(/\/\s*`security`/);
    // 推奨 prefix 列挙に perf / build / ci / style / revert を含む
    expect(content).toMatch(/`perf`/);
    expect(content).toMatch(/`build`/);
    expect(content).toMatch(/`ci`/);
  });

  it("build 検証コマンドが stop-hook (subagent-stop.ts) の stack-neutral default と整合する", () => {
    // worker.md は `tooling.pythonCandidateDirs` (default `["src", "app"]`)
    // を介して Python lint target が決まることを示していること。
    // subagent-stop.ts の detectAvailableChecks 実装と同じロジックを提示する。
    expect(content).toMatch(/tooling\.pythonCandidateDirs/);
    expect(content).toMatch(/\["src",\s*"app"\]/);
  });
});

describe("harness-review.md の code fence language tag (CodeRabbit Nitpick: harness-review.md:252)", () => {
  const content = readCommand("harness-review");

  it("ディレクトリツリー fenced code block が language tag を持つ", () => {
    // markdownlint MD040: language-less code fence を避ける
    expect(content).toMatch(/```text[\s\S]{0,300}?plugins\/harness\//);
  });
});

describe("pre-compact.ts の custom_instructions 転載 (CodeRabbit Major: pre-compact.ts:131)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/hooks/pre-compact.ts"),
    "utf-8",
  );

  it("input.custom_instructions を sections に push している", () => {
    expect(src).toMatch(/input\.custom_instructions[\s\S]{0,200}?(?:sections\.push|additionalContext)/);
  });

  it("空文字列 / 空白のみは section に出さない (trim 判定)", () => {
    expect(src).toMatch(/custom_instructions[\s\S]{0,80}?\.trim\(\)|\.trim\(\)[\s\S]{0,80}?custom_instructions/);
  });
});

describe("subagent-stop.ts の Python lint target 解決 (stack-neutral default + config override)", () => {
  // Note on regex assertions in this describe block: the expectations below
  // verify the **presence** of substrings (function names, specific regex
  // literals, stderr patterns) in the source file. They do NOT exercise
  // runtime behavior — that is covered by `hooks.test.ts` through a real
  // filesystem + mocked execSync. If a future refactor renames a helper
  // without changing observable behavior, these assertions may need
  // updating even though no actual regression occurred.
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/hooks/subagent-stop.ts"),
    "utf-8",
  );

  it("loadConfigWithError 経由で tooling.pythonCandidateDirs を解決 (旧 loadConfigSafe からの移行)", () => {
    // 旧: hardcode `PYTHON_CANDIDATE_DIRS = ["backend", "src", "app"]`
    // 中間: loadConfigSafe (silent swallow)
    // 新: loadConfigWithError で parse エラーを surface できる
    expect(src).toMatch(/loadConfigWithError/);
    expect(src).toMatch(/pythonCandidateDirs/);
  });

  it("shell-injection ガード: SAFE_DIR_NAME_REGEX で allowlist validation", () => {
    // dir name が shell command template に埋め込まれる前に、
    // allowlist regex `/^[a-zA-Z0-9_.-]+$/` で sanitize される。
    expect(src).toMatch(/SAFE_DIR_NAME_REGEX/);
    expect(src).toMatch(/\^\[a-zA-Z0-9_\.-\]\+\$/);
  });

  it("shape-invalid config では default (['src', 'app']) にフォールバック (fail-open)", () => {
    // fail-open 方針: config 壊れていても throw せず default。
    expect(src).toMatch(/Array\.isArray\(/);
    // fallback default が plugin 内に inline で書かれていること
    expect(src).toMatch(/\["src",\s*"app"\]/);
  });

  it("shape-invalid / catch ブランチで stderr warning を emit する (silent fallback 禁止)", () => {
    // `stop.ts` と一貫した挙動: default に落ちる理由を ops log に残す
    expect(src).toMatch(
      /process\.stderr\.write\([^)]*tooling\.pythonCandidateDirs/,
    );
  });

  it("候補 dir が 1 つも無い場合は ruff/mypy を skip する", () => {
    expect(src).toMatch(/pyTargets\.length\s*>\s*0/);
  });

  it("detectAvailableChecks を export している (test 可能性)", () => {
    expect(src).toMatch(/export\s+function\s+detectAvailableChecks/);
  });
});

describe("stop.ts が loadConfigWithError を使い config-parse エラーを surface する", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/hooks/stop.ts"),
    "utf-8",
  );

  it("loadConfigWithError を import + 呼出し (直接 JSON.parse / manual cast 禁止)", () => {
    // 旧: readFileSync + JSON.parse + 手動 cast (partial override で
    // 未指定 gate が false 扱いになる bug)
    // 中間: loadConfigSafe — default 継承は OK だが broken config を
    // silently default 化する問題あり
    // 新: loadConfigWithError で error を判別し、broken config 時は
    // quality-gate reminder を suppress (silent-swallow 回避)
    expect(src).toMatch(/loadConfigWithError/);
    expect(src).not.toMatch(/JSON\.parse/);
  });

  it("config parse エラー時は reminder を suppress して stderr 警告を emit", () => {
    expect(src).toMatch(/outcome\.error\s*!==\s*undefined/);
    expect(src).toMatch(
      /process\.stderr\.write\([^)]*harness\.config\.json parse failed/,
    );
    // エラー経路で reminder を suppress (return early に decision=approve のみ)
    expect(src).toMatch(/outcome\.error[\s\S]{0,800}?return\s*\{\s*decision:\s*"approve"\s*\}/);
  });

  it("qualityGates の 4 reminder すべてを switch していること", () => {
    expect(src).toMatch(/enforceTddImplement/);
    expect(src).toMatch(/enforcePseudoCoderabbit/);
    expect(src).toMatch(/enforceRealCoderabbit/);
    expect(src).toMatch(/enforceCodexSecondOpinion/);
  });

  it("harness.config.json 不在の場合は early-return で additionalContext を出さない (opt-in 設計)", () => {
    expect(src).toMatch(/existsSync\(configPath\)[\s\S]{0,80}?return\s*\{\s*decision:\s*"approve"\s*\}/);
  });
});

describe("index.ts の fail-safe 契約 (errorToResult export)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/index.ts"),
    "utf-8",
  );

  it("errorToResult を export している (test 可能性 + 契約明示)", () => {
    expect(src).toMatch(/export\s+function\s+errorToResult/);
  });

  it("main() が route() を try/catch で包み errorToResult に flow する", () => {
    expect(src).toMatch(/try[\s\S]{0,1000}?catch[\s\S]{0,50}?errorToResult/);
  });

  it("errorToResult が decision=approve を返す (fail-open 契約)", () => {
    expect(src).toMatch(/decision:\s*"approve"/);
    expect(src).toMatch(/Core engine error \(safe fallback\)/);
  });
});

describe("config.ts runtime enum validation (release.strategy / tddEnforce.pseudoCoderabbitProfile)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/config.ts"),
    "utf-8",
  );

  it("mergeConfig 経由で validateTddEnforce / validateRelease が呼ばれる", () => {
    expect(src).toMatch(/validateTddEnforce\(/);
    expect(src).toMatch(/validateRelease\(/);
  });

  it("非 enum 値は default へフォールバックし stderr に warn を出す", () => {
    expect(src).toMatch(/VALID_CODERABBIT_PROFILES/);
    expect(src).toMatch(/VALID_RELEASE_STRATEGIES/);
    expect(src).toMatch(
      /process\.stderr\.write\([^)]*tddEnforce\.pseudoCoderabbitProfile/,
    );
    expect(src).toMatch(
      /process\.stderr\.write\([^)]*release\.strategy/,
    );
  });

  it("loadConfig が JSON object 以外 (primitive / array) を明示的に reject する", () => {
    expect(src).toMatch(/harness\.config\.json must be a JSON object/);
  });
});

describe("stop.ts の enforceRealCoderabbit 対応 (CodeRabbit Major: stop.ts:56)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/hooks/stop.ts"),
    "utf-8",
  );

  it("enforceRealCoderabbit フラグの reminder を出す", () => {
    expect(src).toMatch(/enforceRealCoderabbit[\s\S]{0,150}?reminders\.push/);
  });
});

describe("harness.config.schema.json の work / qualityGates 対応 (CodeRabbit Major: stop.ts:56 schema 整合)", () => {
  const schemaSrc = readFileSync(
    resolve(PLUGIN_ROOT, "schemas/harness.config.schema.json"),
    "utf-8",
  );
  const schema = JSON.parse(schemaSrc) as {
    additionalProperties: boolean;
    properties: Record<string, { properties?: Record<string, unknown> }>;
  };

  it("work / worktree / tddEnforce / codeRabbit が properties に定義されている", () => {
    const props = schema.properties;
    expect(props).toHaveProperty("work");
    expect(props).toHaveProperty("worktree");
    expect(props).toHaveProperty("tddEnforce");
    expect(props).toHaveProperty("codeRabbit");
  });

  it("work.qualityGates に 4 つの enforce* フラグが定義されている", () => {
    const gates = (
      schema.properties.work?.properties as Record<string, { properties?: Record<string, unknown> }>
    )?.qualityGates?.properties;
    expect(gates).toBeDefined();
    expect(gates).toHaveProperty("enforceTddImplement");
    expect(gates).toHaveProperty("enforcePseudoCoderabbit");
    expect(gates).toHaveProperty("enforceRealCoderabbit");
    expect(gates).toHaveProperty("enforceCodexSecondOpinion");
  });

  it("tddEnforce.pseudoCoderabbitProfile は chill/assertive/strict のみ許可", () => {
    const prof = (
      schema.properties.tddEnforce?.properties as Record<string, { enum?: string[] }>
    )?.pseudoCoderabbitProfile;
    expect(prof?.enum).toEqual(["chill", "assertive", "strict"]);
  });

  it("additionalProperties: false を維持 (dead field 侵入防止)", () => {
    expect(schema.additionalProperties).toBe(false);
  });
});

describe(".gitattributes で改行コードが LF 固定 (PR #1 Windows CI 再発防止)", () => {
  const gaPath = resolve(PLUGIN_ROOT, "..", "..", ".gitattributes");
  const content = readFileSync(gaPath, "utf-8");

  it("text 系ファイルを eol=lf で固定する", () => {
    expect(content).toMatch(/\*\s+text=auto\s+eol=lf|text\s+eol=lf/);
  });

  it("binary ファイル列挙がある (png/jpg 等)", () => {
    expect(content).toMatch(/\*\.png\s+binary/);
  });
});

describe("severity 分類の整合", () => {
  const mimic = readAgent("coderabbit-mimic");
  const auditor = readAgent("security-auditor");

  // CodeRabbit 公式 taxonomy は 5 段階。trivial を必須化して 4 段階退行を検知可能にする
  // (Codex 過去の敵対的レビュー指摘対応、CHANGELOG.md 参照)。
  const requiredLevels = ["critical", "major", "minor", "trivial", "info"];

  it.each(requiredLevels)(
    "coderabbit-mimic の severity に '%s' が含まれる",
    (level) => {
      expect(mimic.toLowerCase()).toContain(level);
    },
  );

  it.each(requiredLevels)(
    "security-auditor の severity / 発見事項レベルに '%s' が含まれる",
    (level) => {
      expect(auditor.toLowerCase()).toContain(level);
    },
  );

  it("security-auditor が 5 区分 (critical/major/minor/trivial/info) 全てを参照する", () => {
    const normalized = auditor.toLowerCase();
    const hits = requiredLevels.filter((lvl) => normalized.includes(lvl));
    expect(hits).toEqual(requiredLevels);
  });
});

describe("plugin.json component 宣言 (Anthropic 公式仕様: 明示宣言でデフォルトパス変更耐性)", () => {
  // Golden lists — provide a second source of truth so that a developer
  // removing a shipped command or agent without updating plugin.json
  // still fails the test (filesystem auto-discovery alone cannot catch
  // symmetric deletions from both fs and manifest).
  const EXPECTED_COMMANDS = [
    "branch-merge",
    "coderabbit-review",
    "codex-team",
    "harness-plan",
    "harness-release",
    "harness-review",
    "harness-setup",
    "harness-work",
    "new-feature-branch",
    "parallel-worktree",
    "pseudo-coderabbit-loop",
    "session-handoff",
    "tdd-implement",
  ];
  const EXPECTED_AGENTS = [
    "coderabbit-mimic",
    "codex-sync",
    "reviewer",
    "scaffolder",
    "security-auditor",
    "worker",
  ];

  const pluginJson = JSON.parse(
    readFileSync(
      resolve(PLUGIN_ROOT, ".claude-plugin/plugin.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;

  it("commands 配列で全 command md を explicit に宣言している", () => {
    const rawCommands = pluginJson["commands"];
    if (!Array.isArray(rawCommands)) {
      throw new Error(`plugin.json.commands must be an array (got ${typeof rawCommands})`);
    }
    // Runtime narrow to string[] rather than `as string[]`; a non-string
    // entry (e.g. 42, true, null) would slip through the cast and crash
    // `.map()` silently without this guard.
    const commands: string[] = rawCommands.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    expect(commands.length).toBe(rawCommands.length); // 全要素が string
    // 実在する commands/*.md が全て宣言され、かつ EXPECTED_COMMANDS とも一致。
    const declaredBaseNames = commands
      .map((p) => p.replace(/^\.\/commands\//, "").replace(/\.md$/, ""))
      .sort();
    expect(declaredBaseNames).toEqual(EXPECTED_COMMANDS.slice().sort());
    // 補助 check: filesystem 走査結果とも一致 (どちらかが古くなっていないか)。
    expect(declaredBaseNames).toEqual(COMMAND_NAMES.slice().sort());
  });

  it("agents 配列で全 agent md を explicit に宣言している", () => {
    const rawAgents = pluginJson["agents"];
    if (!Array.isArray(rawAgents)) {
      throw new Error(`plugin.json.agents must be an array (got ${typeof rawAgents})`);
    }
    const agents: string[] = rawAgents.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    expect(agents.length).toBe(rawAgents.length);
    const declaredBaseNames = agents
      .map((p) => p.replace(/^\.\/agents\//, "").replace(/\.md$/, ""))
      .sort();
    expect(declaredBaseNames).toEqual(EXPECTED_AGENTS.slice().sort());
    expect(declaredBaseNames).toEqual(AGENT_NAMES.slice().sort());
  });

  it("hooks フィールドで hooks.json を指している", () => {
    expect(pluginJson["hooks"]).toBe("./hooks/hooks.json");
  });

  it("必須の name が存在する", () => {
    expect(typeof pluginJson["name"]).toBe("string");
    expect(pluginJson["name"]).toBe("harness");
  });
});

describe("marketplace.json のクロスマーケットプレイス依存宣言 (forward-compatible declaration)", () => {
  // Note on `allowCrossMarketplaceDependenciesOn`: this field name is listed
  // in the plugin/marketplace docs scrape done in
  // `docs/maintainer/research-plugin-best-practice-2026-04-22.md` §1.2 as a
  // marketplace.json option. However, upstream loader behavior has not been
  // empirically confirmed. We assert its presence here as a forward-compatible
  // declaration of intent (`codex-sync` / `coderabbit-mimic` invoke the
  // companion Codex plugin, and users should see that relationship in the
  // manifest). JSON silently ignores unknown fields, so the declaration is
  // harmless if the loader does not read it today. If upstream renames or
  // removes this field, update both the marketplace.json declaration and
  // the assertion below in lock-step.
  const marketplaceJson = JSON.parse(
    readFileSync(
      resolve(PLUGIN_ROOT, "../../.claude-plugin/marketplace.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;

  it("openai-codex を cross-marketplace dep allowlist に forward-compat 宣言", () => {
    const allow = marketplaceJson["allowCrossMarketplaceDependenciesOn"];
    expect(Array.isArray(allow)).toBe(true);
    expect(allow).toContain("openai-codex");
  });

  it("metadata.version が plugin.version と一致する", () => {
    const rawMetadata = marketplaceJson["metadata"];
    const rawPlugins = marketplaceJson["plugins"];
    if (typeof rawMetadata !== "object" || rawMetadata === null || Array.isArray(rawMetadata)) {
      throw new Error(`marketplace.json.metadata must be an object (got ${typeof rawMetadata})`);
    }
    if (!Array.isArray(rawPlugins)) {
      throw new Error(`marketplace.json.plugins must be an array (got ${typeof rawPlugins})`);
    }
    const metadata = rawMetadata as Record<string, unknown>;
    const plugins = rawPlugins as Array<Record<string, unknown>>;
    const harnessPlugin = plugins.find((p) => p["name"] === "harness");
    expect(metadata["version"]).toBe(harnessPlugin?.["version"]);
  });

  it("strict: true を明示 (plugin.json 権威)", () => {
    expect(marketplaceJson["strict"]).toBe(true);
  });
});

describe("install-project.sh — Codex companion opt-in (Phase ζ)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "../..", "scripts/install-project.sh"),
    "utf-8",
  );

  it("`--with-codex` flag の help 記述が存在", () => {
    expect(src).toMatch(/--with-codex/);
    expect(src).toMatch(/opt-in/i);
  });

  it("default で codex plugin を install しない (opt-in without flag)", () => {
    // WITH_CODEX=0 default が存在し、条件分岐で codex install を gate している
    expect(src).toMatch(/WITH_CODEX=0/);
    expect(src).toMatch(/if\s*\[\s*"\$\{WITH_CODEX\}"\s*-eq\s*1\s*\]/);
  });

  it("codex plugin の install をスキップしたら user に explicit な note を出す", () => {
    expect(src).toMatch(/codex@openai-codex was NOT installed/);
  });

  it("doctor 実行を次ステップとして案内", () => {
    expect(src).toMatch(/harness doctor/);
  });
});

describe("harness doctor — Global vs Local overlays visibility (Phase ζ)", () => {
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "bin/harness"),
    "utf-8",
  );

  it("Codex 検出出力が、任意のディレクトリから実行可能な install コマンドを含む (not installed 時)", () => {
    expect(src).toMatch(/codex plugin:\s*(?:detected|not installed)/);
    // Hint must be runnable from any directory (not a relative path).
    // Previous hint `bash install-project.sh --with-codex` was relative and
    // would fail from a user's project root; the fully-qualified
    // `claude plugin install codex@openai-codex --scope project` works
    // regardless of cwd.
    expect(src).toMatch(/claude plugin install codex@openai-codex --scope project/);
  });

  it("harness.config.json の projectChecklistPath 解決結果を表示する", () => {
    expect(src).toMatch(/projectChecklistPath/);
    expect(src).toMatch(/project security checklist/);
  });

  it("Plans.md / handoff ファイル の到達可能性を表示する", () => {
    expect(src).toMatch(/plansFile/);
    expect(src).toMatch(/handoffFiles/);
  });

  it("user-level overlay の有無 (global skills / commands / agents) を表示する", () => {
    expect(src).toMatch(/user overlays:/);
    expect(src).toMatch(/skills=/);
    expect(src).toMatch(/commands=/);
    expect(src).toMatch(/agents=/);
  });

  it("project-local skill dir (.claude/skills) の検出を表示する", () => {
    expect(src).toMatch(/project skill dir:/);
  });
});

// ─────────────────────────────────────────────────────────────
// subagent frontmatter の isolation 設定 regression guard
// ─────────────────────────────────────────────────────────────
// 公式 docs 調査結果 (docs/maintainer/research-subagent-isolation-2026-04-22.md):
// - 公式仕様 (plugins-reference): isolation の値は "worktree" のみ (他は invalid)
// - 省略時: メイン会話のカレントワーキングディレクトリで動作
// - Plugin 同梱 subagent で isolation はサポート (ignored は hooks / mcpServers / permissionMode のみ)
//
// 現行方針: 全 agent に isolation を付けない
// 根拠:
//  1. `/parallel-worktree` が手動で git worktree を作成する既存設計
//  2. worker 等に isolation: worktree を付けると、`/parallel-worktree` の worktree 内で
//     さらに子 worktree が作られ、二重 worktree 干渉リスクがある
//  3. 安全に isolation: worktree へ移行するには WorktreeCreate / WorktreeRemove hook との
//     協調設計が必要 (後続で対応予定)
//
// 本 describe は 2 層の regression guard:
//  - (a) 現状方針 (全 agent に isolation 未設定) から逸脱しようとしたら red → 設計判断を強制
//  - (b) isolation が将来追加された際、値が公式仕様外 ("none" / "disabled" 等) なら red
//
// 設計経緯・版数追跡は CHANGELOG.md / docs/maintainer/ROADMAP-model-b.md を参照。
describe("subagent frontmatter の isolation 設定 regression guard", () => {
  it.each(AGENT_NAMES)(
    "%s agent: isolation フィールドが現在設定されていない (現状方針)",
    (name) => {
      // 将来 isolation: worktree を付ける場合は /parallel-worktree との整合確認が必須。
      // 詳細: docs/maintainer/research-subagent-isolation-2026-04-22.md
      const fm = extractFrontmatter(readAgent(name));
      expect(fm).not.toMatch(/^isolation\s*:/m);
    },
  );

  it.each(AGENT_NAMES)(
    '%s agent: isolation 設定があれば値は "worktree" のみ (公式仕様: plugins-reference)',
    (name) => {
      // 公式仕様外の値 ("none" / "disabled" / "never" 等) は invalid。
      // これは deferred guard: 第 1 test (isolation 未設定) が pass している間は
      // `match` が null となり assert は no-op (実行されない)。将来 isolation が
      // 追加された時点で第 1 test が red に転じると同時に本 guard が値 validation
      // として effective になる設計。
      // YAML inline comment `isolation: worktree # note` 形式にも対応するよう末尾
      // `(?:\s+#.*)?` を含め、値 scalar のみ capture する。
      const fm = extractFrontmatter(readAgent(name));
      const match = /^isolation\s*:\s*["']?([\w-]+)["']?(?:\s+#.*)?\s*$/m.exec(fm);
      if (match) {
        expect(match[1]).toBe("worktree");
      }
    },
  );
});

// ============================================================
// WorktreeCreate / WorktreeRemove hook 登録 invariant
//
// 公式仕様 (https://code.claude.com/docs/en/hooks):
//  - WorktreeRemove: non-blocking observability。失敗は debug-only。
//  - WorktreeCreate: 既定 git worktree 作成処理を「完全置換」する blocking hook。
//                    Command hook は raw absolute path を stdout に書き出す。
//                    HTTP hook は `hookSpecificOutput.worktreePath` で JSON return。
//                    exit 0 = 成功、any non-zero = worktree 作成失敗 (blocking)。
//
// 現行の判断:
//  - WorktreeRemove は hooks.json に登録 (観測 + coordinator リマインダー)。
//  - WorktreeCreate は blocking protocol 準拠 production 実装として hooks.json 登録:
//    * handler が実 `git worktree add` を実行し worktreePath を返す
//    * main() は worktree-create 分岐で worktreePath を raw stdout に書く
//    * timeout 120s (git worktree add + fetch まで余裕を持たせる)
//  - agent frontmatter `isolation: worktree` 付与は保留中
//    (`/parallel-worktree` 手動管理と二重 worktree 干渉リスク回避、別 describe で guard)
//
// 設計経緯と版数追跡は CHANGELOG.md および docs/maintainer/ROADMAP-model-b.md を参照。
// ============================================================
describe("WorktreeCreate / WorktreeRemove hook 登録 invariant", () => {
  const hooksJsonPath = resolve(PLUGIN_ROOT, "hooks/hooks.json");
  const worktreeLifecyclePath = resolve(
    PLUGIN_ROOT,
    "core/src/hooks/worktree-lifecycle.ts",
  );

  it("hooks.json は WorktreeRemove を登録する (non-blocking observability, timeout 10s)", () => {
    const raw = readFileSync(hooksJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{ hooks: Array<{ command?: string; timeout?: number }> }>
      >;
    };
    expect(parsed.hooks).toHaveProperty("WorktreeRemove");
    const entry = parsed.hooks["WorktreeRemove"];
    expect(Array.isArray(entry)).toBe(true);
    expect(entry?.length).toBeGreaterThan(0);
    expect(entry?.[0]?.hooks?.[0]?.command).toContain("worktree-remove");
    // CodeRabbit PR #3 nitpick: `timeout: 10` は設計の一部 (non-blocking observability で
    // 長時間 block させない意図)。30 / 120 等にドリフトしたら fail させる。
    expect(entry?.[0]?.hooks?.[0]?.timeout).toBe(10);
  });

  it("hooks.json は WorktreeCreate を登録する (blocking protocol, timeout 120s)", () => {
    // 公式仕様準拠の blocking hook として登録。timeout 120s の根拠:
    //   - 大規模 repo (10GB+ / 数十万 object) の local `git worktree add` は
    //     チェックアウト自体に数十秒かかることがある (filesystem copy + index 展開)。
    //   - `git worktree list --porcelain` の parse + retry 経路で最大 2 回 git 呼出。
    //   - `realpathSync` / `execFileSync` overhead を含め、worst-case に 60-90s 程度。
    //   - 公式仕様「any non-zero exit causes creation to fail」の性質上、timeout が
    //     短すぎると hook が途中停止→worktree 作成が false-fail する。
    //   - 長すぎると Claude Code session の responsiveness に影響するため、
    //     SubagentStop (120s) と揃えた 120s を安全上限とする。
    // 本 hook は **net 操作を行わない** (`fetch`/`push` 未実行)、純粋 local operation。
    const raw = readFileSync(hooksJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{ hooks: Array<{ command?: string; timeout?: number }> }>
      >;
    };
    expect(parsed.hooks).toHaveProperty("WorktreeCreate");
    const entry = parsed.hooks["WorktreeCreate"];
    expect(Array.isArray(entry)).toBe(true);
    expect(entry?.length).toBeGreaterThan(0);
    expect(entry?.[0]?.hooks?.[0]?.command).toContain("worktree-create");
    expect(entry?.[0]?.hooks?.[0]?.timeout).toBe(120);
  });

  it("worktree-lifecycle.ts が handleWorktreeRemove / handleWorktreeCreate を export する", () => {
    const src = readFileSync(worktreeLifecyclePath, "utf-8");
    expect(src).toMatch(/export\s+async\s+function\s+handleWorktreeRemove/);
    expect(src).toMatch(/export\s+async\s+function\s+handleWorktreeCreate/);
  });

  it("worktree-lifecycle.ts は context 注入に additionalContext を使う", () => {
    const src = readFileSync(worktreeLifecyclePath, "utf-8");
    expect(src).toMatch(/additionalContext/);
    expect(src).not.toMatch(/systemMessage\s*:\s*sections/);
    expect(src).not.toMatch(/systemMessage\s*:\s*context/);
  });

  it("worktree-lifecycle.ts の WorktreeCreate は blocking protocol 準拠 production 記述であること", () => {
    // production 実装であることを明示する guard:
    //   (a) blocking / exit / non-zero の意図説明があること (公式仕様準拠の理由付け)
    //   (b) `git worktree add` (実コマンド) / worktreePath (公式 output 名) の参照があること
    //   (c) `scaffold ... deferred` や `deferred ... scaffold` の組が復活しないこと
    //       (production 化後に scaffold 状態に退行するのを防ぐ regression guard)
    //
    // ファイル全体ではなく `handleWorktreeCreate` 周辺 (関数の上コメントブロック +
    // 関数本体) に限定して regex を適用し、将来同ファイルで別 scaffold handler が
    // 追加されても false positive を招かないようにする。
    const src = readFileSync(worktreeLifecyclePath, "utf-8");
    const handleWorktreeCreateIdx = src.indexOf(
      "export async function handleWorktreeCreate",
    );
    expect(handleWorktreeCreateIdx).toBeGreaterThan(-1);
    const scopeStart = Math.max(0, handleWorktreeCreateIdx - 2000);
    const nextExportIdx = src.indexOf(
      "export async function",
      handleWorktreeCreateIdx + 10,
    );
    const scopeEnd = nextExportIdx === -1 ? src.length : nextExportIdx;
    const scopedSrc = src.slice(scopeStart, scopeEnd);

    // (a) blocking protocol の意図説明: blocking / exit / non-zero / worktreePath のいずれか
    const blockingSignal =
      /blocking|exit[^\n]{0,40}non-zero|non-zero[^\n]{0,40}exit|worktreePath/i;
    expect(blockingSignal.test(scopedSrc)).toBe(true);

    // (b) 実 git worktree add を呼ぶ記述があること
    expect(scopedSrc).toMatch(/git\s+worktree\s+add/i);

    // (c) `scaffold ... deferred` の組 (production 退行の典型パターン) が残って
    //     いないこと。個別の "deferred" 単語は isolation 繰延べ文脈で再利用可能なので
    //     近傍 80 文字以内で "scaffold" と "deferred" が組で現れるケースのみ red。
    expect(scopedSrc).not.toMatch(
      /scaffold[\s\S]{0,80}?deferred|deferred[\s\S]{0,80}?scaffold/i,
    );
  });
});

// ============================================================
// session-handoff skill: 引き継ぎ doc 構造化ベストプラクティスを
// shipped plugin として提供する skill の existence + structure guard
//
// 公式推奨 (research-anthropic-official 調査 § 2 + 追補):
//  - SKILL-style overview + topic files pattern (MEMORY.md index + detail files)
//  - Skill 本体は 500 lines 未満
//  - @import は lazy load ではなく展開される → 鳥瞰図に大量 import は NG
//  - description / description-ja / allowed-tools / argument-hint frontmatter
// ============================================================
describe("session-handoff skill (shipped plugin 汎用 handoff skill)", () => {
  const skillPath = resolve(PLUGIN_ROOT, "commands/session-handoff.md");
  const readSkill = (): string => readFileSync(skillPath, "utf-8");

  it("commands/session-handoff.md が存在する", () => {
    expect(() => readSkill()).not.toThrow();
  });

  it("frontmatter が公式推奨 4 フィールド (name / description / description-ja / allowed-tools) を含む", () => {
    const fm = extractFrontmatter(readSkill());
    expect(fm).toMatch(/^name:\s*session-handoff\s*$/m);
    expect(fm).toMatch(/^description:\s*"/m);
    expect(fm).toMatch(/^description-ja:\s*"/m);
    expect(fm).toMatch(/^allowed-tools:/m);
  });

  it("argument-hint に subcommand 候補を厳密な [word|word|word] 形式で列挙している", () => {
    const fm = extractFrontmatter(readSkill());
    // Codex review 対応 (A-02): 値全体が `[word|word|...]` 形式であることを強制
    // (過度に緩い `.*\[.*\|.*\].*` では `"free text [foo| ] bar"` も pass してしまう)
    expect(fm).toMatch(/^argument-hint:\s*"\[[\w-]+(?:\|[\w-]+)+\]"$/m);
  });

  it("本体 500 行未満 (Anthropic 公式 SKILL.md 目安)", () => {
    const lines = readSkill().split("\n").length;
    expect(lines).toBeLessThan(500);
  });

  it("generic placeholder (<project> or <name>) を含む (汎用化)", () => {
    const body = readSkill();
    // project-agnostic template であることを強制 — 特定 project 名の埋め込みを防ぐ
    expect(body).toMatch(/<project[-\s]?name>|<project>|\$\{project\}/i);
  });

  it("必須 file 構造 (current / backlog / design-decisions / archive) を明示する", () => {
    const body = readSkill();
    // layout template で 4 種類の file 役割を明示している
    expect(body).toMatch(/current\.md/);
    expect(body).toMatch(/backlog\.md/);
    expect(body).toMatch(/design-decisions\.md|decisions\.md/);
    expect(body).toMatch(/archive/i);
  });

  it("update triggers (セッション終了時 / Phase 完了時 等) を記述する", () => {
    const body = readSkill();
    // update timing 節が存在することを保証
    expect(body).toMatch(/update\s*trigger|更新タイミング|update\s*timing/i);
  });

  it("anti-pattern 警告を含む (monolithic / shared ephemeral 等)", () => {
    const body = readSkill();
    expect(body).toMatch(/anti[-\s]?pattern|アンチパターン|禁止|warn/i);
  });

  it("Anthropic 公式 reference (memory / SKILL.md pattern) を引用する", () => {
    const body = readSkill();
    // Anthropic 公式 pattern (`MEMORY.md` / auto memory / SKILL.md) のいずれかを参照
    expect(body).toMatch(/MEMORY\.md|auto[-\s]?memory|SKILL\.md|code\.claude\.com|docs\.anthropic\.com/);
  });

  it("description-ja は日本語であり命令文である (Anthropic slash command 命名公式)", () => {
    const fm = extractFrontmatter(readSkill());
    const match = fm.match(/^description-ja:\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    const desc = match?.[1] ?? "";
    // 日本語文字 (hiragana/katakana/kanji) を含む
    expect(desc).toMatch(/[぀-ゟ゠-ヿ一-鿿]/);
  });
});

// ============================================================
// session-handoff check v2: structural + content comprehension + synthesis
// の 3 gate アーキテクチャを regression guard 化する。
// Anthropic 公式 orient-phase 調査 + 3 機能設計 review の合意仕様に準拠。
// 契機: skill 利用者から「check は把握 / 理解もかねていますか」の指摘、
// これを受けて check v1 (structural のみ) → v2 (3-gate) に拡張した。
// ============================================================
describe("session-handoff skill — check v2 3 機能 (Structural / Content / Synthesis) 拡張", () => {
  const skillPath = resolve(PLUGIN_ROOT, "commands/session-handoff.md");
  const readSkill = (): string => readFileSync(skillPath, "utf-8");
  const checkSection = (): string => {
    const body = readSkill();
    // `### \`check\`` から次の H3 (`^### ` + 非 `#` の文字) または H2 (`^## `) まで。
    // H4 (`#### `) は `###` の prefix を持つため、次の char が `#` の場合は H4/H5 と判断し
    // 停止しない (lookahead 内で `[^#]` を要求)。
    const m = body.match(/### `check`[\s\S]*?(?=\n(?:###\s+[^#\s]|##\s+[^#\s])|$)/);
    return m?.[0] ?? "";
  };

  it("check セクションが存在し 3 機能を明示している (Structural / Content / Synthesis 相当のキーワードを含む)", () => {
    const sec = checkSection();
    expect(sec.length).toBeGreaterThan(200); // 旧 5 項目だけでなく拡張済
    // 3 gate 明示 (英語 or 日本語いずれか許容)
    expect(sec).toMatch(/structural|構造/i);
    expect(sec).toMatch(/content|comprehension|把握|理解|内容/i);
    expect(sec).toMatch(/synthesis|rehydration|再現|再水和|起動判定|再着手/i);
  });

  it("check セクションが Read tool 使用を明示する (content comprehension で handoff file を読む)", () => {
    const sec = checkSection();
    // skill が実行時に current.md / backlog.md を Read することを明示
    expect(sec).toMatch(/Read|読み込/i);
    expect(sec).toMatch(/current\.md/);
    expect(sec).toMatch(/backlog\.md/);
  });

  it("check セクションが陳腐化 signal を明示列挙する (S-01 形式 or 同等の staleness indicator)", () => {
    const sec = checkSection();
    // 少なくとも 6 種以上の staleness signal を明示
    const stalenessKeywords =
      sec.match(/(?:stale|陳腐|drift|outdated|signal|S-\d+|staleness)/gi) ?? [];
    expect(stalenessKeywords.length).toBeGreaterThanOrEqual(6);
    // 具体的 signal topic をカバー (branch / commit / date / backlog / pointer のいずれか複数)
    const topicCoverage = [
      /branch/i,
      /commit|hash/i,
      /date|日付|更新/i,
      /backlog|pending/i,
      /pointer|link|参照|path/i,
    ].filter((re) => re.test(sec)).length;
    expect(topicCoverage).toBeGreaterThanOrEqual(4);
  });

  it("check セクションが rehydration verdict の 3 段階評価 (PASS/WARN/FAIL or Ready/Partial/Stale) を示す", () => {
    const sec = checkSection();
    // 3-level verdict: PASS/WARN/FAIL or Ready/Partial/Stale 等
    const hasThreeLevel =
      /PASS[\s\S]{0,100}WARN[\s\S]{0,100}FAIL/i.test(sec) ||
      /Ready[\s\S]{0,100}Partial[\s\S]{0,100}Stale/i.test(sec) ||
      /合格[\s\S]{0,100}警告[\s\S]{0,100}失敗/.test(sec);
    expect(hasThreeLevel).toBe(true);
  });

  it("check セクションが output template (code block) を提示する", () => {
    const sec = checkSection();
    // markdown code fence within the section
    expect(sec).toMatch(/```[\s\S]{50,}?```/);
  });

  it("check セクションが禁止事項 (read-only、write 禁止) を明示する", () => {
    const sec = checkSection();
    // 破壊的操作禁止を明示 (edit/commit/push/delete いずれかに該当する禁止表現)
    expect(sec).toMatch(
      /read[-\s]?only|書き換え|破壊|禁止|forbidden|must not|not modify|must NOT|delete|commit/i,
    );
  });

  it("check セクションが edge case (初回使用 と git 不可 の両方) を明示する", () => {
    const sec = checkSection();
    // CodeRabbit review 対応: 旧 OR 条件は片側欠落で誤通過するため AND に強化。
    // first-time use (未初期化) と git unavailable (CI/shallow clone) は独立した
    // edge case で、両方の対応記述が必要。
    const hasFirstTime =
      /first[-\s]?time|初回|未初期化|init[- ]?required|not yet/i.test(sec);
    const hasGitUnavailable =
      /git[\s\S]{0,30}(unavailable|not available|なし|不可|shallow)/i.test(sec);
    expect(hasFirstTime).toBe(true);
    expect(hasGitUnavailable).toBe(true);
  });

  // PR #6: full-context ingestion + backlog 再肥大化 guard の 5 追加改善

  it("Gate 2 が full-context ingestion を明示する (Read で full 読込 = Claude context に入る旨)", () => {
    const sec = checkSection();
    // Gate 2 description に「全文 / full content / context に入る」相当の明示。
    // 単なる「抽出 (extract)」だけでは、Read 済の full content が Claude context に
    // 残ることが伝わらない。明示することで「check 後に current.md を別途 Read」
    // という冗長運用を予防。
    expect(sec).toMatch(
      /full[-\s]?context|full[-\s]?content|全文|ingestion|Claude[\s\S]{0,30}(context|コンテキスト)/i,
    );
  });

  it("Output Template が Context loaded 行を持つ (毎回の context 消費量可視化)", () => {
    const sec = checkSection();
    // Summary 部 or Gate 2 output に「context に入った行数」を明示する invariant。
    // 再肥大化を運用者が即時検知できるようにする。
    expect(sec).toMatch(
      /Context\s*loaded|context\s*consumption|読込[\s\S]{0,10}行|consumed[\s\S]{0,20}lines/i,
    );
  });

  it("Output Template に『詳細は Claude context 内、再 Read 不要』注記がある", () => {
    const sec = checkSection();
    // Codex review i-1 対応: 旧 regex は `不要` 単独で偽陽性リスクあり (一般名詞)。
    // 「check 後 / 再 Read / ingest 済」といった前後文脈を要求し、false-pass を防ぐ。
    // "Details in context after Gate 2 Read, no need to re-read" 相当の明示を強制。
    const explicitReReadBan =
      /(check 後|after check|再 Read|re[-\s]?read|再読[込み]|query directly|query\s+directly)/i;
    expect(sec).toMatch(explicitReReadBan);
  });

  it("陳腐化 signal 一覧に S-13 (backlog.md 肥大化 guard) が含まれる", () => {
    const sec = checkSection();
    // S-13 signal として backlog.md の行数 150 行超 WARN / 200 行超 FAIL を列挙。
    // 再肥大化 (旧 1354 行 prompt 問題の再発) を自動検知する。
    expect(sec).toMatch(/S-13/);
    expect(sec).toMatch(/backlog[\s\S]{0,80}(150|200)/);
  });

  it("Anti-pattern 10 個目 (check 後の re-read 冗長禁止) が追加されている", () => {
    // Anti-patterns section に 10 個目の項目として「check 後に current.md を
    // 別途 Read する運用」を禁止パターンとして列挙。
    const body = readSkill();
    const antiSection = body.match(
      /## Anti-patterns[\s\S]*?(?=\n## [^#]|$)/,
    )?.[0] ?? "";
    // 10 個目の item が存在 (`10. **...**` の形式) + check 後 re-read 言及
    expect(antiSection).toMatch(/^\s*10\.\s*\*\*/m);
    expect(antiSection).toMatch(
      /(check 後|after check|check 直後)[\s\S]{0,150}(再[\s]?Read|re[-\s]?read|再読|redundant|冗長)/i,
    );
  });
});


// harness-setup check が session-handoff を認識する (harness setup check 統合 invariant)
describe("session-handoff skill — harness-setup check 統合", () => {
  it("harness-setup.md の check 対象 command list に commands/session-handoff.md パス形式で含まれる", () => {
    // Codex review 対応 (A-05): 単なる文字列一致ではなく file path 形式で検証。
    // コメント内の偶然の一致を防ぐ。
    const setupPath = resolve(PLUGIN_ROOT, "commands/harness-setup.md");
    const content = readFileSync(setupPath, "utf-8");
    expect(content).toMatch(/commands\/session-handoff\.md/);
  });

  it("harness-setup.md のワークフロースキル数宣言が plugin.json 実数 - verb skills 数 (5) と一致する", () => {
    // Codex review 対応 (A-01): workflow skills 数字が手動で bookkeep されている
    // ため、plugin.json 実数と一致することを CI で強制。
    // Codex review 対応 (N-01): VERB_SKILL_COUNT は verb skill (plan/work/review/release/setup) の
    // 数に追随して手動更新が必要。新 verb skill 追加時はこの定数と harness-setup.md の
    // "X verb skills plus Y workflow skills" 表現の両方を更新すること。
    const VERB_SKILLS = [
      "harness-plan",
      "harness-work",
      "harness-review",
      "harness-release",
      "harness-setup",
    ];
    const setupPath = resolve(PLUGIN_ROOT, "commands/harness-setup.md");
    const setupContent = readFileSync(setupPath, "utf-8");
    const pluginJson = JSON.parse(
      readFileSync(resolve(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    ) as { commands: string[] };
    const totalCommands = pluginJson.commands.length;
    // plugin.json 実際の verb skills をカウント (VERB_SKILLS 定数からの drift を検知)
    const actualVerbCount = pluginJson.commands.filter((p) =>
      VERB_SKILLS.some((v) => p.endsWith(`/${v}.md`)),
    ).length;
    expect(actualVerbCount).toBe(VERB_SKILLS.length); // drift guard
    const expectedWorkflow = totalCommands - VERB_SKILLS.length;
    // "X verb skills plus Y workflow skills" フレーズの Y を抽出
    const match = /(\d+)\s*workflow\s+skills/.exec(setupContent);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(expectedWorkflow);
  });
});

/**
 * Phase μ — release guard.
 *
 * 設計意図 (hardcode vs dynamic):
 *   EXPECTED_VERSION を "hardcode" にしているのは意図的。
 *   plugin.json から動的に読んで比較する dynamic approach では
 *   「test constants を更新した」という PR 作業が不要になり、
 *   その forcing function (release 漏れ検知) が失われる。
 *
 * Rationale:
 *   plugin.json の version が "identical" とみなされると Claude Code の
 *   cache が再生成されない公式仕様 (code.claude.com/docs/en/plugins-reference)
 *   を根拠に、release PR で必ず連動すべき以下の 6 系統を regression guard で強制する:
 *
 *   1. plugin.json / marketplace.json / package.json の version 一致
 *   2. CHANGELOG.md に [X.Y.Z] - YYYY-MM-DD entry が移行済
 *   3. CHANGELOG.md 比較 link が compare/v{prev}...v{new} + compare/v{new}...HEAD に rewrite 済
 *      + 前 release の releases/tag link 形式で残存
 *   4. docs の `vX.Y.Z (unreleased)` マーカー除去 (prev + current 両方)
 *   5. marketplace.json plugins[0].description に含まれる commands 数が plugin.json.commands.length と一致
 *      (marketplace description drift を構造的に遮断 — plugin manifest と一貫性維持)
 *   6. marketplace.json plugins[0].description に含まれる hook events 数が hooks.json keys 数と一致
 *      (hooks drift の構造的遮断)
 *   7. EXPECTED_VERSION / EXPECTED_PREV_VERSION が SemVer X.Y.Z 形状を保つ
 *      (leading-zero 等の厳密検査は省略、shape validation のみ。canonical 形式とは区別)
 *
 * 次 release 時に更新する 3 箇所:
 *   1. EXPECTED_VERSION
 *   2. EXPECTED_PREV_VERSION
 *   3. EXPECTED_RELEASE_DATE
 * (describe タイトルは Phase μ 固定、バージョン番号を含めないので更新不要)
 *
 * false-positive 注意:
 *   (unreleased) マーカー test はファイル全体を raw 検索する。
 *   コードブロック内の歴史的言及 (例: 「以前は `v0.1.0 (unreleased)` と呼ばれていた」)
 *   も検出して false-fail する。歴史的言及を残す場合はバッククォート表現を変更すること。
 */
describe("release guard — version consistency (Phase μ)", () => {
  const EXPECTED_VERSION = "0.3.1";
  const EXPECTED_PREV_VERSION = "0.3.0";
  const EXPECTED_RELEASE_DATE = "2026-04-23";

  // SemVer X.Y.Z 形状検証 (shape validation のみ、leading-zero 等の細部検査は省略)
  // EXPECTED_VERSION = "0.2" / "1.2.3.4" / "abc" 等の malformed を排除することが目的
  if (!/^\d+\.\d+\.\d+$/.test(EXPECTED_VERSION)) {
    throw new Error(
      `EXPECTED_VERSION "${EXPECTED_VERSION}" is not canonical SemVer X.Y.Z`,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(EXPECTED_PREV_VERSION)) {
    throw new Error(
      `EXPECTED_PREV_VERSION "${EXPECTED_PREV_VERSION}" is not canonical SemVer X.Y.Z`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(EXPECTED_RELEASE_DATE)) {
    throw new Error(
      `EXPECTED_RELEASE_DATE "${EXPECTED_RELEASE_DATE}" is not YYYY-MM-DD`,
    );
  }

  // describe scope で 1 回だけ read (既存 line 1140 パターンと統一、I/O 削減)
  // 型は既存 describe と同じ Record<string, unknown> に揃える。narrow type にすると
  // 将来 plugin.json のフィールド名が変わった場合に型エラーではなく実行時エラーになるため、
  // dynamic access + 必要箇所のみ local narrow で型安全を確保する方針に統一。
  const pluginJson = JSON.parse(
    readFileSync(resolve(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
  ) as Record<string, unknown>;
  const rootPkg = JSON.parse(
    readFileSync(resolve(PLUGIN_ROOT, "../../package.json"), "utf-8"),
  ) as Record<string, unknown>;
  const corePkg = JSON.parse(
    readFileSync(resolve(PLUGIN_ROOT, "core/package.json"), "utf-8"),
  ) as Record<string, unknown>;
  const marketplaceJson = JSON.parse(
    readFileSync(
      resolve(PLUGIN_ROOT, "../../.claude-plugin/marketplace.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;
  const changelog = readFileSync(
    resolve(PLUGIN_ROOT, "../../CHANGELOG.md"),
    "utf-8",
  );
  const testBedUsage = readFileSync(
    resolve(PLUGIN_ROOT, "../../docs/maintainer/test-bed-usage.md"),
    "utf-8",
  );

  // --- 1-3: package.json / plugin.json バージョン ---
  it("plugins/harness/.claude-plugin/plugin.json の version が EXPECTED_VERSION", () => {
    expect(pluginJson["version"]).toBe(EXPECTED_VERSION);
  });

  it("root package.json の version が EXPECTED_VERSION", () => {
    expect(rootPkg["version"]).toBe(EXPECTED_VERSION);
  });

  it("plugins/harness/core/package.json の version が EXPECTED_VERSION", () => {
    expect(corePkg["version"]).toBe(EXPECTED_VERSION);
  });

  // --- 4-5: marketplace.json ---
  it("marketplace.json metadata.version が EXPECTED_VERSION", () => {
    const metadata = marketplaceJson["metadata"] as Record<string, unknown>;
    expect(metadata["version"]).toBe(EXPECTED_VERSION);
  });

  it("marketplace.json plugins[0].version (harness) が EXPECTED_VERSION", () => {
    const plugins = marketplaceJson["plugins"] as Array<Record<string, unknown>>;
    const harnessPlugin = plugins.find((p) => p["name"] === "harness");
    expect(harnessPlugin).toBeDefined();
    expect(harnessPlugin?.["version"]).toBe(EXPECTED_VERSION);
  });

  // --- 6-7: marketplace.json description ↔ plugin manifest の drift 遮断 ---
  it("marketplace.json plugins[0].description の commands 数が plugin.json.commands.length と一致", () => {
    // Record<string, unknown> から narrow access: plugin.json.commands のフィールド名が
    // 変わった場合に compile error で落とす意図 (dynamic access + cast なら実行時エラー)。
    const rawCommands = pluginJson["commands"];
    expect(Array.isArray(rawCommands)).toBe(true);
    const commands = rawCommands as string[];
    const totalCommands = commands.length;
    const plugins = marketplaceJson["plugins"] as Array<Record<string, unknown>>;
    const harnessPlugin = plugins.find((p) => p["name"] === "harness");
    const description = harnessPlugin?.["description"];
    expect(typeof description).toBe("string");
    // "13 commands" / "13 verb commands" 等のパターンを許容
    const pattern = new RegExp(
      `\\b${totalCommands}\\s+(?:verb\\s+)?commands?\\b`,
    );
    expect(description as string).toMatch(pattern);
  });

  it("marketplace.json plugins[0].description の hook events 数が hooks.json keys 数と一致", () => {
    const hooksJson = JSON.parse(
      readFileSync(resolve(PLUGIN_ROOT, "hooks/hooks.json"), "utf-8"),
    ) as { hooks: Record<string, unknown> };
    const eventCount = Object.keys(hooksJson.hooks).length;
    const plugins = marketplaceJson["plugins"] as Array<Record<string, unknown>>;
    const harnessPlugin = plugins.find((p) => p["name"] === "harness");
    const description = harnessPlugin?.["description"];
    expect(typeof description).toBe("string");
    // "12 lifecycle hook events" / "12 hook events" 等のパターンを許容 (hooks.json keys 数に追随)
    const pattern = new RegExp(
      `\\b${eventCount}\\s+(?:lifecycle\\s+)?hook\\s+events?\\b`,
    );
    expect(description as string).toMatch(pattern);
  });

  // --- 8-11: CHANGELOG.md ---
  it("CHANGELOG.md に [X.Y.Z] - YYYY-MM-DD entry が移行済", () => {
    const pattern = new RegExp(
      `^## \\[${escapeRegex(EXPECTED_VERSION)}\\] - ${escapeRegex(EXPECTED_RELEASE_DATE)}$`,
      "m",
    );
    expect(changelog).toMatch(pattern);
  });

  it("CHANGELOG.md 比較 link [Unreleased] が compare/v{new}...HEAD に rewrite 済", () => {
    const pattern = new RegExp(
      `^\\[Unreleased\\]: .*compare/v${escapeRegex(EXPECTED_VERSION)}\\.\\.\\.HEAD$`,
      "m",
    );
    expect(changelog).toMatch(pattern);
  });

  it("CHANGELOG.md 比較 link [X.Y.Z] が compare/v{prev}...v{new} を指す", () => {
    const pattern = new RegExp(
      `^\\[${escapeRegex(EXPECTED_VERSION)}\\]: .*compare/v${escapeRegex(EXPECTED_PREV_VERSION)}\\.\\.\\.v${escapeRegex(EXPECTED_VERSION)}$`,
      "m",
    );
    expect(changelog).toMatch(pattern);
  });

  it("CHANGELOG.md 前 release link [X.Y.Z_prev] が releases/tag 形式で残存", () => {
    const pattern = new RegExp(
      `^\\[${escapeRegex(EXPECTED_PREV_VERSION)}\\]: .*releases/tag/v${escapeRegex(EXPECTED_PREV_VERSION)}$`,
      "m",
    );
    expect(changelog).toMatch(pattern);
  });

  it("CHANGELOG.md に [Unreleased] section header は残っている (Keep a Changelog 慣習)", () => {
    expect(changelog).toMatch(/^## \[Unreleased\]$/m);
  });

  // --- 11-12: docs (unreleased) マーカー除去 (prev + current 両方) ---
  it("test-bed-usage.md に v{prev} (unreleased) マーカーが残っていない", () => {
    const pattern = new RegExp(
      `v${escapeRegex(EXPECTED_PREV_VERSION)}\\s*\\(unreleased\\)`,
    );
    expect(testBedUsage).not.toMatch(pattern);
  });

  it("test-bed-usage.md に v{current} (unreleased) マーカーが残っていない", () => {
    // current version も誰かが (unreleased) 付きで書いていた場合を検知
    const pattern = new RegExp(
      `v${escapeRegex(EXPECTED_VERSION)}\\s*\\(unreleased\\)`,
    );
    expect(testBedUsage).not.toMatch(pattern);
  });
});

/**
 * `.coderabbit.yaml` repository-level CodeRabbit config の構造検証。
 *
 * 目的:
 *   - yaml parse による nested access で structural integrity を検証
 *     (regex match の false-positive / false-negative を根本解決)
 *   - path-based instructions の drift 防止 (shipped spec 全 path を網羅)
 *   - Organization UI default への silent fallback を防止
 *   - yaml 自身が汎用化原則 (内部 tracker ID 禁止) を遵守していることを self-check
 *
 * 技術選択:
 *   `yaml` (pure JS, Node >=18) を dev dep に追加、YAML.parse で nested object にしてから
 *   `config.reviews.profile` のような正確な path で検証。substring match の曖昧性を排除。
 */
describe(".coderabbit.yaml — repository-level CodeRabbit config", () => {
  const coderabbitYamlPath = resolve(PLUGIN_ROOT, "../../.coderabbit.yaml");
  const coderabbitYamlRaw = readFileSync(coderabbitYamlPath, "utf-8");
  const coderabbitConfig = parseYaml(coderabbitYamlRaw) as Record<string, unknown>;

  it("schema directive がファイル先頭行 (yaml-language-server + coderabbit schema v2)", () => {
    const firstLine = coderabbitYamlRaw.split("\n", 1)[0];
    expect(firstLine).toBe(
      "# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json",
    );
  });

  it("language は ja-JP", () => {
    expect(coderabbitConfig["language"]).toBe("ja-JP");
  });

  it("tone_instructions は 非空 + 250 文字以内 (公式 schema.v2 制約)", () => {
    const tone = coderabbitConfig["tone_instructions"];
    expect(typeof tone).toBe("string");
    expect(tone).toBeTruthy();
    expect((tone as string).length).toBeLessThanOrEqual(250);
  });

  it("reviews.profile: chill (actionable-only、nitpick は assertive profile 専用の公式仕様)", () => {
    const reviews = coderabbitConfig["reviews"] as Record<string, unknown>;
    expect(reviews["profile"]).toBe("chill");
    expect(reviews["request_changes_workflow"]).toBe(false);
  });

  it("reviews.auto_review: enabled + drafts=false + base_branches に ^main$ (regex 形式)", () => {
    const reviews = coderabbitConfig["reviews"] as Record<string, unknown>;
    const autoReview = reviews["auto_review"] as Record<string, unknown>;
    expect(autoReview["enabled"]).toBe(true);
    expect(autoReview["drafts"]).toBe(false);
    const baseBranches = autoReview["base_branches"];
    expect(Array.isArray(baseBranches)).toBe(true);
    // regex 形式 (glob ではない、公式 schema.v2 仕様)
    expect(baseBranches as string[]).toContain("^main$");
  });

  it("reviews.path_instructions に harness shipped spec の 17 path 全てが含まれる", () => {
    const reviews = coderabbitConfig["reviews"] as Record<string, unknown>;
    const pathInstructions = reviews["path_instructions"] as Array<{
      path: string;
      instructions: string;
    }>;
    expect(Array.isArray(pathInstructions)).toBe(true);
    const actualPaths = new Set(pathInstructions.map((p) => p.path));
    // shipped spec の各 path が review 指示対象になっているか (drift 防止)。
    // 追加 / 削除時はこの配列を更新 (forcing function、release guard と同じ思想)。
    const requiredPaths = [
      "**/*",
      "plugins/harness/core/src/**/*.ts",
      "plugins/harness/core/src/__tests__/**/*.ts",
      "plugins/harness/agents/**/*.md",
      "plugins/harness/commands/**/*.md",
      "plugins/harness/hooks/hooks.json",
      "plugins/harness/schemas/**/*.json",
      "plugins/harness/.claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      "scripts/**/*.mjs",
      ".github/workflows/*.yml",
      "template/**/*",
      "CONTRIBUTING.md",
      "CHANGELOG.md",
      "docs/maintainer/**/*.md",
      "docs/{en,ja}/**/*.md",
      "README.md",
    ];
    for (const p of requiredPaths) {
      expect(
        actualPaths.has(p),
        `path_instructions must include "${p}"`,
      ).toBe(true);
    }
  });

  it("`**/*` path の instructions が汎用化原則 (内部 tracker ID 禁止) を含む", () => {
    const reviews = coderabbitConfig["reviews"] as Record<string, unknown>;
    const pathInstructions = reviews["path_instructions"] as Array<{
      path: string;
      instructions: string;
    }>;
    const globalEntry = pathInstructions.find((p) => p.path === "**/*");
    expect(globalEntry).toBeDefined();
    expect(globalEntry!.instructions).toContain("Plugin Generality Check");
    expect(globalEntry!.instructions).toContain("内部 tracker ID");
    expect(globalEntry!.instructions).toContain("time-stable wording");
  });

  it("reviews.path_filters で build artifact / local docs / maintainer session-notes を除外", () => {
    const reviews = coderabbitConfig["reviews"] as Record<string, unknown>;
    const pathFilters = reviews["path_filters"] as string[];
    expect(Array.isArray(pathFilters)).toBe(true);
    expect(pathFilters).toContain("!plugins/harness/core/dist/**");
    expect(pathFilters).toContain("!.docs/**");
    // session-notes は internal tracker ID の exemption zone。CodeRabbit review 対象から除外し、
    // 機密 review 情報が外部送出されることを防止。
    expect(pathFilters).toContain("!docs/maintainer/session-notes/**");
  });

  it("knowledge_base: learnings.scope=local + web_search.enabled=true + code_guidelines.enabled=true", () => {
    const kb = coderabbitConfig["knowledge_base"] as Record<string, unknown>;
    const learnings = kb["learnings"] as Record<string, unknown>;
    expect(learnings["scope"]).toBe("local");
    const webSearch = kb["web_search"] as Record<string, unknown>;
    expect(webSearch["enabled"]).toBe(true);
    const codeGuidelines = kb["code_guidelines"] as Record<string, unknown>;
    expect(codeGuidelines["enabled"]).toBe(true);
  });

  it("chat.auto_reply: true (CodeRabbit との対話を能動化)", () => {
    const chat = coderabbitConfig["chat"] as Record<string, unknown>;
    expect(chat["auto_reply"]).toBe(true);
  });

  it("yaml 自身が internal tracker ID を usage 形式で含まない (generality 自己整合)", () => {
    // yaml の shipped-spec 相当の扱いに対する self-check。
    // Exemption: yaml 内で "禁止対象を記述する" 目的の例示 (`(C-N) / (M-N)` 等) は許容。
    // 禁止: "Phase μ review での refactor" のような tracker ID を前提とする参照 usage。
    //
    // 検出対象:
    //   - ギリシャ文字 Phase (Phase κ / λ / μ ...) の usage
    //   - Arabic Phase (Phase 1 / Phase 2 ...) の usage
    //   - Round N の usage (指摘 / review / fix / 対応)
    //   - PCR-N 参照
    const greekPhaseUsagePattern =
      /Phase [κ-ω][-\s][A-Za-z0-9]/; // κ λ μ ν ξ ... の後に英字
    expect(coderabbitYamlRaw).not.toMatch(greekPhaseUsagePattern);

    const arabicPhaseUsagePattern =
      /Phase\s+\d+\s+(review|fix|指摘|対応)/;
    expect(coderabbitYamlRaw).not.toMatch(arabicPhaseUsagePattern);

    const roundUsagePattern = /Round\s+\d+\s+(指摘|review|fix|対応)/;
    expect(coderabbitYamlRaw).not.toMatch(roundUsagePattern);

    const pcrPattern = /\bPCR-\d+\b/;
    expect(coderabbitYamlRaw).not.toMatch(pcrPattern);
  });
});

describe("slash command allowed-tools / subagent tools — 公式 tool catalog whitelist guard", () => {
  // 公式 source (初回 fetch 2026-04-23 via Codex companion + WebFetch 直接照合、
  // Worker A/B + Reviewer 3 agent 独立検証で一致。catalog 更新時は本コメントと
  // OFFICIAL_TOOL_NAMES に反映し CHANGELOG.md で source URL を記録):
  //   - https://code.claude.com/docs/en/tools-reference  (complete 35-tool table)
  //   - https://code.claude.com/docs/en/slash-commands   (allowed-tools frontmatter spec)
  //   - https://code.claude.com/docs/en/sub-agents       (tools / disallowedTools frontmatter spec)
  //
  // 公式 spec 要点:
  //   - `allowed-tools` は "space-separated string or YAML list" を受け付ける
  //     (公式引用: "Accepts a space-separated string or a YAML list.")
  //   - 公式 catalog に単独 "Task" tool は**存在しない** (tools-reference 表に不在)
  //   - subagent/task 起動は `Agent` (subagent spawn) + `TaskCreate` / `TaskGet` /
  //     `TaskList` / `TaskStop` / `TaskUpdate` の個別 tool に分かれる
  //   - `TaskOutput` は tools-reference で "(Deprecated)" と明記、catalog 掲載継続中
  //   - `disallowedTools: [Task]` も同じ理由で実質 no-op — subagent spawning を
  //     block したい場合は `disallowedTools: [Agent]` が正しい
  //
  // 更新ポリシー:
  //   - 公式 docs が新規 tool を追加した場合は OFFICIAL_TOOL_NAMES に追記し、
  //     根拠 URL を CHANGELOG.md に記録する。
  //   - "Task" 単独を whitelist に戻すことは禁止 (上記根拠を破壊するため)。
  //   - MCP 動的 tool (`mcp__<server>__<action>`) は server 登録で動的変化するため
  //     本 whitelist の静的対象外 (`isMcpDynamicTool` で別扱い、公式 catalog の
  //     `ListMcpResourcesTool` / `ReadMcpResourceTool` のみ whitelist に含む)。
  const OFFICIAL_TOOL_NAMES = new Set<string>([
    // file ops
    "Read",
    "Write",
    "Edit",
    "NotebookEdit",
    // shell
    "Bash",
    "PowerShell",
    // search
    "Grep",
    "Glob",
    // subagent spawning
    "Agent",
    // task / todo management (単独 "Task" は存在しない)
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskStop",
    "TaskUpdate",
    "TaskOutput", // "(Deprecated)" per official tools-reference — 新規使用非推奨
    "TodoWrite",
    // web
    "WebFetch",
    "WebSearch",
    // MCP (builtin enumeration — 動的 mcp__* tool は isMcpDynamicTool で別扱い)
    "ListMcpResourcesTool",
    "ReadMcpResourceTool",
    // plan / worktree (EnterWorktree / ExitWorktree は subagents 側非対応)
    "EnterPlanMode",
    "ExitPlanMode",
    "EnterWorktree",
    "ExitWorktree",
    // cron / scheduled tasks
    "CronCreate",
    "CronDelete",
    "CronList",
    // agent teams (experimental, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 限定)
    "SendMessage",
    "TeamCreate",
    "TeamDelete",
    // user interaction
    "AskUserQuestion",
    // meta / code intelligence
    "Skill",
    "ToolSearch",
    "Monitor",
    "LSP",
  ]);

  // MCP 動的 tool (`mcp__<server>__<action>`) は server 設定で動的変化するため
  // 静的 whitelist 対象外。公式 docs: https://code.claude.com/docs/en/mcp
  // server / action 名は hyphen を含む実例あり (例: `mcp__my-server__run-task`)。
  // 末尾 `$` anchor を付けて `mcp__foo__bar!!!` のような不正 suffix を reject する
  // (pseudo-CodeRabbit review 2026-04-23 Minor 指摘)。
  function isMcpDynamicTool(raw: string): boolean {
    return /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(raw);
  }

  // granular permission 指定 (公式 slash-commands の例: `Bash(git add *)` /
  // `Bash(git commit *)`、permissions docs の `:*` suffix 形式も含む) から
  // tool 名 prefix を抽出する。空括弧 / ネスト括弧にも対応。
  function stripGranularSpec(raw: string): string {
    const parenIdx = raw.indexOf("(");
    return parenIdx === -1 ? raw : raw.slice(0, parenIdx);
  }

  // frontmatter の tool list field を公式仕様に従い parse する。
  // 公式仕様 (slash-commands / sub-agents docs): "space-separated string or YAML list"。
  //
  // 対応するフォーマット:
  //   (1) YAML flow array (quoted):   `["Read", "Bash"]`
  //   (2) YAML flow array (unquoted): `[Read, Grep, Glob]` / 複数行 `[\n  Read,\n]`
  //   (3) YAML block array:            複数行の `  - Read` 項目列
  //   (4) Space-separated string:     `Read Grep Bash`
  //   (5) CSV string (subagent 例):   `Read, Grep, Glob, Bash`
  //   (6) Granular 要素含む string:   `Bash(git add *) Bash(git commit *)`
  //
  // key 未定義なら null、値が空文字・nil なら空配列、解析不能なら null を返す。
  //
  // 実装方針: YAML native parser で frontmatter 全体を parse し、指定 key の値を
  // look up する。`.test.ts` 内で部分 fm (単一 key/value) を渡すケースも
  // frontmatter として valid YAML なので同じ経路で動作する。
  function parseToolListField(fm: string, key: string): string[] | null {
    let doc: unknown;
    try {
      doc = parseYaml(fm);
    } catch {
      doc = undefined;
    }
    if (doc && typeof doc === "object" && key in (doc as Record<string, unknown>)) {
      const value = (doc as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.map((v) => String(v));
      if (typeof value === "string") return splitFlatToolList(value);
      if (value == null) return [];
      // 公式 slash-commands / sub-agents spec に反する frontmatter 型 (object / number
      // 等) は silent pass すると guard が偽陽性になるため loud に throw する。
      // (real CodeRabbit 2026-04-23 inline review L2177 指摘、malformed frontmatter は
      // CI 停止させる)
      throw new Error(
        `frontmatter field '${key}' has invalid type (expected array or space-separated string): ${JSON.stringify(value)}`,
      );
    }
    // parseYaml 失敗 (catch で doc=undefined) or key 不在 → null を返し caller に skip させる。
    // 以前は key 存在時に空配列を返していたが、malformed YAML を silent に通すため
    // assertion が常に pass する偽陽性問題があった (pseudo-CodeRabbit review 2026-04-23 Nitpick #2)。
    // 現在は 2 ケースを厳密に区別: doc が null/undefined or key 未定義 → null (skip)。
    return null;
  }

  // 括弧 depth を考慮して space / comma separator で tool 名を展開する。
  // 例: "Bash(git add *) Bash(git commit *)" → ["Bash(git add *)", "Bash(git commit *)"]
  //     "Read, Grep, Glob"                   → ["Read", "Grep", "Glob"]
  function splitFlatToolList(input: string): string[] {
    const tokens: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of input) {
      if (ch === "(") {
        depth += 1;
        current += ch;
      } else if (ch === ")") {
        depth = Math.max(0, depth - 1);
        current += ch;
      } else if ((ch === " " || ch === "\t" || ch === "," || ch === "\n") && depth === 0) {
        if (current !== "") {
          tokens.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }
    if (current !== "") tokens.push(current);
    return tokens.map((t) => t.replace(/^["']|["']$/g, "").trim()).filter((t) => t !== "");
  }

  // 各 field 共通の「単独 Task 禁止 + whitelist 適合」検査ロジック (DRY)。
  function assertToolListOfficial(
    subjectLabel: string,
    fieldLabel: string,
    list: string[],
  ): void {
    const normalized = list.map(stripGranularSpec);
    expect(
      normalized,
      `${subjectLabel} ${fieldLabel} に単独 'Task' が残っている (公式 catalog 外、修正: Agent + TaskCreate/TaskGet/TaskList/TaskUpdate/TaskStop)`,
    ).not.toContain("Task");
    const unknown = normalized.filter(
      (t) => !OFFICIAL_TOOL_NAMES.has(t) && !isMcpDynamicTool(t),
    );
    expect(
      unknown,
      `${subjectLabel} ${fieldLabel} に unknown tool: ${unknown.join(", ")}`,
    ).toEqual([]);
  }

  it.each(COMMAND_NAMES)(
    "%s command の allowed-tools が公式 tool catalog 内 (単独 Task 禁止含む)",
    (name) => {
      const fm = extractFrontmatter(readCommand(name));
      const list = parseToolListField(fm, "allowed-tools");
      // `allowed-tools` は本プロジェクトの coding guidelines で command frontmatter の
      // 必須 field (plugins/harness/commands/**/*.md: name / description / description-ja
      // / allowed-tools / argument-hint)。欠落は CI で止める (real CodeRabbit 2026-04-23
      // inline review L2234 指摘、false negative 防止)。
      expect(
        list,
        `${name} command is missing required 'allowed-tools' frontmatter field (coding guidelines)`,
      ).not.toBeNull();
      assertToolListOfficial(`${name} command`, "allowed-tools", list!);
    },
  );

  it.each(AGENT_NAMES)(
    "%s agent の tools が公式 tool catalog 内 (単独 Task 禁止含む)",
    (name) => {
      const fm = extractFrontmatter(readAgent(name));
      const list = parseToolListField(fm, "tools");
      if (list === null) return;
      assertToolListOfficial(`${name} agent`, "tools", list);
    },
  );

  it.each(AGENT_NAMES)(
    "%s agent の disallowedTools が公式 tool catalog 内 (単独 Task 禁止含む)",
    (name) => {
      const fm = extractFrontmatter(readAgent(name));
      const list = parseToolListField(fm, "disallowedTools");
      if (list === null) return;
      assertToolListOfficial(`${name} agent`, "disallowedTools", list);
    },
  );

  // 内部ヘルパーの自己検証 (将来 helper を書き換えた際の回帰 guard)
  it("stripGranularSpec は granular / 空括弧 / 括弧なしを正しく剥がす", () => {
    expect(stripGranularSpec("Read")).toBe("Read");
    expect(stripGranularSpec("Bash(git add *)")).toBe("Bash");
    expect(stripGranularSpec("Bash(git:*)")).toBe("Bash");
    expect(stripGranularSpec("Bash()")).toBe("Bash");
    expect(stripGranularSpec("Bash(git (nested))")).toBe("Bash");
  });

  it("parseToolListField は不正型 (object / number) を silent pass せず throw する", () => {
    expect(() =>
      parseToolListField("allowed-tools: {foo: bar}", "allowed-tools"),
    ).toThrow(/invalid type/);
    expect(() => parseToolListField("tools: 123", "tools")).toThrow(
      /invalid type/,
    );
  });

  it("parseToolListField は 5 公式書式 (array / CSV / space / block / granular) を全て parse 可", () => {
    // (1) JSON-style array (quoted)
    expect(
      parseToolListField('allowed-tools: ["Read", "Bash"]', "allowed-tools"),
    ).toEqual(["Read", "Bash"]);
    // (2) YAML flow array (unquoted)
    expect(parseToolListField("tools: [Read, Grep, Glob]", "tools")).toEqual([
      "Read",
      "Grep",
      "Glob",
    ]);
    // (3) 複数行 flow array
    expect(
      parseToolListField("tools: [\n  Read,\n  Grep,\n]", "tools"),
    ).toEqual(["Read", "Grep"]);
    // (4) 空配列
    expect(parseToolListField("tools: []", "tools")).toEqual([]);
    // (5) 公式 allowed-tools の space-separated string 書式
    expect(
      parseToolListField("allowed-tools: Read Grep", "allowed-tools"),
    ).toEqual(["Read", "Grep"]);
    // (6) 公式 slash-commands 実例の granular 混在
    expect(
      parseToolListField(
        "allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)",
        "allowed-tools",
      ),
    ).toEqual(["Bash(git add *)", "Bash(git commit *)", "Bash(git status *)"]);
    // (7) 公式 sub-agents ドキュメントの CSV 書式 (tools: Read, Grep, Glob)
    expect(parseToolListField("tools: Read, Grep, Glob", "tools")).toEqual([
      "Read",
      "Grep",
      "Glob",
    ]);
    // (8) YAML block style (複数行、ハイフン項目)
    expect(
      parseToolListField("tools:\n  - Read\n  - Grep\n  - Glob", "tools"),
    ).toEqual(["Read", "Grep", "Glob"]);
    // (9) key 未定義
    expect(parseToolListField("other: value", "allowed-tools")).toBeNull();
  });

  it("isMcpDynamicTool は mcp__ 動的 tool のみを許容する", () => {
    expect(isMcpDynamicTool("mcp__github__create_pr")).toBe(true);
    expect(isMcpDynamicTool("mcp__my-server__run-task")).toBe(true);
    expect(isMcpDynamicTool("Read")).toBe(false);
    expect(isMcpDynamicTool("Task")).toBe(false);
    expect(isMcpDynamicTool("mcp__")).toBe(false); // 空 body は reject
    expect(isMcpDynamicTool("mcp__noaction__")).toBe(false); // trailing 区切りだけは reject
  });
});
