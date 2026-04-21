---
name: pseudo-coderabbit-loop
description: "Codex による疑似 CodeRabbit レビューを内部ループで回し、本物 CodeRabbit へは絞り込んだ状態で push する統合スキル。CodeRabbit の rate limit (Pro: 5/h) を回避しつつレビュー品質を維持する。Use after implementing a feature, before requesting real CodeRabbit review, especially in parallel worktree workflows. Also used to resume a loop when CodeRabbit is rate-limited."
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "Task"]
argument-hint: "[pr-number|--local] [--profile=chill|assertive|strict] [--worktree=<path>]"
---

# `/pseudo-coderabbit-loop` — Codex 疑似 CodeRabbit → 本物 CodeRabbit の反復ループ

**目的**: CodeRabbit の rate limit (Pro プラン 5 PR reviews/hour、5 件/時) に縛られずにレビュー品質を確保する。Codex を「CodeRabbit の疑似 reviewer」として動員し、push 前に内部 loop で指摘を刈り取り、CodeRabbit には仕上がった状態だけを投げる。

**本スキルの価値**:
1. **Rate limit 耐性**: Codex pseudo review は hourly 制限なし、worktree 並列開発でも止まらない
2. **Clear 状態の明示判定**: `reviews[].state == APPROVED` + unresolved thread 0 + rate-limit marker 不在を組み合わせて「CodeRabbit がクリアした」を確定判定（本家 CodeRabbit はクリアを明示しない傾向）
3. **Codex を CodeRabbit に近づける**: CodeRabbit 公式 profile (`chill` / `assertive`) に加えて `strict` を harness-local 拡張として提供 (詳細下記)。Review types (`potential_issue` / `refactor_suggestion` / `nitpick`) と Severity (`critical` / `major` / `minor` / `trivial` / `info`) の公式 taxonomy に忠実
4. **worktree 並列開発対応**: `--worktree=<path>` で任意 worktree 内で実行可能

### Profile values の出所

- `chill` / `assertive` — **CodeRabbit 公式 profile** (https://docs.coderabbit.ai/reference/configuration、`reviews.profile` の定義値は 2026-04 時点でこの 2 つのみ)
- `strict` — **harness-local extension**。CodeRabbit 公式には存在せず、本 Codex 疑似 reviewer だけが理解する拡張モード。nitpick まで拾い、上限を 10 件まで広げる。`.coderabbit.yaml` に `profile: strict` を書いても **本物 CodeRabbit 側は無視する** (未知値として chill に fallback されるか error の可能性がある)。ローカル厳格レビューを望むときだけ `--profile=strict` で利用すること。

---

## Modes

| Mode | 起動引数 | 用途 |
|---|---|---|
| `pre-push` | `--local` | push 前に Codex で内部レビュー → clean なら user に push 指示 |
| `rate-limited` | `<pr-number>` (CodeRabbit marker 検知時) | CodeRabbit が rate-limited 中に Codex で代替レビュー → 復帰後に本物レビュー |
| `full-loop` | `<pr-number>` (既存 PR) | 本物 CodeRabbit の前後に Codex pseudo review を挟む full cycle |

引数なしで起動された場合は `--local` (pre-push mode) として扱う。

---

## Arguments

```
/pseudo-coderabbit-loop [pr-number|--local] [--profile=...] [--worktree=...]
```

- `pr-number`: 既存 PR 番号 (例: `8`)。`--local` なら未 push 状態を対象
- `--profile=chill|assertive|strict`: Codex に適用する profile (未指定なら `.coderabbit.yaml` の `reviews.profile` を読む、fallback は `chill`)
- `--worktree=<path>`: 対象の worktree 絶対パス (未指定なら `git rev-parse --show-toplevel` の結果)

---

## 前提 (harness.config.json 推奨設定)

```json
{
  "codeRabbit": {
    "botLogin": "coderabbitai",
    "ratelimitCheckWindowMinutes": 15,
    "approvedStateAsClear": true,
    "maxPseudoLoopIterations": 5,
    "analyzerTimeoutSeconds": 120
  }
}
```

設定がなくてもデフォルト値で動く。プロジェクト固有の閾値調整に使う。

---

## Workflow

### Step 0. コンテキスト確定

```bash
# Anthropic 公式 slash command の動的置換 $ARGUMENTS を argv 配列に読み込んで parse。
# `for tok in $ARGUMENTS` だと bash の word splitting が IFS 依存で fragile になるため、
# `read -r -a TOKENS` で配列化してから `for tok in "${TOKENS[@]}"` で quote 保持展開する。
# 制限: `--worktree="my dir"` のように空白を含む値は shell の事前分割で壊れるため未サポート。
read -r -a TOKENS <<< "$ARGUMENTS"
CLI_PROFILE=""
CLI_WORKTREE=""
CLI_LOCAL=""
CLI_PR=""
for tok in "${TOKENS[@]}"; do
  case "$tok" in
    --profile=chill|--profile=assertive|--profile=strict)
      CLI_PROFILE="${tok#--profile=}"
      ;;
    --profile=*)
      echo "WARN: invalid --profile='${tok#--profile=}' (must be chill|assertive|strict); ignored" >&2
      ;;
    --worktree=*)
      CLI_WORKTREE="${tok#--worktree=}"
      ;;
    --local)
      CLI_LOCAL="yes"
      ;;
    [0-9]*)
      # positional: PR 番号 (数字始まり)
      CLI_PR="$tok"
      ;;
  esac
done

WORKTREE="${CLI_WORKTREE:-${WORKTREE:-$(git rev-parse --show-toplevel)}}"
cd "$WORKTREE"
HEAD_BRANCH=$(git branch --show-current)

# BASE_BRANCH fallback:
# `git config ... | sed ... || echo main` では sed が exit 0 で返すため `||` が発火せず
# BASE_BRANCH が空文字になる (A-6 r9 Major-6)。別段で取得 + `:-main` 空チェックで確実に既定値を入れる。
RAW_MERGE=$(git config --get "branch.${HEAD_BRANCH}.merge" 2>/dev/null || true)
BASE_BRANCH="${RAW_MERGE#refs/heads/}"
BASE_BRANCH="${BASE_BRANCH:-main}"

# PR number を CLI_PR から反映 (A-6 r7 Major-5): CLI_PR > 既存 PR env
PR="${CLI_PR:-$PR}"

# Mode 判定: --local 明示 or PR 未指定なら local mode で GitHub API を使わない (A-6 r7 Major-4)。
if [ -n "$CLI_LOCAL" ] || [ -z "$PR" ]; then
  MODE="local"
  REPO=""
  echo "Mode: local (--local flag or no PR number); GitHub API disabled"
else
  MODE="pr"
  REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
  echo "Mode: pr (PR=$PR REPO=$REPO)"
fi

# .coderabbit.yaml から profile を取得する。3 段フォールバック構成:
#   1. yq (最も信頼性が高い YAML parser、存在すれば優先)
#   2. python3 + PyYAML (pip 導入済なら高精度)
#   3. python3 stdlib 限定の正規表現 (reviews: block 配下の profile: を素朴に抽出)
# いずれも失敗した場合は **silent に chill に落とさず WARN を stderr に出力** してから
# 'chill' を採用する (assertive/strict が設定された repo で cooldown/上限が縮退する
# 事故を検知可能にする)。
PROFILE=""
if [ -f .coderabbit.yaml ]; then
  if command -v yq >/dev/null 2>&1; then
    PROFILE=$(yq '.reviews.profile // ""' .coderabbit.yaml 2>/dev/null || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    PROFILE=$(python3 -c "
import yaml
d = yaml.safe_load(open('.coderabbit.yaml'))
print(d.get('reviews', {}).get('profile', '') if isinstance(d, dict) else '')
" 2>/dev/null || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    # stdlib 限定: reviews: 直下のインデントに一致する profile: のみ許可。
    # 深い階層 (reviews.labels.profile 等) を誤読しないよう first_indent で制約。
    # 値の後続は inline YAML comment `# ...` を許容し、`profile: assertive  # note` を拾える。
    # quoted heredoc `<<'PYEOF'` で bash エスケープ依存を排除 (A-6 r9 Major-4)。
    PROFILE=$(python3 <<'PYEOF' 2>/dev/null || true
import re
try:
    text = open('.coderabbit.yaml').read()
    m = re.search(r'^reviews\s*:\s*\n((?:[ \t]+.*\n?)+)', text, re.MULTILINE)
    if m:
        block = m.group(1)
        first_indent = re.match(r'^([ \t]+)', block)
        if first_indent:
            indent = first_indent.group(1)
            pattern = r'^' + re.escape(indent) + r'profile\s*:\s*["\']?(\w+)["\']?(?:\s+#.*)?\s*$'
            p = re.search(pattern, block, re.MULTILINE)
            if p:
                print(p.group(1))
except Exception:
    pass
PYEOF
)
  fi
  if [ -z "$PROFILE" ]; then
    echo "WARN: .coderabbit.yaml exists but profile could not be parsed (yq / PyYAML / stdlib regex all failed). Falling back to 'chill'." >&2
    PROFILE="chill"
  fi
else
  PROFILE="chill"
fi

# YAML 由来 profile は CodeRabbit 公式 allowlist (chill / assertive) のみ許可。
# strict は harness-local extension のため YAML 経路では採用せず、WARN + chill に倒す。
# (公式 schema: https://docs.coderabbit.ai/reference/configuration は 2026-04 時点で
# reviews.profile = chill | assertive のみ)
if [ "$PROFILE" != "chill" ] && [ "$PROFILE" != "assertive" ]; then
  echo "WARN: .coderabbit.yaml profile='$PROFILE' is outside CodeRabbit official allowlist (chill / assertive); fallback to 'chill' (use --profile=strict on the command line for the harness-local extension)" >&2
  PROFILE="chill"
fi

# CLI 経由は strict 含めて許可 (harness-local 拡張)。CLI > yaml の precedence を適用。
PROFILE="${CLI_PROFILE:-$PROFILE}"
echo "Resolved profile (CLI > yaml > chill): $PROFILE"
```

### Step 1. CodeRabbit 状態確認（PR mode のみ）

PR 番号が渡された場合、まず CodeRabbit 側の状態を取得。

**このセクション (Step 1 全体) は PR mode (`MODE="pr"`) 専用**。`MODE="local"` の場合は Step 2 へ直接進み、`gh` 呼出は一切行わない (GitHub API off-load、offline 環境対応)。

#### 1.1 Clear 判定（3 段階）

以下のコードブロックは `if [ "$MODE" = "pr" ]; then ... fi` で gate されている前提で書かれている。`MODE="local"` では skip される。

```bash
if [ "$MODE" = "pr" ]; then
# 最強シグナル: reviews[-1].state == APPROVED
CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .state // empty')
[ "$CR_STATE" = "APPROVED" ] && CLEAR_STRONG=true

# 中シグナル: unresolved CodeRabbit threads == 0
UNRESOLVED=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $pr: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 1) { nodes { author { login } } }
          }
        }
      }
    }
  }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.comments.nodes[0].author.login == "coderabbitai")
    | select(.isResolved == false)] | length')
[ "$UNRESOLVED" = "0" ] && CLEAR_SOFT=true

# Rate limit marker 検出（妨害要因）
RATE_LIMIT_ACTIVE=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | length")
if [ "$RATE_LIMIT_ACTIVE" -gt 0 ]; then
  LATEST_RATE_LIMIT_TS=$(gh pr view "$PR" --repo "$REPO" --json comments \
    --jq "[.comments[] | select(.author.login == \"coderabbitai\")
           | select(.body | contains(\"rate limited by coderabbit.ai\"))] | last | .createdAt")
fi
fi  # end MODE=="pr" gate for Step 1.1
```

**判定**:
- `CLEAR_STRONG=true` → 完全 clear、Step 6 へ
- `CLEAR_SOFT=true AND RATE_LIMIT_ACTIVE=0` → ほぼ clear、Step 5 (final polish) へ
- `RATE_LIMIT_ACTIVE>0` かつ最新 marker から 15 分以内 → rate-limited mode に切替 (Step 2 の Codex 疑似レビューを実行)
- それ以外 → 通常の review loop へ

#### 1.2 最新レビュー取得

`APPROVED` でなく `COMMENTED` / `CHANGES_REQUESTED` が出ている場合は body を parse し、Actionable / Nitpick / Outside-diff を抽出。

```bash
if [ "$MODE" = "pr" ]; then
  LATEST_REVIEW_BODY=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .body')
fi  # Step 1.2 is PR-mode only
```

### Step 2. Codex 疑似レビュー実行

`coderabbit-mimic` agent を Task tool で呼び出し。入力:

```json
{
  "repo_root": "<WORKTREE>",
  "base_branch": "<BASE_BRANCH>",
  "head_branch": "<HEAD_BRANCH>",
  "profile": "<PROFILE>",
  "path_instructions": "<.coderabbit.yaml の path_instructions 全部>",
  "project_rules_files": ["CLAUDE.md", "AGENTS.md", ".claude/rules/*.md"],
  "coderabbit_feedback": "<LATEST_REVIEW_BODY if exists else null>",
  "previous_findings_hash": "<前回の Step 2 出力ハッシュ if exists>"
}
```

返り値: findings の JSON (coderabbit-mimic の output 仕様参照)。

### Step 3. Findings 対応

#### 3.1 優先度別処理

- `actionable=true` (severity >= major or critical category of minor) → 必ず修正
- `nitpick` (profile が `assertive` または `strict` の場合) → 軽量修正 or 却下コメント。CodeRabbit 公式 `reviews.profile` は `assertive` mode で nitpick を出す動作 (https://docs.coderabbit.ai/reference/configuration)。`strict` は harness-local 拡張として nitpick 上限のみ強化する。
- `outside_diff` → 呼出元にユーザー判断を仰ぐ（diff 外変更は scope 外の可能性）

#### 3.2 修正実行

単発タスクなら direct edit、複数ならば `harness:worker` agent または `/tdd-implement` を呼び出して修正適用。

- **TDD 規約を守る**: tests 先に、実装後。
- **各修正に意味単位 commit**。HEREDOC でメッセージ記述、末尾に `Co-Authored-By` を忘れない。
- **push は modeによる**:
  - `pre-push` mode: push しない（user に最終確認してもらう）
  - `rate-limited` / `full-loop` mode: `git push` まで実施

#### 3.3 Pseudo re-review

同じ `coderabbit-mimic` agent を再実行。`previous_findings_hash` を渡して重複 suppressing。

`clear=true`（actionable 0 + profile 上限内 nitpick 0）になるまで最大 `maxPseudoLoopIterations` 回 (default 5) 反復。

### Step 4. 本物 CodeRabbit トリガー

`full-loop` / `rate-limited` mode で、pseudo review clean になった後:

```bash
# Rate limit marker から 15 分経過しているか
# GNU `date -d` / BSD `date -j -f` のどちらにも依存せず、
# python3 datetime.fromisoformat で ISO 8601 を解釈 (macOS/Linux 双方で動作)。
# python3 が不在 or parse 失敗時は silent に ELAPSED>=900 (cooldown 即時解除) へ
# 落とさず、安全側として cooldown を強制 (ELAPSED=0) する。
if [ -n "$LATEST_RATE_LIMIT_TS" ]; then
  PAST_TS=""
  if command -v python3 >/dev/null 2>&1; then
    PAST_TS=$(python3 -c '
import sys
from datetime import datetime, timezone
s = sys.argv[1]
if s.endswith("Z"):
    s = s[:-1] + "+00:00"
try:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    print(int(dt.timestamp()))
except Exception:
    pass
' "$LATEST_RATE_LIMIT_TS" 2>/dev/null || true)
  fi
  if [ -z "$PAST_TS" ] || [ "$PAST_TS" = "0" ]; then
    # python3 が command -v で見つからない / ISO8601 parse 失敗 → 保守的に full cooldown を強制
    echo "WARN: rate-limit cooldown forced (python3 unavailable or ISO8601 parse failed for '$LATEST_RATE_LIMIT_TS')" >&2
    ELAPSED=0
  else
    ELAPSED=$(( $(date -u +%s) - PAST_TS ))
  fi
  if [ "$ELAPSED" -lt 900 ]; then
    WAIT=$(( 900 - ELAPSED ))
    echo "Rate limit cooldown: wait ${WAIT}s before triggering"
    # オプション: Monitor で待機、または即手動トリガー試行
  fi
fi

# 手動レビュートリガー (rate-limited 解除後、または通常の push 後追加トリガー用)
if [ "$MODE" = "pr" ]; then
  gh pr comment "$PR" --repo "$REPO" --body "@coderabbitai review

Pseudo CodeRabbit loop (profile=${PROFILE}) が clean を確認しました。本物 CodeRabbit の最終レビューをお願いします。"
fi  # Step 4 trigger is PR-mode only
```

**注意**: 手動トリガーも rate limit bucket を消費する（Codex 調査で確認）。push 直後の自動レビューで足りる場合は skip。

### Step 5. CodeRabbit レビュー監視

`/coderabbit-review` skill を呼び出すか、内部で Monitor を使って reviews[] の count 増加を監視:

```bash
if [ "$MODE" = "pr" ]; then
  INITIAL=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
    --jq "[.[] | select(.user.login==\"coderabbitai[bot]\")] | length")
  # Monitor tool を使うか、polling loop を回して変化を検出
fi  # Step 5 polling is PR-mode only (local mode returns after pseudo loop)
```

新 review 到着 → Step 1.1 の Clear 判定を再実行。
- `CLEAR_STRONG=true` → Step 6 へ
- `COMMENTED`/`CHANGES_REQUESTED` で Actionable あり → Step 2 (pseudo review に学習 feedback として CodeRabbit body を渡す) → Step 3 → Step 4 → Step 5 へ

### Step 6. 完了報告

```
## /pseudo-coderabbit-loop 結果

| Phase | Status |
|-------|--------|
| Pseudo review iterations | N 回 |
| Real CodeRabbit reviews | M 回 |
| Final clear signal | APPROVED / unresolved=0 |
| Rate limit events | X 回検出 |

- Final commit: <sha>
- Findings resolved: <count>
- Findings rejected (with justification): <count>

Loop complete. PR is ready for human review.
```

---

## Parallel worktree 運用

複数 leaf worktree で並列開発している場合、各 worktree で独立に `/pseudo-coderabbit-loop --worktree=<path> --local` を走らせて、各 PR の push 前品質を担保する。`--local` なら GitHub API を叩かないので完全オフライン実行が可能。

push 後は `/pseudo-coderabbit-loop <pr-number> --worktree=<path>` に切り替え、本物 CodeRabbit の rate limit を考慮しながら loop を回す。

---

## CodeRabbit が「クリア」を明示しない問題への対応

CodeRabbit は Actionable 0 + Nitpick 0 の review body で「approved」や「LGTM」を必ず出すわけではない (Codex 調査で確認)。本スキルは以下の優先順位で **明示的に clear を判定**:

1. `reviews[-1].state == "APPROVED"` (`request_changes_workflow: true` 時、最強)
2. `unresolved CodeRabbit review threads == 0`
3. `rate-limited marker` が最新状態にない（15 分以内のものがない）
4. Summary/walkthrough コメントが最新 commit 以降に更新されている

**依存しない signal**:
- `gh pr checks` の CodeRabbit check 名（不安定、ドキュメント化されていない）
- `"approved by coderabbit.ai"` のような非公式 HTML marker
- "LGTM" / "No further actionable" のテンプレート文言（現行 public docs で確認できない）

---

## エラーハンドリング

### Codex CLI が使えない
`codex --version` が失敗したら、Codex pseudo review を skip して従来の `/coderabbit-review` にフォールバック。その旨をユーザーに通知。

### `.coderabbit.yaml` がない
`profile=chill` / `path_instructions=[]` でフォールバック実行。ただし project 品質規則は低下する旨を警告。

### Codex 疑似レビューが発散（iteration cap 到達）
`maxPseudoLoopIterations` に達したら停止し、残 findings をユーザーに提示。ユーザー判断で: (a) 更に手動修正 (b) 本物 CodeRabbit に escalate (c) Phase N 送り。

### CodeRabbit が長時間応答しない
Rate limit marker が無いにも関わらず 10 分以上新 review なし → 再 nudge (`@coderabbitai review`)。更に 10 分応答なし → ユーザーに判断仰ぐ（merge 進行 or 待機継続）。

---

## 参照

- `coderabbit-mimic` agent (`agents/coderabbit-mimic.md`)
- `/coderabbit-review` (`commands/coderabbit-review.md`) — 従来版、reviews[] polling は本スキルからも呼ぶ
- `/codex-team` (`commands/codex-team.md`) — Codex CLI 呼出の基本
- CodeRabbit docs: https://docs.coderabbit.ai/
- GitHub PR reviews API: https://docs.github.com/en/rest/pulls/reviews

---

## プロジェクト固有の適用方法

本スキルは project-agnostic。プロジェクトは以下をカスタマイズして適用:

1. `.coderabbit.yaml` を repo に置く（`path_instructions` / `reviews.profile` / `tools.*.enabled`）
2. `harness.config.json` で閾値調整（optional）
3. `.claude/rules/coderabbit-loop.md` 等でプロジェクト固有の却下技術一覧を明文化（ex: 本プロジェクトでは `react-tabulator` 採用提案を却下）
4. `CLAUDE.md` / `AGENTS.md` に project rules を書く（Codex pseudo reviewer がこれを読んで判断に使う）
