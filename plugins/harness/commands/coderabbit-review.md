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
- Otherwise → go to Step 3 (background watch).

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
  # CodeRabbit's "pass" check means the review cleared
  STATUS=$(gh pr checks "$PR" 2>/dev/null | grep -i "coderabbit" | awk '{print $2}')
  if [ "$STATUS" = "pass" ]; then
    echo "REVIEW_CLEAR"
    exit 0
  fi
  sleep 30
done
echo "TIMEOUT"
```

Tell the user: *"Watching in the background (up to 10 min). You can
keep working — a notification will fire when the review arrives."*

Background result routing:

- `REVIEW_ARRIVED` → Step 4
- `REVIEW_CLEAR`   → Step 7
- `TIMEOUT`        → report, suggest re-running the skill

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

### Step 7. Confirm the review is clear

```bash
gh api repos/${REPO}/pulls/${PR}/reviews --jq \
  '[.[] | {submitted_at, state, user: .user.login}]'
gh api repos/${REPO}/pulls/${PR}/comments --jq \
  '[.[] | select(.in_reply_to_id == null) | {path, body, created_at}]'
```

No open actionable or nitpick comments should remain.

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

- Latest review: **Actionable = 0**, **Nitpick = 0**
- AI-slop removal pass done
- Final review pass clear
- User notified
