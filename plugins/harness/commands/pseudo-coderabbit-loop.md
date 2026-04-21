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
3. **Codex を CodeRabbit に近づける**: プロファイル別（chill/assertive/strict）、Review types (`potential_issue` / `refactor_suggestion` / `nitpick`) と Severity (`critical` / `major` / `minor` / `trivial` / `info`) の公式 taxonomy に忠実
4. **worktree 並列開発対応**: `--worktree=<path>` で任意 worktree 内で実行可能

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
WORKTREE="${WORKTREE:-$(git rev-parse --show-toplevel)}"
cd "$WORKTREE"
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
HEAD_BRANCH=$(git branch --show-current)
BASE_BRANCH=$(git config --get "branch.${HEAD_BRANCH}.merge" | sed 's|refs/heads/||' || echo "main")

# .coderabbit.yaml から profile を取得（なければ chill）
if [ -f .coderabbit.yaml ]; then
  PROFILE=$(yq '.reviews.profile // "chill"' .coderabbit.yaml 2>/dev/null \
    || python3 -c "import yaml,sys; d=yaml.safe_load(open('.coderabbit.yaml')); print(d.get('reviews',{}).get('profile','chill'))" 2>/dev/null \
    || echo "chill")
else
  PROFILE="chill"
fi
# ARGS で上書きがあればそれを優先
```

### Step 1. CodeRabbit 状態確認（PR mode のみ）

PR 番号が渡された場合、まず CodeRabbit 側の状態を取得。

#### 1.1 Clear 判定（3 段階）

```bash
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
```

**判定**:
- `CLEAR_STRONG=true` → 完全 clear、Step 6 へ
- `CLEAR_SOFT=true AND RATE_LIMIT_ACTIVE=0` → ほぼ clear、Step 5 (final polish) へ
- `RATE_LIMIT_ACTIVE>0` かつ最新 marker から 15 分以内 → rate-limited mode に切替 (Step 2 の Codex 疑似レビューを実行)
- それ以外 → 通常の review loop へ

#### 1.2 最新レビュー取得

`APPROVED` でなく `COMMENTED` / `CHANGES_REQUESTED` が出ている場合は body を parse し、Actionable / Nitpick / Outside-diff を抽出。

```bash
LATEST_REVIEW_BODY=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .body')
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
- `nitpick` (profile が `strict` の場合のみ) → 軽量修正 or 却下コメント
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
if [ -n "$LATEST_RATE_LIMIT_TS" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$LATEST_RATE_LIMIT_TS" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$LATEST_RATE_LIMIT_TS" +%s) ))
  if [ "$ELAPSED" -lt 900 ]; then
    WAIT=$(( 900 - ELAPSED ))
    echo "Rate limit cooldown: wait ${WAIT}s before triggering"
    # オプション: Monitor で待機、または即手動トリガー試行
  fi
fi

# 手動レビュートリガー (rate-limited 解除後、または通常の push 後追加トリガー用)
gh pr comment "$PR" --repo "$REPO" --body "@coderabbitai review

Pseudo CodeRabbit loop (profile=${PROFILE}) が clean を確認しました。本物 CodeRabbit の最終レビューをお願いします。"
```

**注意**: 手動トリガーも rate limit bucket を消費する（Codex 調査で確認）。push 直後の自動レビューで足りる場合は skip。

### Step 5. CodeRabbit レビュー監視

`/coderabbit-review` skill を呼び出すか、内部で Monitor を使って reviews[] の count 増加を監視:

```bash
INITIAL=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq "[.[] | select(.user.login==\"coderabbitai[bot]\")] | length")
# Monitor tool を使うか、polling loop を回して変化を検出
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
