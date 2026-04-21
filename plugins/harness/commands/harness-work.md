---
name: harness-work
description: "Plans.md 駆動の実装ディスパッチャ (v4)。タスク数で Auto Mode Detection し内部的に `/tdd-implement` v2 (Solo) or `/parallel-worktree` v1 (Parallel/Breezing) に委譲、TDD + Codex チーム並列 + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオンの完全品質ゲートを常時強制する。バグ修正・機能追加・パイプライン検証のサブフローを統合。Use when user mentions: implement, execute, fix bug, add feature, test pipeline, /harness-work, /work, /breezing, /fix-bug, /add-feature, /test-pipeline, --parallel. Do NOT load for: planning (use harness-plan), code review (use harness-review), release (use harness-release)."
description-ja: "Harness v4 統合実行ディスパッチャ。Plans.md 駆動で Auto Mode Detection (1件=Solo、2-3件=Parallel、4件以上=Breezing) し、内部的に /tdd-implement v2 or /parallel-worktree v1 に委譲することで TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit の完全品質ゲートを常時強制。以下で起動: 実装して、バグ修正、機能追加、パイプライン確認、/harness-work、/work、/breezing、/fix-bug、/add-feature、/test-pipeline、--parallel。プランニング・レビュー・リリース・セットアップには使わない。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task", "Skill"]
argument-hint: "[all|task-number|N-M] [--fix <説明>|--feature <機能名>|--test-pipeline] [--parallel N] [--breezing] [--sequential] [--no-commit] [--dry-run]"
---

# Harness Work (v4) — Plans.md 駆動ディスパッチャ

**v4 改修要旨 (2026-04-19)**: 内部委譲化。`/harness-work` はタスク抽出・モード判定・担当表更新の薄いディスパッチャに徹し、実装エンジンは `/tdd-implement` v2 (単一) / `/parallel-worktree` v1 (並列) に委譲。これで TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオンの完全品質ゲートが**常時強制**される。Round 4 で発覚した「worker agent が品質ゲート省略」問題の構造的解消。

---

## 基本原則（鉄則）

1. **Plans.md 駆動**: タスク抽出 / 担当表更新 / 状態管理が主責務
2. **実装委譲**: 実装そのものは `/tdd-implement` v2 or `/parallel-worktree` v1 に必ず委譲
3. **品質ゲート常時強制**:
   - TDD (Red → Green → Refactor)
   - Codex チーム並列 (worker + reviewer)
   - 公式ドキュメント確認は Codex 経由
   - 疑似 CodeRabbit pre-review (Phase 5.5)
   - 本物 CodeRabbit レビューループ (Phase 6)
   - Codex セカンドオピニオン (Phase 7)
4. **worktree 並列でも単一リポジトリでも対応**: Auto Detection、プロジェクト設定尊重
5. **全プロジェクト汎用**: `harness.config.json` / `Plans.md` / `.coderabbit.yaml` / `CLAUDE.md` / `AGENTS.md` から自動判定
6. **妥協禁止**: 「時間がない」「基盤が無い」を理由に品質ゲートを外さない

---

## Quick Reference

| ユーザー入力 | モード | 委譲先 |
|---|---|---|
| `/harness-work` | **auto** | タスク数で `/tdd-implement` or `/parallel-worktree` |
| `/harness-work all` | **auto** | 全未完了タスクで自動判定 |
| `/harness-work 3` | solo | `/tdd-implement` v2 (task #3 のみ) |
| `/harness-work 3-5` | parallel | `/parallel-worktree` (task #3-5) |
| `/harness-work --fix <説明>` | fix-bug | 一時タスク追加 → 自動モード |
| `/harness-work --feature <機能名>` | add-feature | 一時タスク追加 → 自動モード |
| `/harness-work --test-pipeline` | test-pipeline | 独立サブフロー (API 不使用) |
| `/harness-work --parallel N` | parallel (強制) | `/parallel-worktree --max-parallel=N` |
| `/harness-work --breezing` | breezing (強制) | `/parallel-worktree` with all remaining |
| `/harness-work --sequential` | sequential | `/tdd-implement` v2 を逐次 |
| `/harness-work --dry-run` | dry-run | モード判定 + 委譲プラン表示のみ |

---

## Auto Mode Detection (v2: 依存グラフ考慮)

**単純な件数ではなく「独立グループ数」で判定**する (Turbo 流 DAG 先行)。`depends_on` 付きの連鎖タスクは 1 グループとして数える。

### 判定フロー

```python
# Step 1: Plans.md から対象タスクを抽出、depends_on で DAG 構築
groups = compute_independent_groups(selected_tasks)
n_groups = len(groups)

# Step 2: wt:* ラベルで worktree 使用可否を決定
wt_labels = {task.wt_label for task in selected_tasks}

# Step 3: モード選択
if args.dry_run: mode = "dry-run"
elif args.test_pipeline: mode = "test-pipeline"
elif args.breezing: mode = "breezing"
elif args.parallel: mode = "parallel-forced"
elif args.sequential: mode = "sequential"
elif "wt:avoid" in wt_labels and "wt:recommended" not in wt_labels:
    # wt:avoid 混在、worktree 使えない
    if n_groups <= 1: mode = "solo"
    elif n_groups <= 3: mode = "parallel-task-tool"   # Task ツールで並列
    else: mode = "breezing-phase-fanout"              # Turbo 流 Phase fan-out
else:
    # worktree 利用可
    if n_groups == 0: mode = "no-task"
    elif n_groups == 1: mode = "solo"                 # -> /tdd-implement v2
    elif n_groups <= 3: mode = "parallel-worktree"    # -> /parallel-worktree
    else: mode = "breezing-worktree"                  # -> /parallel-worktree (cap 4)
```

### モード対応表

| 独立グループ数 | wt ラベル | 自動選択 | 委譲先 |
|---|---|---|---|
| 0 | — | 報告のみ | — (`/harness-plan` 提案) |
| 1 | wt:avoid | **Solo (avoid)** | `/tdd-implement` v2 直接 |
| 1 | wt:recommended | **Solo (worktree)** | `/parallel-worktree --max-parallel=1` (縮退モード) |
| 2-3 | wt:avoid | **Parallel (Task tool)** | Task ツール N 個 + TDD 強制節埋込 |
| 2-3 | wt:recommended | **Parallel (worktree)** | `/parallel-worktree --max-parallel=N` |
| 4+ | wt:avoid | **Breezing (Phase fan-out)** | Turbo 流: 独立グループ → 依存グループの 2 相並列 |
| 4+ | wt:recommended | **Breezing (worktree)** | `/parallel-worktree --max-parallel=min(N,4)` |

### Phase fan-out パターン (wt:avoid Breezing)

wt:avoid タスクが 4+ で worktree 使えない場合、Turbo 流に**位相分離**して並列化:

```
Phase A: 独立タスク群 (depends_on=[]) を Task ツール並列
  ├─ Task A1 (TDD 強制節埋込)
  ├─ Task A2 (TDD 強制節埋込)
  └─ Task A3 (TDD 強制節埋込)
      ↓ 全完了まで同期
Phase B: 依存タスク群 (depends_on=[A1,A2]) を並列
  ├─ Task B1 (TDD 強制節埋込)
  └─ Task B2 (TDD 強制節埋込)
      ↓
全完了後 Coordinator が Plans.md 一括更新 + cross-task Reviewer レビュー 1 回
```

**`fail-fast` 相当**: `[critical]` / `[security]` ラベルタスクが 1 件失敗 → Phase 全体停止、他タスク中断。

### 並列度の動的決定

`--parallel N` や Breezing モードの既定並列度は以下で決定:

```
N = min(
  タスク数,
  harness.config.json:work.maxParallel || 4,   # 明示設定優先
  CODEX_CLI_CONCURRENCY || 4,                   # Codex 同時実行制約
  CODERABBIT_BUCKET_SIZE || 5                   # CodeRabbit Pro rate limit (5/h)
)
```

ユーザー明示 `--parallel N` は上書き可能 (ただし警告表示)。

### worktree 使用判定

Auto mode で worktree を使うかの判定:

1. `harness.config.json` に `worktree.enabled == false` → Solo モード強制 (`/tdd-implement` v2 逐次)
2. `Plans.md` に `wt:avoid` ラベル付きタスクが選ばれた → そのタスクだけ Solo
3. `wt:coordination` ラベル → coordinator 事前調整ログを出力してから並列
4. それ以外 → worktree 並列 (`/parallel-worktree`)

---

## オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `all` | 全未完了タスクを対象 | - |
| `N` or `N-M` | タスク番号/範囲指定 | - |
| `--fix <説明>` | バグ修正フローを起動 (一時タスク追加) | - |
| `--feature <機能名>` | 機能追加フローを起動 (一時タスク追加) | - |
| `--test-pipeline` | パイプライン検証フローを起動 (API 不使用) | - |
| `--parallel N` | 並列ワーカー数を強制指定 | auto |
| `--sequential` | 直列実行強制 (Solo を逐次) | - |
| `--breezing` | Parallel 強制 + 全未着手タスク対象 | false |
| `--no-commit` | 自動コミット抑制 | false |
| `--dry-run` | モード判定 + 委譲プランのみ表示 | false |
| `--affected` | **NEW (Nx 流)**: `git diff origin/<base>..HEAD` で変更ファイルを取得、Plans.md タスクの `touched_files` と照合して「影響タスクセット」のみ対象 | false |

**deprecation 通知**:
- 旧 `--codex` フラグは廃止予定。`/tdd-implement` v2 / `/parallel-worktree` が常に Codex チームを呼ぶため不要

---

## ワークフロー

### Pre-flight (全モード共通)

```bash
# 1. プロジェクト状態確認
git status --short
git log --oneline -3

# 2. Plans.md の存在確認
test -f Plans.md && echo "Plans.md found" || echo "Plans.md missing — use /tdd-implement directly"

# 3. harness.config.json 読込 (プロジェクト設定)
test -f harness.config.json && cat harness.config.json | jq '.work // {}'

# 4. .coderabbit.yaml 存在確認 + profile 読取り
#    `pseudo-coderabbit-loop` と同じ 3 段フォールバック + WARN 出力 (silent 降格禁止)
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
    # pseudo-coderabbit-loop と同じロジック、同じ quoted heredoc で bash エスケープ依存排除。
    # 末尾の `(?:\s+#.*)?` は valid YAML の inline comment を許容する (A-6 r4 / r9 Major-5)。
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
echo "CodeRabbit profile from .coderabbit.yaml: $PROFILE"

# YAML 由来の PROFILE は CodeRabbit 公式 allowlist (chill / assertive) のみ許可。
# strict は harness-local extension で CLI / harness.config.json 専用、YAML 経路では採用しない
# (https://docs.coderabbit.ai/reference/configuration 公式 schema 準拠)。
if [ -n "$PROFILE" ] && [ "$PROFILE" != "chill" ] && [ "$PROFILE" != "assertive" ]; then
  echo "WARN: .coderabbit.yaml profile='$PROFILE' is outside CodeRabbit official allowlist (chill / assertive); fallback to 'chill' (use --profile=strict or harness.config.json for local extension)" >&2
  PROFILE="chill"
fi

# PROFILE 値の優先順位 (高 → 低):
#   1. コマンド引数 `--profile=...` (`$ARGUMENTS` を argv 単位で case 文完全一致抽出)
#   2. `harness.config.json` の `.tddEnforce.pseudoCoderabbitProfile`
#   3. `.coderabbit.yaml` の `reviews.profile` (上記 3 段 fallback + 公式 allowlist 検証済)
#   4. `chill` (最終 fallback、WARN 出力付き)
# 後段 (Phase 5.5) にはここで確定した値を Skill handoff 時に **実値へ materialize** してから渡す
# (Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` (0-based、`$0` が第1引数) のみ保証。`${PROFILE}` は
# undocumented なので、coordinator が Skill 呼出前に literal `${PROFILE}` を `chill` 等に置換する責務)。
#
# argv 単位の case 文完全一致: `--profile=strict1` / `--profile=chill-something` を誤受理しない。
ARG_PROFILE=""
# $ARGUMENTS を配列に読み込み (bash の word splitting を明示)。
# 空白を含む値 (例 `--foo="bar baz"`) は未サポート。
read -r -a ARGS_TOKENS <<< "$ARGUMENTS"
for tok in "${ARGS_TOKENS[@]}"; do
  case "$tok" in
    --profile=chill|--profile=assertive|--profile=strict)
      ARG_PROFILE="${tok#--profile=}"
      ;;
    --profile=*)
      echo "WARN: invalid --profile='${tok#--profile=}' (must be chill|assertive|strict); ignored" >&2
      ;;
  esac
done

# harness.config.json key path は実装とドキュメントを `.tddEnforce.pseudoCoderabbitProfile` に統一。
# JSON 破損時は WARN を出して silent fallback を避ける。
CFG_PROFILE=""
if [ -f harness.config.json ] && command -v jq >/dev/null 2>&1; then
  if ! jq empty harness.config.json 2>/dev/null; then
    echo "WARN: harness.config.json is not valid JSON; skipping config-level profile override" >&2
  else
    CFG_PROFILE=$(jq -r '.tddEnforce.pseudoCoderabbitProfile // empty' harness.config.json 2>/dev/null || true)
  fi
fi

PROFILE="${ARG_PROFILE:-${CFG_PROFILE:-$PROFILE}}"
export PROFILE
echo "Resolved profile (arg > config > yaml > chill): $PROFILE"

# 5. Codex CLI 利用可能性
codex --version 2>/dev/null || echo "WARNING: Codex CLI not installed — /tdd-implement v2 Phase 4-5 will skip Codex"
```

**Pre-flight に失敗したら**: 原因を報告、適切な代替スキル (`/tdd-implement` 直接 / `/harness-plan` 先行 等) を提案。

---

### Step 1: タスク抽出 + 優先度ソート

Plans.md の「未着手」セクションを parse し、以下の優先順位でソート:

1. `[fix]` — バグ修正 (最優先)
2. `[security]` — セキュリティ修正
3. `[improve]` — 機能改善
4. `[feature]` — 新機能
5. `[refactor]` — リファクタリング
6. `[test]` — テスト追加
7. `[docs]` — ドキュメント

引数の絞込:
- `N` 単体 → そのタスクのみ
- `N-M` → 範囲
- `all` → 全未着手
- `--fix <説明>` / `--feature <機能名>` → 一時タスクを Plans.md に追加してから抽出

---

### Step 2: モード判定

```python
if args.dry_run:
    mode = "dry-run"
elif args.test_pipeline:
    mode = "test-pipeline"
elif args.breezing:
    mode = "breezing"  # -> /parallel-worktree
elif args.parallel:
    mode = "parallel"  # -> /parallel-worktree --max-parallel=N
elif args.sequential:
    mode = "sequential"  # -> /tdd-implement を逐次
else:
    # Auto Detection
    n_tasks = len(selected_tasks)
    if n_tasks == 0: mode = "no-task"
    elif n_tasks == 1: mode = "solo"        # -> /tdd-implement v2
    elif n_tasks <= 3: mode = "parallel"    # -> /parallel-worktree
    else: mode = "breezing"                 # -> /parallel-worktree (並列度上限)

# worktree 非対応プロジェクト / wt:avoid タスクなら Solo に降格
if harness_config.worktree_enabled == False:
    mode = "sequential"
if any(task.has_label("wt:avoid") for task in selected_tasks):
    warn_and_downgrade_to_sequential()
```

---

### Step 3: 担当表更新 (coordinator レイヤー)

Plans.md 担当表運用があるプロジェクトでは、実装開始前に以下を更新:

```markdown
## 現在進行中の worktree（担当表）
| task_id | owner | branch | worktree_dir | status | touched_files | 備考 |
|---|---|---|---|---|---|---|
| <task_id> | <mode>-worker | <branch> | <path> | in_progress | … | Round N |
```

Plans.md 未使用プロジェクトでは scoping comment / task file のみ作成。

---

### Step 4: モード別委譲

#### 4.1 Solo モード (1 タスク)

**重要: handoff 時は PROFILE を実値に materialize してから Skill を呼ぶ**。Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` (0-based、`$0` が第1引数) のみ保証 (https://docs.anthropic.com/en/docs/claude-code/slash-commands)。`${PROFILE}` は undocumented なので、literal のまま Skill に渡すと受け手側で literal として扱われ、委譲境界で PROFILE が失われる。

coordinator (LLM) は Pre-flight で確定した `$PROFILE` の **実値** を args 文字列内に直接埋め込んでから Skill を呼び出す責任を持つ:

```
# テンプレート表記 (PROFILE は事前に実値へ置換する)
Skill({skill: "tdd-implement", args: "<task description + AC + forbidden files> --profile=${PROFILE}"})

# 実際の呼出例 (coordinator が PROFILE=assertive を解決した場合)
Skill({skill: "tdd-implement", args: "<task description + AC + forbidden files> --profile=assertive"})
```

**禁止**: `--profile=${PROFILE}` の literal 文字列をそのまま Skill args に渡す (受け手側で置換されず literal として伝わる)。

`/tdd-implement` v2 が以下を完全実行:
- Phase 1 計画
- Phase 2 RED
- Phase 3 GREEN
- Phase 4 Codex 並列検証
- Phase 5 Codex レビューループ
- Phase 5.5 `/pseudo-coderabbit-loop --local --profile=$PROFILE`
- Phase 6 push + PR + `/coderabbit-review <pr>`
- Phase 7 `/codex-team` セカンドオピニオン

#### 4.2 Parallel / Breezing モード — worktree 利用可

**handoff materialize 必須** (4.1 と同じ原則)。coordinator は `$PROFILE` を実値に置換してから Skill を呼び出す:

```
# テンプレート表記
Skill({skill: "parallel-worktree", args: "--max-parallel=<N> --feature-branch=<branch> --profile=${PROFILE} --spec=<inline-spec>"})

# 実際の呼出例 (PROFILE=strict の場合)
Skill({skill: "parallel-worktree", args: "--max-parallel=3 --feature-branch=feature/foo --profile=strict --spec=<inline-spec>"})
```

`/parallel-worktree` v1 が:
- N worktree 生成
- 各 worktree で `harness:worker` agent 起動、内部で `/tdd-implement` v2 強制実行
- coordinator が本物 CodeRabbit + マージ順序 + コンフリクト解消 + 担当表クリア

#### 4.2b Parallel (Task tool) モード — wt:avoid 混在、worktree 使えない

`Task` ツールで N タスクを並列起動。各 Task プロンプトには以下を必須埋込する:
- TDD 強制節
- **profile を materialize 済み実値で埋め込む** (Skill handoff と同じ規約)。`tdd_enforced_prompt(task)` を組み立てる段階で coordinator が `$PROFILE` を実値 (chill / assertive / strict) に置換してから Task prompt 文字列に入れる。literal `$PROFILE` のまま渡すと subagent 側で slot 展開されず profile が失われる (Anthropic 公式の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` 0-based のみ保証)。

```markdown
本タスクは TDD + 品質ゲート必須。以下の Phase を省略なく実行:
- Phase 2 Red: 失敗テスト先行 (pytest 基盤なければ先に整備)
- Phase 3 Green: 最小実装 + 全既存テスト維持
- Phase 4 Codex 並列: `harness:codex-sync` agent を起動 or `codex exec` で差分突合
- Phase 5 Codex レビュー: critical/major が 0 になるまで反復
- Phase 5.5 疑似 CodeRabbit: `/pseudo-coderabbit-loop --local --profile=<実値>` で actionable=0 まで反復
  (coordinator が $PROFILE を解決した実値 = chill / assertive / strict に埋め込んでから prompt に渡す)
- Phase 6: push まで実施 (PR 作成は coordinator 実施)
省略した場合、完了報告に **「妥協あり」** と明記すること (本来は禁止)。
```

**実例** (coordinator が PROFILE=assertive を解決した場合の Phase 5.5 行):

```markdown
- Phase 5.5 疑似 CodeRabbit: `/pseudo-coderabbit-loop --local --profile=assertive` で actionable=0 まで反復
```

**注**: `harness:worker` は `disallowedTools: [Task]` のため worker 内から更に agent 起動不可。**TDD 強制は worker プロンプト本文で実現**する。

#### 4.2c Breezing (Phase fan-out) モード — wt:avoid 混在、4+ タスク

Turbo 流の位相分離:

```bash
# Phase A: 独立タスク群を Task ツール並列 (全て TDD 強制節埋込)
coordinator_plans = compute_phases(tasks, dependencies)
for task in coordinator_plans["phase_a"]:
    Task({description: task.title, prompt: tdd_enforced_prompt(task), run_in_background: true})

# 全 Phase A 完了まで同期

# Phase B: 依存タスク群を Task ツール並列
for task in coordinator_plans["phase_b"]:
    Task({description: task.title, prompt: tdd_enforced_prompt(task), run_in_background: true})

# 全完了後 coordinator が:
# - Plans.md 一括更新
# - cross-task Reviewer 1 回 (harness:reviewer agent)
```

#### 4.3 Sequential モード (明示 / worktree 非対応)

**handoff materialize 必須** (4.1 と同じ原則)。`$PROFILE` の実値を各 Skill 呼出の args に埋め込む:

```
# PROFILE=chill の場合の実際の呼出
for task in selected_tasks:
    Skill({skill: "tdd-implement", args: "<task desc> --profile=chill"})
    # 各タスク完了まで待機、次へ
```

#### 4.4 Test Pipeline モード

API 不使用のコストゼロパイプライン確認 (既存ロジック維持):
- 依存関係 import 確認
- protected-data/ CSV 存在・スキーマ確認
- 主要クラスの import 確認
- 出力 artifact スキーマ検証 (存在時)

`/tdd-implement` への委譲はしない (independent flow)。

#### 4.5 Dry-run モード

実装委譲しない。モード判定 + 委譲プラン + 影響範囲を表示:

```
Auto Mode Detection 結果:
  mode: parallel
  tasks: [#3, #5, #7]
  max_parallel: 3
  delegated_to: /parallel-worktree --max-parallel=3 --feature-branch=feature/xxx
  estimated_duration: 30-60 min
  worktrees_to_create: [wt-task-3, wt-task-5, wt-task-7]
  coderabbit_reviews: 3 件 (Pro rate limit 5/h 以内、OK)
```

---

### Step 5: 完了確認 + 担当表クリア + Plans.md 更新

全委譲完了後、coordinator が:

1. 委譲先からの完了報告を verify (commit hash / push / PR URL)
2. 品質ゲートが全て走った証跡を確認:
   - 各 worktree / 単一タスクで Phase 4 Codex 並列 ✅
   - Phase 5 Codex レビュー ✅
   - Phase 5.5 疑似 CodeRabbit clean ✅
   - Phase 6 本物 CodeRabbit Clear (APPROVED or unresolved=0) ✅
   - Phase 7 Codex セカンドオピニオン ✅
3. **省略されていたら `/harness-work --resume <task>` で再実行**
4. Plans.md 担当表から行削除 → 完了セクションに追記
5. worktree cleanup (`/parallel-worktree` が実施済)
6. `.docs/next-session-prompt.md` 等、セッション引継ファイル更新

---

## サブフロー詳細

### `--fix` バグ修正 (旧 /fix-bug を統合)

1. Plans.md に一時タスク追加: `- [ ] [fix] <説明>（実装中）`
2. Auto Detection → Solo モード (単発タスクのため)
3. `/tdd-implement` v2 に委譲:
   - Phase 2 RED: バグ再現テストを先に書く (テスト駆動バグ修正)
   - Phase 3 GREEN: 最小修正で再現テスト pass
   - Phase 4-7: Codex + CodeRabbit レビューループ
4. Plans.md 更新 → 完了セクション

**禁止事項** (`/tdd-implement` v2 が強制):
- 根本原因特定前の対症療法
- 後方互換性破壊
- テスト削除・改ざん

### `--feature` 機能追加 (旧 /add-feature を統合)

1. Plans.md に一時タスク追加: `- [ ] [feature] <機能名>（実装中）`
2. Auto Detection → Solo or Parallel (複雑さによる)
3. `/tdd-implement` v2 / `/parallel-worktree` に委譲

**禁止事項**:
- スコープクリープ
- 既存 interface の破壊
- テストなしの複雑機能追加

### `--test-pipeline` パイプライン検証 (旧 /test-pipeline を統合)

独立サブフロー。`/tdd-implement` に委譲せず以下を直接実行:

```bash
# 依存関係確認
python3 -c "import openai, dotenv, requests, bs4, pydantic; print('OK')"

# CSV ロード確認 (プロジェクトによる、config ファイルから対象取得)
python3 -m <project_main_module>.pipeline_check --dry-run

# 出力スキーマ検証 (存在時)
python3 -m <project_main_module>.schema_validator --output-dir <path>
```

API call なし、コストゼロ。

---

## CI 失敗時の対応 (全モード共通)

1. CI ログを確認 → エラー原因特定
2. `/tdd-implement` v2 Phase 2-3 で修正 (RED → GREEN)
3. 同一原因で 3 回失敗 → 自動修正ループ停止、ユーザーにエスカレーション
4. 失敗ログ・試みた修正・残論点をまとめて報告

---

## プロジェクト設定 (`harness.config.json`)

全プロジェクト共通で以下のフィールドを推奨 (未設定なら既定値で動作):

```json
{
  "work": {
    "plansFile": "Plans.md",
    "maxParallel": 4,
    "labelPriority": ["fix", "security", "improve", "feature", "refactor", "test", "docs"],
    "criticalLabels": ["critical", "security", "fix"],
    "testCommand": "pytest -q",
    "qualityGates": {
      "enforceTddImplement": true,
      "enforcePseudoCoderabbit": true,
      "enforceRealCoderabbit": true,
      "enforceCodexSecondOpinion": true
    },
    "failFast": true
  },
  "worktree": {
    "enabled": "auto",
    "maxParallel": 4,
    "parentDir": "..",
    "prefix": "<project-name>-wt-",
    "defaultBaseBranch": "main",
    "forceDisableReasons": [
      "例: Y.js 統合期 (hot file 集中で衝突多発)",
      "例: baseline migration 期間",
      "例: 全ファイル rename/削除タスク実行中"
    ]
  },
  "tddEnforce": {
    "alwaysRequireRedTest": true,
    "allowSkipOnDocsTasks": true,
    "pseudoCoderabbitProfile": "chill",
    "maxCodexReviewRetries": 3
  },
  "codeRabbit": {
    "botLogin": "coderabbitai",
    "ratelimitCheckWindowMinutes": 15,
    "approvedStateAsClear": true,
    "maxPseudoLoopIterations": 5,
    "proBucketSize": 5,
    "proBucketWindowMinutes": 60
  }
}
```

`qualityGates` で一部を無効化できるが、**既定は全て true**。プロジェクト固有の例外理由は `CLAUDE.md` / `AGENTS.md` に明記必須。

`worktree.forceDisableReasons` は**期間限定で手動制御**するエスケープハッチ。並列開発禁止期間を明示化できる (例: 大規模 rename 期間、migration 期間)。

---

## 既存互換 (Backward Compatibility)

v3 ユーザーへの移行:

| v3 の動作 | v4 の動作 |
|---|---|
| `--codex` 明示で Codex CLI 直接委託 | **非推奨**。`/tdd-implement` v2 が常に Codex 並列呼出 |
| Breezing モードで worker + reviewer agent 独自調整 | `/parallel-worktree` v1 に統合、各 worktree で `/tdd-implement` v2 強制 |
| Solo モードで worker agent 直接 | `/tdd-implement` v2 に委譲 (品質ゲート強化) |

v3 のコマンド互換は維持される (`--parallel N` / `--breezing` / `--fix` / `--feature` は動く)。ただし内部動作が委譲型に変わる。

---

## 禁止事項 (絶対守る)

- `/tdd-implement` v2 / `/parallel-worktree` v1 を経由せず worker agent を直接 dispatch する
- 品質ゲート (Phase 4/5/5.5/6/7) のいずれかを省略する
- Plans.md を leaf worktree で編集する (coordinator 専任)
- `harness.config.json` の `qualityGates` を勝手に false にする (プロジェクト憲章への違反)

---

## 関連スキル

| スキル | 役割 | 呼び出し関係 |
|---|---|---|
| `/tdd-implement` v2 | 単一タスク実装エンジン (primitive) | `/harness-work` Solo / Sequential が呼ぶ |
| `/parallel-worktree` v1 | worktree 並列オーケストレータ | `/harness-work` Parallel / Breezing が呼ぶ |
| `/pseudo-coderabbit-loop` | 疑似 CodeRabbit (Phase 5.5) | `/tdd-implement` v2 が呼ぶ |
| `/coderabbit-review` | 本物 CodeRabbit 監視 (Phase 6) | `/tdd-implement` v2 / `/parallel-worktree` が呼ぶ |
| `/codex-team` | Codex セカンドオピニオン (Phase 7) | `/tdd-implement` v2 が呼ぶ |
| `/harness-plan` | 計画・Plans.md 管理 | `/harness-work` の前段で使う |
| `/harness-review` | 多角的レビュー (実装後の独立レビュー) | 実装後任意、`/harness-work` からは呼ばない |
| `/harness-release` | リリース / バージョンバンプ | 実装完了後任意 |

---

## 品質ゲート一覧 (全モード共通)

| Gate | 実行主体 | 失敗時挙動 | 省略可否 |
|---|---|---|---|
| Gate 1: Red テスト先行 | `/tdd-implement` v2 Phase 2 | 着手ブロック | 禁止 |
| Gate 2: Green + 全既存テスト通過 | `/tdd-implement` v2 Phase 3 | Phase 3 差し戻し | 禁止 |
| Gate 3: Codex 並列検証 | `harness:codex-sync` | Codex 未インストール時のみスキップ可 (明示記録) | 原則禁止 |
| Gate 4: Codex レビューループ | `harness:codex-sync` | critical/major が 0 になるまで反復 | 禁止 |
| Gate 5: 疑似 CodeRabbit | `/pseudo-coderabbit-loop` | actionable=0 まで反復 (max 5 回) | 禁止 |
| Gate 6: 本物 CodeRabbit | `/coderabbit-review` (coordinator) | APPROVED or unresolved=0 まで反復 | 禁止 |
| Gate 7: Codex セカンドオピニオン | `/codex-team adversarial` | critical 発見 → Gate 1 に差し戻し | 強く推奨 (プロジェクト設定で無効化可) |

Gate 1-5 は worktree / Task 内で blocking 実行、Gate 6 は coordinator が非同期監視、Gate 7 は PR merge 前に 1 回。

---

## 申送 (Codex 調査で判明した未検証事項)

以下は公式ドキュメントで明示されていない / 実運用で検証が必要な事項。リグレッション発生時の原因特定用に記録:

1. **`allowed-tools: ["Skill"]` の動作**: Skill frontmatter に `Skill` ツールを指定できるか公式ドキュメント未記載。現状の `/harness-work` / `/tdd-implement` は `"Skill"` を `allowed-tools` に含めているが、実際にモデルが Skill ツールを呼べるかは最新 Claude Code 版で要検証。動作しない場合は Bash 経由 (`claude --skill ...`) or プロンプト指示のみで代替。

2. **`context: fork` frontmatter の適用**: `/tdd-implement` に `context: fork` を追加すると独立コンテキストで動作するはずだが、harness-work から起動された場合の Plans.md 更新責務の分担が未決定。現状は coordinator (harness-work) 側で Plans.md 更新する設計だが、fork 内で更新した場合の整合性は未検証。

3. **`disable-model-invocation: true` の挙動**: ユーザー明示呼出のみを許可する frontmatter フィールド。現状の `/harness-work` / `/tdd-implement` には設定していないが、循環呼出リスク軽減のために追加を検討 (ただし description で自動選択制御する方が柔軟)。

4. **`harness:worker` plugin-scoped agent 名の Task 引数**: `Task({subagent_type: "harness:worker"})` 形式が実際に動作するか要検証。現状の `/parallel-worktree` は `subagent_type: "harness:worker"` を指定しているが、plugin-scoped name 解決が v2.1+ Claude Code で正しく動くか未確認。

5. **SessionMode 拡張**: `core/src/types.ts` の `SessionMode` に `"tdd"` / `"parallel-worktree"` を追加するかは設計判断待ち。既存の `"work"` / `"breezing"` を継続利用で運用上問題ないなら変更不要。

6. **State store の並行書込競合**: v0.2.0 で file locking 予定とのこと。現状は Plans.md coordinator 専任運用で回避済み。

これらの事項は Phase 2+ 以降で検証・修正する。現状の設計で動かない場合は **フォールバック戦略** (下記) で品質ゲートを維持する。

---

## フォールバック戦略 (品質ゲートを維持する)

品質ゲートを外す代わりに委譲方式を変更するフォールバック:

| 失敗シナリオ | フォールバック |
|---|---|
| `Skill({skill: "tdd-implement"})` が動作しない | harness-work が tdd-implement の内容をインライン展開してプロンプトに埋込 (品質ゲート節を必須埋込) |
| `harness:codex-sync` agent 起動失敗 | `Bash` で `codex exec ...` を直接呼ぶ (同じ品質確保) |
| `/pseudo-coderabbit-loop` Skill 呼出失敗 | `coderabbit-mimic` agent を直接 Task で起動 |
| `/parallel-worktree` Skill 呼出失敗 | harness-work が直接 worktree 生成 + harness:worker を Task 並列起動 (各 Task で TDD 強制節埋込) |
| Codex CLI 未インストール | Codex Phase をスキップ、その旨を Plans.md / 完了報告に明示 |
| CodeRabbit 設定なし (`.coderabbit.yaml` なし) | Phase 5.5/6 をスキップ、その旨を明示。プロジェクト側で `.coderabbit.yaml` + GitHub App install を推奨 |

**原則**: フォールバック時も品質ゲート (Red テスト / Green / Codex レビュー) を外さない。Skill 呼出メカニズムが不安定でも TDD は死守。

---

## スキル更新履歴

- **v4.1 (2026-04-19 Codex 調査反映)**: Auto Mode Detection v2 (依存グラフ考慮、独立グループ数ベース)、`--affected` オプション追加 (Nx 流)、Phase fan-out パターン明示化、`harness.config.json` 拡張フィールド詳細化 (tddEnforce / worktree.forceDisableReasons / codeRabbit bucket size)、品質ゲート一覧、申送セクション、フォールバック戦略追加。
- **v4 (2026-04-19)**: 内部委譲化。`/tdd-implement` v2 / `/parallel-worktree` v1 への委譲レイヤーに刷新。品質ゲート常時強制。Round 4 で発覚した「worker 丸投げで品質ゲート省略」問題を構造解消。
- **v3**: Auto Mode Detection (Solo/Parallel/Breezing) 導入、`--codex` オプション追加、サブフロー (fix-bug/add-feature/test-pipeline) 統合。
- **v2, v1**: レガシー (`work` / `breezing` / `fix-bug` / `add-feature` / `test-pipeline` が別スキルだった時代)。
