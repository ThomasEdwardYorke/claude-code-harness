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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

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

describe("harness-work command の Task-tool プロンプト materialize", () => {
  const content = readCommand("harness-work");

  it("wt:avoid Task-tool 経路の Phase 5.5 記述で literal $PROFILE を残さない", () => {
    // Skill handoff と同様、Task prompt も materialize が必要。
    // `/pseudo-coderabbit-loop --local --profile=$PROFILE` のまま Task prompt 文字列で
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
  const src = readFileSync(
    resolve(PLUGIN_ROOT, "core/src/hooks/subagent-stop.ts"),
    "utf-8",
  );

  it("loadConfigSafe 経由で tooling.pythonCandidateDirs を解決する", () => {
    // 旧: hardcode `PYTHON_CANDIDATE_DIRS = ["backend", "src", "app"]`
    // 新: config 経由 (stack-neutral default + project-local override)
    expect(src).toMatch(/loadConfigSafe/);
    expect(src).toMatch(/pythonCandidateDirs/);
  });

  it("shape-invalid config では default (['src', 'app']) にフォールバック (fail-open)", () => {
    // Codex M-1A 方針: config 壊れていても throw せず default。
    expect(src).toMatch(/Array\.isArray\(/);
    // fallback default が plugin 内に inline で書かれていること
    expect(src).toMatch(/\["src",\s*"app"\]/);
  });

  it("候補 dir が 1 つも無い場合は ruff/mypy を skip する", () => {
    expect(src).toMatch(/pyTargets\.length\s*>\s*0/);
  });

  it("detectAvailableChecks を export している (test 可能性)", () => {
    expect(src).toMatch(/export\s+function\s+detectAvailableChecks/);
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
  const pluginJson = JSON.parse(
    readFileSync(
      resolve(PLUGIN_ROOT, ".claude-plugin/plugin.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;

  it("commands 配列で全 command md を explicit に宣言している", () => {
    const commands = pluginJson["commands"] as string[];
    expect(Array.isArray(commands)).toBe(true);
    // 実在する commands/*.md が全て宣言されていること。
    const declaredBaseNames = commands
      .map((p) => p.replace(/^\.\/commands\//, "").replace(/\.md$/, ""))
      .sort();
    expect(declaredBaseNames).toEqual(COMMAND_NAMES.slice().sort());
  });

  it("agents 配列で全 agent md を explicit に宣言している", () => {
    const agents = pluginJson["agents"] as string[];
    expect(Array.isArray(agents)).toBe(true);
    const declaredBaseNames = agents
      .map((p) => p.replace(/^\.\/agents\//, "").replace(/\.md$/, ""))
      .sort();
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

describe("marketplace.json のクロスマーケットプレイス依存宣言 (openai-codex)", () => {
  const marketplaceJson = JSON.parse(
    readFileSync(
      resolve(PLUGIN_ROOT, "../../.claude-plugin/marketplace.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;

  it("codex-sync / coderabbit-mimic agent が invoke する openai-codex を allow 依存に宣言", () => {
    const allow = marketplaceJson["allowCrossMarketplaceDependenciesOn"];
    expect(Array.isArray(allow)).toBe(true);
    expect(allow).toContain("openai-codex");
  });

  it("metadata.version が plugin.version と一致する", () => {
    const metadata = marketplaceJson["metadata"] as Record<string, unknown>;
    const plugins = marketplaceJson["plugins"] as Array<Record<string, unknown>>;
    const harnessPlugin = plugins.find((p) => p["name"] === "harness");
    expect(metadata["version"]).toBe(harnessPlugin?.["version"]);
  });

  it("strict: true を明示 (plugin.json 権威)", () => {
    expect(marketplaceJson["strict"]).toBe(true);
  });
});
