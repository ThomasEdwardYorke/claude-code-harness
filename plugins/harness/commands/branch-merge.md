---
name: branch-merge
description: "Merge a feature branch through dev into main, running the project's test suite at every stage. Use when a PR review is clean or the user asks to merge / ship / reflect to main."
allowed-tools: ["Read", "Bash"]
argument-hint: "(no arguments — operates on the current feature branch)"
---

# `/branch-merge` — feature → dev → main merge workflow

Drives the standard `feature/* → dev → main` merge path. Runs the
project's configured test command on `dev` before promoting to `main`,
and re-syncs `dev` with `main` after the release.

## Preconditions

- The current branch is `feature/*`.
- The working tree is clean.

```bash
git branch --show-current
git status
```

## Test command resolution

This skill runs the project's test suite at two points (on `dev` after
the first merge, and on `main` after the final merge). It picks the
command in the following order:

1. `harness.config.json:testCommand` if set
2. `npm test` if `package.json` exists
3. `pytest` if a `pytest.ini` / `pyproject.toml` / `tests/` is present
4. Otherwise, skip with a warning

## Workflow

### 1. feature → dev

```bash
git fetch origin
git checkout dev
git pull origin dev
git merge origin/<feature-branch> --no-ff -m "Merge <feature-branch> into dev"
git push origin dev
```

On conflict, stop and report to the user.

### 2. Run tests on dev

Run the resolved test command. Do NOT merge to `main` if any test fails.

| Result | Action |
|--------|--------|
| All tests pass | Continue to step 3 |
| Tests fail | Stop, report failures to the user |
| Environment error | Print setup hint (`npm install`, `pip install -r requirements.txt`, …) |

### 3. dev → main

```bash
git checkout main
git pull origin main
git merge dev --no-ff -m "Merge dev into main: <summary>"
git push origin main
```

### 4. Re-sync dev with main (important)

After shipping, fast-forward `dev` onto `main` so the next feature branch
starts from a coherent base.

```bash
git checkout dev
git merge main --ff-only
git push origin dev
```

If `--ff-only` fails, `main` has diverged from `dev` — stop and
investigate, do not overwrite.

### 5. Verify on main

```bash
git checkout main
git pull origin main
# run the resolved test command again
```

### 6. Clean up the feature branch (user confirmation)

Ask the user before deleting. After approval:

```bash
git push origin --delete <feature-branch>
git branch -d <feature-branch>
git fetch --prune
```

### 7. Final report

```
## Merge complete

| Stage            | Status |
|------------------|--------|
| feature → dev    | ✅ |
| tests on dev     | ✅ (<N> passed) |
| dev → main       | ✅ |
| dev re-sync      | ✅ (ff from main) |
| tests on main    | ✅ |
| branch cleanup   | ✅ / skipped |

Final commit: <commit-hash>
```

## Error handling

| Error | Handling |
|-------|----------|
| Merge conflict | `git status`, escalate to the user |
| Test failure | Stop, fix on the feature branch, retry |
| Push rejected | `git pull --rebase`, retry |
| Permission denied | Ask the user to verify repository permissions |
| `--ff-only` fails during re-sync | Possible direct commit to `main` — investigate |

## Safety

- Never commit directly to `main`.
- Never merge to `main` when tests fail.
- Never use `--force` without explicit user consent.
- Confirm with the user before deleting branches.
