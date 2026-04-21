/**
 * core/src/__tests__/content-integrity.test.ts
 * agents / commands Markdown の不変条件を検証するリグレッションテスト。
 *
 * 2026-04-21 追加: Phase 3 Codex レビュー申送 C-1 / M-2 / M-3 / m-2 に対応。
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
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) {
    throw new Error(
      "frontmatter (between --- fences) not found at the top of the Markdown file",
    );
  }
  return match[1]!;
}

const AGENT_NAMES = listMdFiles("agents");
const COMMAND_NAMES = listMdFiles("commands");

describe("coderabbit-mimic agent の Codex CLI 呼出 (C-1)", () => {
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

describe("pseudo-coderabbit-loop command の日時計算 (M-3)", () => {
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

  it("python3 不在 / parse 失敗時に silent で ELAPSED=900+ へ落ちず WARN を出す (A-6 r2 Minor-2)", () => {
    // python3 が無い / parse 失敗で PAST_TS=0 になると ELAPSED が常に 900 超となり
    // rate-limit cooldown が無効化される。warn 出力 + 安全側の cooldown 強制を期待。
    expect(content).toMatch(/WARN[\s\S]*?cooldown|cooldown[\s\S]*?WARN/i);
    expect(content).toMatch(/python3[\s\S]*?(command\s+-v|which|not\s+available|不在)/i);
  });
});

describe("pseudo-coderabbit-loop command の profile 読取り fallback (A-6 r2/r3/r4/r9 累積)", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it(".coderabbit.yaml がある環境で silent に chill へ落ちず WARN を出す (固定文言で厳密判定)", () => {
    // A-6 r3 Trivial-5: 近傍の無関係な WARN で false-positive しないよう固定文言でアサート。
    expect(content).toMatch(/profile could not be parsed/);
  });

  it("stdlib regex fallback が reviews 直下のインデントだけを拾う (A-6 r3 Minor-3)", () => {
    // 深い階層 (例: reviews.labels.profile) を誤読しないよう、インデント深さを
    // first_indent で明示的に制約している実装であること。
    expect(content).toMatch(/reviews:.*\n.*first_indent|first_indent.*reviews/s);
  });

  it("stdlib regex fallback が inline YAML comment `# ...` を許容する (A-6 r4 Minor-3)", () => {
    // `profile: assertive  # comment` のような valid YAML を parse 失敗にしない。
    // pattern 末尾に `(?:\s+#.*)?` が追加されていることを確認。
    expect(content).toMatch(/\(\?:\\s\+#\.\*\)\?/);
  });

  it("stdlib fallback は quoted heredoc (`<<'PYEOF'`) で bash エスケープ依存を排除 (A-6 r9 Major-4)", () => {
    // bash double-quote 内の `\$` が `$` に変換される挙動に依存すると rewrite 時に破綻しやすい。
    // `<< 'PYEOF'` または `<<'PYEOF'` quoted heredoc で python スクリプトを bash 解釈から隔離する。
    expect(content).toMatch(/python3\s*<<\s*['"]?PYEOF['"]?|<<\s*['"]PYEOF['"]/);
  });

  it("BASE_BRANCH の main fallback が実際に発火する (A-6 r9 Major-6)", () => {
    // `git config --get ... | sed ... || echo main` は sed が exit 0 で返すため fallback 発火しない。
    // 別段で取得 + 空チェック `:-main` のパターンが必要。
    expect(content).toMatch(
      /(?:BASE_BRANCH=\$\{?\w+:-main\}?|BASE_BRANCH="?\$\{?[A-Z_]+:-main\}?"?|BASE_BRANCH=\$\{[A-Z_]+:-\s*main\s*\})/,
    );
  });

  it("strict profile を harness-local extension として明示する (A-6 r4 Minor-4)", () => {
    // CodeRabbit 公式 reviews.profile は chill/assertive のみ (2026-04 時点、
    // https://docs.coderabbit.ai/reference/configuration)。strict は本 plugin 独自拡張。
    expect(content).toMatch(
      /strict[\s\S]{0,500}?(harness|local|extension|拡張|公式外|CodeRabbit 公式に(?:は)?(?:存在し)?ない|non-official)/i,
    );
  });

  it("assertive で nitpick を採用する (A-6 r10 Major-1、CodeRabbit 公式 `Nitpick only in Assertive mode`)", () => {
    // 現状: `nitpick (profile が strict の場合のみ)` は公式挙動とずれる。
    // 公式: assertive が nitpick を出す mode。strict は harness 拡張で上限強化のみ。
    expect(content).toMatch(
      /(?:nitpick[\s\S]{0,100}?assertive|assertive[\s\S]{0,100}?nitpick)(?!(?:[\s\S]{0,50}の場合のみ))/i,
    );
  });

  it("YAML 由来 profile を CodeRabbit 公式 allowlist (chill|assertive) で検証する (A-6 r5 Minor-2)", () => {
    // pseudo-coderabbit-loop.md 側でも、YAML 由来値を allowlist で検証し、
    // strict / typo は WARN を出して chill に fallback すること。
    expect(content).toMatch(
      /(?:allowlist|公式|chill\|assertive|chill.*assertive|chill".*"assertive)[\s\S]{0,400}?(?:WARN|警告|fallback|chill)/i,
    );
  });
});

describe("tdd-implement command の profile 引数伝播 (A-6 r8 Major-3 / r9 拡張)", () => {
  const content = readCommand("tdd-implement");

  it("argument-hint に --profile= allowlist を含む", () => {
    expect(content).toMatch(/argument-hint[\s\S]{0,200}?--profile=\(?chill\|assertive\|strict/);
  });

  it("Phase 5.5 の /pseudo-coderabbit-loop 呼出で受け取った $PROFILE を直列化する", () => {
    // 旧: `/pseudo-coderabbit-loop --local --profile=chill` のハードコード
    // 新: `--profile=$PROFILE` または materialized 実値を渡す
    expect(content).toMatch(/pseudo-coderabbit-loop[\s\S]{0,200}?--profile=\$\{?PROFILE\}?|pseudo-coderabbit-loop[\s\S]{0,200}?--profile=\$\{?profile\}?/i);
  });

  it("rate-limit 分岐でも profile を handoff する (A-6 r9 Major-1)", () => {
    // rate-limit fallback (`/pseudo-coderabbit-loop <pr>`) で --profile= が抜けると
    // chain の profile 整合が PR-mode 経路で崩れる。
    expect(content).toMatch(
      /rate[\s-]?limit[\s\S]{0,200}?pseudo-coderabbit-loop[\s\S]{0,100}?--profile=/i,
    );
  });

  it("末尾 token のみ --profile= を option として扱う (A-6 r9 Minor-1 task desc 境界)", () => {
    // 任意位置の --profile=... を option 扱いすると task description 本文の
    // `--profile=assertive` 記述まで誤認する。末尾 token 限定が安全。
    expect(content).toMatch(
      /(?:末尾\s*token|last\s*token|ARGS_TOKENS\[-1\]|末尾のみ|末尾オプション|末尾の\s*--profile)/i,
    );
  });

  it("末尾 token 抽出が bash 前提であることを明示する (A-6 r10 Minor-1 zsh regression)", () => {
    // zsh は配列が 1-based なので `ARGS_TOKENS[LAST_IDX]` の挙動が bash と異なり、
    // silent に profile override が失われる。bash 前提を明記 (または両対応実装)。
    expect(content).toMatch(/bash\s*前提|bash\s+only|require\s+bash|emulate\s+-L\s+sh|setopt\s+ksharrays/i);
  });
});

describe("parallel-worktree command の profile 引数伝播 (A-6 r8 Major-4 / r9 拡張)", () => {
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

  it("Phase 6 rate-limit fallback でも profile を handoff する (A-6 r9 Major-2)", () => {
    // 並列経路でも CodeRabbit rate-limit 後に --profile= が欠落すると、PR-mode の
    // pseudo review が別 profile で走り chain が崩れる。
    expect(content).toMatch(
      /rate[\s-]?limit[\s\S]{0,300}?pseudo-coderabbit-loop[\s\S]{0,150}?--profile=/i,
    );
  });

  it("縮退モード (1 サブタスク) で /tdd-implement に --profile= を渡す (A-6 r9 Major-3)", () => {
    // `--max-parallel=1` や 1 サブタスク時も solo 相当で profile を揃えるべき。
    expect(content).toMatch(
      /(?:縮退|degraded|max-parallel=1|サブタスク[数\s]*=\s*1)[\s\S]{0,400}?tdd-implement[\s\S]{0,200}?--profile=/i,
    );
  });
});

describe("harness-work command の Task-tool プロンプト materialize (A-6 r8 Major-2)", () => {
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

describe("coderabbit-mimic agent の静的解析呼出安全性 (A-6 r5 Minor-3)", () => {
  const content = readAgent("coderabbit-mimic");

  it("ruff check 等の analyzer が空白入りパスで壊れない (xargs -0 / 分割安全)", () => {
    // `$(grep '.py$' files.txt)` のような unquoted command substitution を avoid し、
    // NULL 区切り (git diff -z) + xargs -0 に変えていること。
    expect(content).toMatch(/xargs\s+-0/);
    expect(content).toMatch(/git\s+diff\s+-z|-z\s+--name-only/);
  });

  it("origin/$BASE_BRANCH 不在時は検証済み fallback のみ許容、HEAD 空 diff は禁止 (A-6 r6 Minor-3 / r7 Major-7)", () => {
    // fetch 失敗・未取得 branch 環境で `git diff origin/$BASE_BRANCH..HEAD` が fatal 落ちしないよう、
    // rev-parse --verify による base ref 確認 + fallback を持つこと。
    expect(content).toMatch(/rev-parse\s+--verify[\s\S]{0,200}?origin\/\$BASE_BRANCH/);
    expect(content).toMatch(/BASE_REF[\s\S]{0,80}?(?:origin\/\$BASE_BRANCH|fallback)/);
    // r7 Major-7: `BASE_REF=HEAD` (空 diff fallback) は false-clear review を生むので禁止。
    // 検証済み ref が無ければ hard error (exit 1) が期待される。
    expect(content).not.toMatch(/BASE_REF\s*=\s*["']?HEAD["']?\s*$/m);
    expect(content).toMatch(/no valid base ref[\s\S]{0,200}?exit\s+1|exit\s+1[\s\S]{0,200}?(?:false-clear|base ref)/);
  });
});

describe("pseudo-coderabbit-loop command の $ARGUMENTS 取り込み (A-6 r6 Major-2 / r7 厳密化 / r8 Major-1)", () => {
  const content = readCommand("pseudo-coderabbit-loop");

  it("documented な slash-command 動的引数 $ARGUMENTS を実際に parse する", () => {
    // Arguments セクションに --profile / --worktree / pr-number を advertise していながら
    // Step 0 で受け取っていないと end-to-end で effectful にならない。
    expect(content).toMatch(/\$ARGUMENTS|\$\{ARGUMENTS\}/);
  });

  it("argv を配列化してから case 完全一致 (for tok in $ARGUMENTS は word splitting で壊れる、A-6 r7 Major-3)", () => {
    // bash の `for tok in $ARGUMENTS` は IFS 依存。`read -r -a TOKENS <<< "$ARGUMENTS"` 等で
    // 配列化してから `for tok in "${TOKENS[@]}"` で展開し、各要素を quote 保持する。
    expect(content).toMatch(
      /read\s+-r\s+-a\s+\w+[\s\S]{0,200}?<<<\s+"\$ARGUMENTS"|read\s+-ra\s+\w+[\s\S]{0,200}?<<<\s+"\$ARGUMENTS"/,
    );
  });

  it("--local flag が後段 (gh 呼出) を分岐する (A-6 r7 Major-4)", () => {
    // `CLI_LOCAL="yes"` を設定するだけで使われていないと pre-push mode / offline が機能しない。
    // gh CLI を叩く前に `[ -n "$CLI_LOCAL" ]` 等で分岐していること。
    expect(content).toMatch(/(?:\[\s+-n\s+"\$CLI_LOCAL"\s+\]|-z\s+"\$CLI_LOCAL"|CLI_LOCAL[\s\S]{0,50}?(?:then|\|\|))/);
  });

  it("positional PR 番号 CLI_PR を $PR に反映する (A-6 r7 Major-5)", () => {
    // `CLI_PR` に値を入れただけで `PR="..."` に反映しないと gh api /pulls/${PR} が空になる。
    expect(content).toMatch(/PR=\s*"?\$\{?CLI_PR:?-?\$?PR\}?"?|PR="\$CLI_PR"/);
  });

  it("MODE=\"pr\" で gh 呼出が実際に gate されている (A-6 r8 Major-1)", () => {
    // 変数定義だけで使われていないと GitHub API が無条件実行される。
    // Step 1 / Step 4 / Step 5 の gh api / gh pr コマンドが `$MODE` の検査で囲まれていること。
    const gateCount = (content.match(/if\s+\[\s+"?\$\{?MODE\}?"?\s+=\s+"pr"\s+\]/g) || []).length;
    expect(gateCount).toBeGreaterThanOrEqual(2);
  });
});

describe("coderabbit-mimic agent の一時ファイル隔離 (A-6 r3 Major-1 / r4 厳密化)", () => {
  const content = readAgent("coderabbit-mimic");

  it("WORKDIR=$(mktemp -d ...) 実体が shell で定義されている", () => {
    // A-6 r4 Trivial-5: prose の `mktemp -d` だけで pass しないよう shell 断片にアンカー。
    expect(content).toMatch(/WORKDIR\s*=\s*\$\(mktemp\s+-d/);
  });

  it("trap 'rm -rf \"$WORKDIR\"' EXIT で cleanup する", () => {
    expect(content).toMatch(/trap\s+['"]rm\s+-rf\s+"\$WORKDIR"['"]\s+EXIT/);
  });

  it("Codex プロンプトの heredoc は quoted + placeholder 置換方式で shell 展開を防ぐ (A-6 r4/r7 Major guard)", () => {
    // round 4 で unquoted heredoc に変えたが、round 7 で prompt 本文内の `$VAR` / `$(...)` が
    // shell で展開される security risk が指摘された。quoted heredoc に戻し、`$WORKDIR` は
    // `@@WORKDIR@@` のような sentinel に書き、後段で sed 置換する方式に統一する。
    const quotedHeredoc = /cat\s+>\s+"\$WORKDIR\/prompt\.md"\s+<<\s*'[A-Z_]+'/;
    expect(content).toMatch(quotedHeredoc);
    // placeholder 置換ステップが存在する
    expect(content).toMatch(/sed[\s\S]{0,200}?(?:@@WORKDIR@@|@WORKDIR@|<WORKDIR>)/);
  });
});

describe("coderabbit-mimic agent の JSON 妥当性検証 (A-6 r3 Minor-4)", () => {
  const content = readAgent("coderabbit-mimic");

  it("jq が無い環境でも JSON 検証できる fallback を持つ", () => {
    // jq / python3 / node のいずれかに degrade できる実装であること。
    expect(content).toMatch(/command\s+-v\s+jq[\s\S]{0,800}?(python3|node)/);
  });
});

describe("harness-work command の profile 読取り fallback (A-6 r3 Major-2 / r4 厳密化)", () => {
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

  it("stdlib fallback は quoted heredoc で bash エスケープ依存を排除 (A-6 r9 Major-5)", () => {
    // harness-work 側でも同じ regex / heredoc を使うため、同じ堅牢さを要求。
    expect(content).toMatch(/python3\s*<<\s*['"]?PYEOF['"]?|<<\s*['"]PYEOF['"]/);
  });

  it("Pre-flight で解決した $PROFILE が Phase 5.5 記述 + Skill handoff に接続される (A-6 r5 Major-1)", () => {
    // A-6 r5 Trivial: literal `PROFILE` を pass しないよう `$` を必須化。
    // 説明文 `--profile=$PROFILE` が存在する
    expect(content).toMatch(/--profile=\$\{?PROFILE\}?/);
    // Skill({...}) / Task の handoff args にも `--profile=...` が直列化される
    const skillHandoff = /Skill\([\s\S]{0,400}?(?:tdd-implement|parallel-worktree)[\s\S]{0,400}?--profile=\$\{?PROFILE\}?/;
    expect(content).toMatch(skillHandoff);
  });

  it("handoff 時は PROFILE 実値への materialize 責任を明示する (A-6 r6 Major-1)", () => {
    // Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` のみ保証。
    // `${PROFILE}` は undocumented なので、LLM が事前に実値に置換してから Skill を呼ぶ責任を明記。
    expect(content).toMatch(/materialize|実値[\s\S]{0,80}?(?:置換|埋め込)|literal[\s\S]{0,80}?(?:受け手|literal|そのまま|渡[さっす]?)/i);
  });

  it("Anthropic 公式の positional argument 表記は 0-based ($0 が第1引数、A-6 r10 Trivial-1 / r11 厳密化)", () => {
    // 旧: `$1..$N のみ保証` は 1-based 前提。残存を広いパターンで禁止。
    // 新: `$ARGUMENTS / $ARGUMENTS[N] / $N (0-based)` の公式表記に揃える。
    //
    // round 11 の Minor-1 指摘: backtick 付きや前置テキストを含む残存を見逃さないよう、
    // どこに `$1..$N` が出現しても FAIL する広いパターンに修正する。
    expect(content).not.toMatch(/\$1\s*\.\.\s*\$N/);
    // 公式仕様に則った 0-based 表記の説明があること
    expect(content).toMatch(/0-?based|\$0[\s\S]{0,100}?第\s*1|第\s*1[\s\S]{0,40}?\$0|\$ARGUMENTS\[N\]/);
  });

  it("handoff 例が少なくとも 1 つは実値 materialize 済み (A-6 r7 Minor-1)", () => {
    // 文面に「materialize」と書くだけで pass しないよう、実値埋込済み (chill/assertive/strict) の
    // Skill 呼出例が最低 1 つは存在することを assert。
    const materialized =
      /Skill\([\s\S]{0,500}?(?:tdd-implement|parallel-worktree)[\s\S]{0,500}?--profile=(?:chill|assertive|strict)(?!\w)/;
    expect(content).toMatch(materialized);
  });

  it("harness.config.json の profile key path が設定例と実装で一致 (A-6 r6 Minor-2)", () => {
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

  it("CLI --profile= 抽出が argv 単位の case 文で境界厳密 (A-6 r5 Minor-1 / r6 再厳密化)", () => {
    // r5 の `grep -oE -- '--profile=(chill|assertive|strict)'` は substring match のため
    // `--profile=strict1` を `--profile=strict` に誤抽出する (r6 Minor-1 指摘)。
    // argv を for-loop + case 文で 1 個ずつ完全一致比較するほうが確実。
    expect(content).toMatch(
      /for\s+tok\s+in[\s\S]{0,400}?case\s+"?\$tok"?\s+in[\s\S]{0,400}?--profile=chill\|--profile=assertive\|--profile=strict/,
    );
  });

  it("YAML 由来 profile を CodeRabbit 公式 allowlist (chill|assertive) で検証し、strict/typo は WARN + chill へ fallback (A-6 r5 Minor-2)", () => {
    // strict は harness-local extension であり、YAML 由来では採用しない方針を強制。
    expect(content).toMatch(
      /(?:allowlist|公式|chill\|assertive|chill.*assertive|chill".*"assertive)[\s\S]{0,400}?(?:WARN|警告|fallback|chill)/i,
    );
  });
});

describe("coderabbit-mimic agent の STDERR_LOG cleanup / 参照 (A-6 r2 Trivial-4)", () => {
  const content = readAgent("coderabbit-mimic");

  it("STDERR_LOG の参照方法または cleanup が明記されている", () => {
    // 分離した stderr ログが parse 失敗時のデバッグに使われる or 成功時に削除される
    // ことを示す記述 (rm / tail / 参照方法 / cleanup) が存在すること。
    const hasLifecycle = /STDERR_LOG[\s\S]{0,600}?(rm\s|tail\s|cleanup|削除|参照)/i;
    expect(content).toMatch(hasLifecycle);
  });
});

describe("worker agent の Co-Authored-By プレースホルダー (m-2)", () => {
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

describe("harness-setup check の expected 配列 (M-10)", () => {
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

describe("全 agent / command に frontmatter が存在する (A-6 round 2 Minor-3)", () => {
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

describe("coderabbit-review command の clear 判定 (A-6 r11 Major-1)", () => {
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

describe("severity 分類の整合 (M-2: security-auditor と coderabbit-mimic)", () => {
  const mimic = readAgent("coderabbit-mimic");
  const auditor = readAgent("security-auditor");

  // CodeRabbit 公式 taxonomy は 5 段階。trivial を必須化して 4 段階退行を検知可能にする
  // (Codex A-6 round 1 指摘 Minor-4 対応)。
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
