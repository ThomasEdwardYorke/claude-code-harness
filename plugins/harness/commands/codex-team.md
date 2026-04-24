---
name: codex-team
description: "Use Codex CLI as a team member: review, delegated development, or adversarial security review. Use when the user asks for a second opinion from Codex, delegates a coding task to Codex, or requests an adversarial review."
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
argument-hint: "[review|dev|adversarial] [options]"
---

# `/codex-team` — Codex as a teammate

Wraps the Codex CLI so you can fold it into a Claude Code workflow
without leaving the session. Three sub-modes: **review**, **dev**
(delegate implementation), and **adversarial** (focused security pass).

> This skill runs the `codex` binary directly. For a stricter, foreground
> wrapper that is designed to be invoked from parallel Agent dispatches,
> see the `codex-sync` agent (same binary, different semantics).

## Argument

`$ARGUMENTS`:

- `$0` = sub-command (`review` / `dev` / `adversarial`)
- `$1+` = options passed through

## Prerequisites

1. `codex --version` succeeds.
2. `codex login` has been run (`~/.codex/auth.json` exists).
3. The model cost is acceptable — the default Codex model can be
   expensive. Override with `-m <model>` when needed.

## Model selection (harness model registry)

All three sub-commands below inject the model slug resolved by
`harness model resolve codex-team` so every Codex invocation converges
on the project's configured model rather than `~/.codex/config.toml`'s
personal default. Precedence is documented in
`plugins/harness/core/src/models/resolver.ts` and summarised here:

```
caller --model  >  harness model resolve codex-team  >  Codex config default
```

Resolve once at the top of the shell block and reuse the slug:

```bash
CODEX_MODEL="$(harness model resolve codex-team 2>/dev/null \
  | python3 -c 'import sys, json; print(json.load(sys.stdin).get("model",""))' \
  2>/dev/null)"
MODEL_FLAG=""
if [ -n "$CODEX_MODEL" ]; then
  MODEL_FLAG="-m $CODEX_MODEL"
fi
```

Skip the block entirely when the caller wants to exercise the Codex
config-side default; otherwise every `codex review` / `codex exec`
invocation should include `$MODEL_FLAG` (examples below).

## Sub-commands

### `review` — code review

Ask Codex to review the current diff and summarize findings in plain
English. Input is whatever is uncommitted, or a base branch if given.

```bash
git status --short && git diff --stat

RESULT="/tmp/codex-review-$(date +%s).txt"

# default: uncommitted changes (inject harness-resolved $MODEL_FLAG)
codex review $MODEL_FLAG --uncommitted --output-last-message "$RESULT" 2>&1

# optional: against a base branch
#   codex review $MODEL_FLAG --base "$BRANCH" --output-last-message "$RESULT" 2>&1
```

When running under a pane-capable terminal (WezTerm), you can split a
pane so the operator sees progress:

```bash
PANE_ID=$(wezterm cli split-pane --right -- bash -c \
  "codex review --uncommitted --output-last-message $RESULT 2>&1; echo '===CODEX_DONE==='; while true; do sleep 1; done")
```

Then:

```bash
cat "$RESULT"
```

Classify findings by severity and evaluate them against the project's
own rules (TDD policy, security, the guardrail configuration in
`harness.config.json`). Separate "must fix" from "optional".

### `dev` — delegated development

Hand Codex a task. Evaluate the result before applying.

```bash
RESULT="/tmp/codex-dev-$(date +%s).txt"
codex exec $MODEL_FLAG "$TASK_DESCRIPTION" --full-auto --output-last-message "$RESULT" 2>&1
cat "$RESULT"
```

After the run:

- Read the generated code.
- Check against project rules (comment language, TDD, guardrails).
- Apply as-is, request fixes, or reject with a reason.

### `adversarial` — security-focused review

Same input surface as `review`, but primed for adversarial thinking.

```bash
RESULT="/tmp/codex-adversarial-$(date +%s).txt"
codex review $MODEL_FLAG --uncommitted --output-last-message "$RESULT" -- \
  "Act as an adversarial reviewer. Focus on authentication flaws, data-loss risks, race conditions, injection, credential exposure, and failure modes under adverse inputs. Assume worst case." \
  2>&1
cat "$RESULT"
```

Classify:

- **CRITICAL** — fix before merge
- **WARN** — fix soon; note in the PR
- **INFO** — for awareness

Reserve extra attention for risks specific to this project (API-key
exposure, prompt injection through external URLs, state-file
corruption).

## Common caveats

- **Cost**: Codex runs bill to the provider account (either a ChatGPT
  subscription or a direct API key). The default model is the most
  expensive — use `-m <model>` to swap in a cheaper option.
- **Timeouts**: Complex tasks take 30–60 s. In a pane-capable terminal,
  you can see progress; otherwise the CLI appears idle.
- **Verify everything**: Treat Codex output as a strong suggestion, not a
  source of truth. Claude Code re-evaluates before applying.
