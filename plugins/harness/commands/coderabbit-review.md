---
name: coderabbit-review
description: "Watch for CodeRabbit reviews on a GitHub PR in the background and respond to the findings automatically. Use after pushing a PR when the user asks to handle the CodeRabbit review."
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"]
argument-hint: "<pr-number>"
---

# `/coderabbit-review` — CodeRabbit review loop (background watch + auto response)

Polls a GitHub PR for new CodeRabbit reviews in the background, so the
user is not blocked. When a review lands, a desktop notification fires
and the skill applies fixes to the actionable + nitpick comments, then
re-pushes and re-polls until the review clears.

## Test command resolution

When running tests after applying fixes, this skill picks, in order:

1. `harness.config.json:testCommand`
2. `npm test` if `package.json` exists
3. `pytest` if a Python project is detected
4. Otherwise skip with a warning (do not silently claim green)

## Workflow

### Step 1. Fetch PR metadata

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
PR=<pr-number>
gh pr view "$PR" --json headRefName,state --jq '{branch: .headRefName, state: .state}'
```

If the PR does not exist, stop.

### Step 2. Has CodeRabbit already reviewed the latest push?

```bash
PUSH_TIME=$(git log -1 --format=%cI)
LATEST=$(gh api repos/${REPO}/pulls/${PR}/reviews --jq \
  '[.[] | select(.user.login=="coderabbitai[bot]")] | .[-1] | {submitted_at, state}')
```

- If `submitted_at > PUSH_TIME` → go to Step 4 immediately.
- Otherwise → go to Step 2.5 (rate limit check) then Step 3 (background watch).

### Step 2.5. Rate limit detection (NEW)

CodeRabbit は rate limit に当たると以下の HTML marker をコメントに含める。

```bash
RATE_LIMITED=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | last | .createdAt // empty")

if [ -n "$RATE_LIMITED" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$RATE_LIMITED" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$RATE_LIMITED" +%s) ))
  # Pro プラン: 5 PR reviews/hour、rolling bucket で 12 分/1 単位 回復
  # 保守的に 15 分 cooldown
  if [ "$ELAPSED" -lt 900 ]; then
    WAIT=$(( 900 - ELAPSED ))
    echo "RATE_LIMITED_COOLDOWN=${WAIT}s"
    # オプション: `/pseudo-coderabbit-loop <pr>` に切替を提案
    # Codex 疑似レビューで時間を有効活用可能
    exit 0
  fi
fi
```

**Cooldown 中の推奨アクション**:
- `/pseudo-coderabbit-loop <pr-number>` を起動して Codex 疑似レビューで空き時間を活用
- Cooldown 経過後に自動再試行するか、手動で `/coderabbit-review <pr>` を再起動

### Step 3. Background watch

Run in background (`run_in_background: true`, `timeout: 600000`):

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
PR=<pr-number>
INITIAL=$(gh api repos/${REPO}/pulls/${PR}/reviews \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
for i in $(seq 1 20); do
  CURRENT=$(gh api repos/${REPO}/pulls/${PR}/reviews \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
  if [ "$CURRENT" -gt "$INITIAL" ] 2>/dev/null; then
    # Desktop notification (macOS / Linux)
    osascript -e "display notification \"CodeRabbit review arrived — PR #${PR}\" with title \"Claude Code\" sound name \"Glass\"" 2>/dev/null \
      || notify-send "Claude Code" "CodeRabbit review arrived — PR #${PR}" 2>/dev/null || true
    echo "REVIEW_ARRIVED"
    exit 0
  fi
  # NOTE: `gh pr checks` の CodeRabbit check 名は unstable (Step 7.5 参照) のため、
  # ここでは REVIEW_CLEAR を短絡判定しない。Clear 判定は Step 7 の 3 段判定
  # (APPROVED / unresolved=0 / rate-limit marker 不在) に一本化する。
  # 監視ループの責務は「新 review 到着の検出」のみ。
  sleep 30
done
echo "TIMEOUT"
```

Tell the user: *"Watching in the background (up to 10 min). You can
keep working — a notification will fire when the review arrives."*

Background result routing:

- `REVIEW_ARRIVED` → Step 4 (parse the review) → Step 7 (Clear 3 段判定)
- `TIMEOUT`        → report, suggest re-running the skill (Clear 判定は Step 7 が行う)

### Step 4. Parse the review

```bash
gh api repos/${REPO}/pulls/${PR}/reviews --jq '.[-1].body'
```

Extract:

- **Actionable comments** — must be addressed
- **Nitpick comments** — recommended
- **Additional comments** — informational

If all three are 0 → Step 7.

### Step 5. Apply fixes

For each finding:

1. Locate the file + line.
2. Fix the **implementation**, not the test. Never rewrite a failing
   test to match the code.
3. Run the resolved test command; confirm green before proceeding.

### Step 6. Commit + push + re-watch

```bash
git add <files>
git commit -m "fix: address CodeRabbit findings

- <item 1>
- <item 2>"
git push origin "$(git branch --show-current)"
```

Return to Step 3 and wait for the next review cycle.

### Step 7. Confirm the review is clear (STRENGTHENED)

CodeRabbit は「クリア」を明示しない傾向にある (Codex 公式 docs 調査済)。以下 3 つのシグナルで **明示的に clear 判定**:

#### 7.1 最強シグナル: `reviews[-1].state == APPROVED`

`request_changes_workflow: true` (default) のとき、unresolved comments 0 + pre-merge checks OK で自動 `APPROVED` に遷移する。

```bash
CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .state // empty')

if [ "$CR_STATE" = "APPROVED" ]; then
  CLEAR=true
fi
```

#### 7.2 中シグナル: unresolved CodeRabbit thread == 0

APPROVED にならない (例: `request_changes_workflow: false` 設定) 場合、未解決 thread 数で判定。

```bash
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
```

#### 7.3 阻害要因の否定: rate-limited / paused marker なし

```bash
# 最新 CodeRabbit コメントに rate-limited / paused marker が残っていないこと
RECENT_BLOCKER=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
    | select(.body | contains(\"rate limited\") or contains(\"Reviews paused\"))] | last | .createdAt // empty")
if [ -n "$RECENT_BLOCKER" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$RECENT_BLOCKER" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$RECENT_BLOCKER" +%s) ))
  if [ "$ELAPSED" -lt 900 ]; then
    # 15 分以内なら blocker active、clear 判定不可
    CLEAR=false
    CLEAR_SOFT=false
  fi
fi
```

#### 7.4 判定マトリクス

| CLEAR (strong) | CLEAR_SOFT | blocker | 結果 |
|---|---|---|---|
| true | — | — | **完全 clear** → Step 8 |
| — | true | false | **ソフト clear** → Step 8 (ユーザーに APPROVED でない旨通知) |
| false | false | — | **未 clear** → Step 4 に戻って finding 再対応 |
| — | — | true | **blocker 中** → `/pseudo-coderabbit-loop` に切替提案、または cooldown 待機 |

#### 7.5 依存しないシグナル (DO NOT USE)

以下は CodeRabbit 公式 docs で確認できない、または不安定なため本 skill では使わない:

- `gh pr checks` の `CodeRabbit` check 名（安定しない）
- `"approved by coderabbit.ai"` HTML marker（非公式）
- `"LGTM"` / `"No further actionable"` テンプレート文言（現行 public docs 未確認）

### Step 8. Final polish

Remove AI-shaped noise that would not survive a careful human reviewer:

- Unnecessary comments
- Overly defensive `try` / `catch` that masks real errors
- Formatting drifts

```bash
git diff main..HEAD --name-only
```

If cleanup produces a diff, commit + push + return to Step 3 once more.

### Step 9. Final report

```
## CodeRabbit final status

| Phase             | Status |
|-------------------|--------|
| Review handling   | ✅ |
| AI-slop removal   | ✅ |
| Final review      | ✅ |

Result: all phases complete.
```

## Done criteria

- Latest CodeRabbit review `state == APPROVED` OR unresolved bot threads == 0
- No active `rate limited` / `Reviews paused` marker (within last 15 min)
- Latest review: **Actionable = 0**, **Nitpick = 0** (profile-adjusted)
- AI-slop removal pass done
- Final review pass clear
- User notified

## 関連スキル

- `/pseudo-coderabbit-loop` — Codex 疑似 CodeRabbit で内部ループを回して rate limit を回避。push 前品質担保 / rate-limited 中の代替レビュー / Codex × CodeRabbit 反復ループに使う
- `coderabbit-mimic` agent — 疑似 CodeRabbit の実装、Codex CLI に CodeRabbit 風プロンプトを投げる read-only agent
- `/codex-team` — Codex を team member として呼ぶ基本スキル
