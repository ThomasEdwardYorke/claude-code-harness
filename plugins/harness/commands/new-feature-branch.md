---
name: new-feature-branch
description: "Create a new feature branch from `dev`, after verifying that `main` and `dev` are in a healthy relationship. Use when the user asks to start a new piece of work or requests a branch."
allowed-tools: ["Read", "Bash"]
argument-hint: "<branch-name>"
---

# `/new-feature-branch` — open a new feature branch correctly

Starts a new piece of work on a `feature/<name>` branch, verifying the
`main` ↔ `dev` relationship first so later merges are deterministic.

## Branch model

```
feature/* → dev → main
```

- `main` — release branch (stable)
- `dev`  — integration branch
- `feature/*` — work branch

Invariants:

- `dev` is at or ahead of `main`
- `main` never leads `dev` under normal operation
- Never commit directly to `dev`

## Workflow

### 1. Working-tree check

```bash
git status
```

If there are uncommitted changes, ask the user to commit or stash.

### 2. Fetch (not pull)

```bash
git fetch origin
```

### 3. Compare remote `main` and `dev`

```bash
# commits on main that are not on dev
git log origin/dev..origin/main --oneline
# commits on dev that are not on main
git log origin/main..origin/dev --oneline
```

| main→dev | dev→main | State | Action |
|----------|----------|-------|--------|
| none | none | ✅ in sync | go to step 4 |
| none | yes | ⚠️ dev ahead | ask user whether to ship first |
| yes  | none | ⚠️ main ahead | re-sync dev first (see 3b) |
| yes  | yes  | ❌ diverged | stop and report (3c) |

#### 3a. `dev` ahead of `main`

Ask the user whether they want to ship `dev → main` first. If not,
continue from the current `dev`.

#### 3b. `main` ahead of `dev`

Most common cause: a release landed on `main` and `dev` was not
re-synced. Fast-forward `dev` onto `main`:

```bash
git checkout dev
git pull origin dev
git merge origin/main --ff-only
git push origin dev
```

If `--ff-only` fails, stop — `dev` has its own commits and needs a
merge, not a fast-forward.

#### 3c. Diverged

Do NOT auto-resolve. Report:

```bash
git merge-base origin/main origin/dev
git log origin/dev..origin/main --oneline
git log origin/main..origin/dev --oneline
```

and hand back to the user.

### 4. Check local `dev`

```bash
git checkout dev
git status
```

| State | Action |
|-------|--------|
| up to date | continue |
| behind | `git pull origin dev` |
| ahead | ask user: push, or reset to origin/dev |
| diverged | escalate |

### 5. Create the branch

```bash
git branch -a | grep "feature/<name>"    # check for collision
git checkout -b feature/<name>
```

Naming conventions (lowercase, hyphenated, English):

| Type | Prefix | Example |
|------|--------|---------|
| feature | `feature/add-*` | `feature/add-dark-mode` |
| fix     | `feature/fix-*` | `feature/fix-json-parse` |
| refactor| `feature/refactor-*` | `feature/refactor-parser` |
| improve | `feature/improve-*` | `feature/improve-perf` |
| docs    | `feature/docs-*` | `feature/docs-api-guide` |

### 6. Push with upstream

```bash
git push -u origin feature/<name>
```

### 7. Optional draft PR

```bash
gh pr create --draft --title "<type>: <summary>" --body "## Summary

- …

## Test plan

- [ ] …"
```

### 8. Report

```
## Feature branch created

| Item | Status |
|------|--------|
| remote fetched | ✅ |
| main / dev sync | ✅ |
| local dev | ✅ |
| branch created | ✅ feature/<name> |
| remote pushed | ✅ |

Next: start implementing.
```

## Safety checklist

- [ ] No uncommitted changes
- [ ] Used `git fetch`, not `git pull`
- [ ] Verified `origin/main` vs `origin/dev` relationship
- [ ] Verified local `dev` vs `origin/dev`
- [ ] No branch-name collision
- [ ] Did not auto-resolve diverged state
