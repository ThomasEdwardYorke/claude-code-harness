---
name: parallel-worktree
description: "複数サブタスクを git worktree 並列で開発するオーケストレータスキル (Model A: 単一 Claude + Agent-tool subagent)。coordinator が worktree 生成 / worker dispatch / 担当表同期 / マージ順序 / コンフリクト解消を orchestrate する。各 worker は TDD + Codex Phase 4-5 を実行し、Phase 5.5-7 は coordinator が取りまとめて実行する。単一リポジトリ (worktree なし) でもサブタスク数 1 の縮退モードとして利用可。Use when implementing 2+ independent sub-tasks in parallel with maximum quality."
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput"]
argument-hint: "[--spec=<json-file>] [--feature-branch=<base>] [--max-parallel=N] [--max-codex-parallel=N] [--profile=chill|assertive|strict] [--dry-run] [--no-commit]"
---

# `/parallel-worktree` — worktree 並列 TDD 開発オーケストレータ (Model A)

## 並列実行モデルの説明

**本スキルは Model A (単一 Claude + Agent-tool subagent) で動作する。**

- **coordinator** (本スキルを実行中の Claude セッション) が全体を管理
- **worker** (`harness:worker` agent) は coordinator から Agent tool で dispatch される subagent (公式 tools-reference: `Agent` tool、旧称 `Task` は現行 catalog 未掲載)
- 各 worker は独立した worktree ディレクトリで作業するが、coordinator の context 内で動作する
- worker は `tools: [Read, Write, Edit, Bash, Grep, Glob]` / `disallowedTools: [Agent]` のため:
  - Skill tool なし → `/pseudo-coderabbit-loop` 呼出不可
  - Agent tool 禁止 → 子 agent 起動不可
- **Phase 5.5 (疑似 CodeRabbit) / Phase 6 (本物 CodeRabbit) / Phase 7 (Codex セカンドオピニオン) は coordinator が worker 完了後に実行する**

### Model B (将来移行予定)

Model B は各 worktree で独立 `claude` プロセスを起動し、同一 harness で Phase 1-8 を完全実行する構成。
`claude --worktree` の `.claude/` 非継承バグ (issue #28041) 解消後、または sibling worktree + `claude -n <slug>` + tmux 管理で実現予定。
詳細は `docs/maintainer/ROADMAP-model-b.md` を参照 (maintainer-only、plugin 配布対象外)。

---

## 基本原則

1. **TDD + Codex は各 worker で実行**: worker は TDD (Red/Green/Refactor) + Codex CLI 直接呼出 (Bash 経由) で Phase 2-5 を実行
2. **Phase 5.5-7 は coordinator 責務**: worker 完了後に coordinator が疑似 CodeRabbit / 本物 CodeRabbit / Codex セカンドオピニオンを実行
3. **Codex チーム必須**: 各 worker が Bash 経由で `codex-companion.mjs task` を呼んで並列検証
4. **妥協禁止**: 「基盤が無い」「時間がない」等の理由で TDD / Codex を外さない
5. **coordinator は orchestrate + 品質ゲート後半**: worktree 生成 / 担当表更新 / PR 作成 / CodeRabbit 監視 / マージ順序 / コンフリクト解消
6. **汎用スキル**: 全プロジェクトで使える (プロジェクト固有は `.coderabbit.yaml` / `CLAUDE.md` で自動判定)

---

## 入力仕様

### Option A: `--spec=<json-file>` で指定

```json
{
  "feature_branch": "main",
  "base_dir": "/path/to/project",
  "worktree_parent_dir": "/path/to/project-parent",
  "worktree_prefix": "myproject-wt-",
  "sub_tasks": [
    {
      "slug": "frontend-foundation",
      "task_id": "T-1",
      "title": "frontend foundation scaffold",
      "description": "...",
      "acceptance_criteria": ["..."],
      "owned_files": ["frontend/**"],
      "forbidden_files": ["pyproject.toml", "backend/*"],
      "depends_on": [],
      "merge_priority": 4
    }
  ]
}
```

### Option B: 対話的入力

引数なしで起動されたら、ユーザーに feature branch / サブタスク数 / 各タスクの詳細を尋ねる。

### Option C: Plans.md から自動抽出

`Plans.md` + 担当表運用がある場合、`wt:recommended` / `wt:coordination` ラベルタスクを自動抽出。

---

## Pre-flight

coordinator は並列開発着手前に以下を全て検証:

- [ ] `git status` clean (coordinator worktree)
- [ ] feature_branch が origin と同期
- [ ] 各 sub_task の `owned_files` / `forbidden_files` が相互に衝突しないか
- [ ] `depends_on` チェーンに循環がないか
- [ ] `merge_priority` でマージ順序を決定
- [ ] 各 worktree dir が既存ディレクトリと衝突しないか
- [ ] Codex CLI が利用可能か (`codex --version`)
- [ ] `.coderabbit.yaml` から profile 取得 (未設定なら `chill`)

**全項目が通ってから Phase 1 へ。**

### WorktreeCreate hook との共存

harness plugin は `WorktreeCreate` hook を blocking protocol で実装しており、agent
frontmatter `isolation: worktree` を持つ subagent が起動すると自動的に sibling
worktree を作成する。本スキル (`/parallel-worktree`) の手動 `git worktree add` 運用と
**二重 worktree 作成**が発生しないよう、以下の invariant を守る:

- **現行**: 同梱 agent はいずれも `isolation: worktree` を付与していない。本スキルから
  dispatch される subagent は main repo の context で動き、coordinator が事前に作成した
  `worktree_parent_dir/worktree_prefix<slug>` に `cd` で入るだけ。
- **将来特定 agent で `isolation: worktree` を有効化する場合**: 本スキルの Phase 1
  worktree 生成と協調するロジックが必要。二重作成を避けるには以下いずれかを選択:
  - (a) 該当 agent を使う時は coordinator 側 `git worktree add` を skip する
    (isolation hook に任せる)
  - (b) coordinator 手動 worktree の path / branch 命名を hook 側と整合させ、hook の
    idempotent 再利用経路で吸収する

  **(b) の制約 (重要)**: handler の `findExistingWorktree` は **path + branch の完全
  一致**で reuse 判定する (path は `<basename-of-cwd>-wt-<name>` sibling 規約、branch
  は `harness-wt/<name>`)。既存 `/parallel-worktree` の default (path =
  `worktree_prefix<slug>`、branch = `${feature_branch}-${slug}`) とは命名体系が異なる
  ため、**そのまま (b) は効かない**。(b) を選ぶなら (1) handler 側を拡張して両命名を
  normalize しつつ検出する、または (2) coordinator 側の `worktree_prefix` / branch 名
  を handler 期待形式 (`<basename>-wt-` / `harness-wt/`) に揃える、のどちらかが必要。

  追加実装が不要な現行推奨は **(a)** — coordinator 側で事前に作成し、isolation を
  有効にした agent では WorktreeCreate hook の実作業 (git worktree add) を skip させる
  (例: 環境変数で coordinator 管理下フラグを伝え、hook 側で早期 return)。

---

## Phase 1: Worktree 生成 + 担当表更新

```bash
git worktree add "${worktree_parent_dir}/${worktree_prefix}${slug}" \
  -b "${feature_branch}-${slug}" "${feature_branch}"
```

Plans.md 担当表に `status=in_progress` で行追加 (coordinator 専任)。

---

## Phase 2: 各 worktree に worker agent を dispatch (並列)

各 sub_task に対して `harness:worker` agent を `run_in_background=true` で並列起動。

### worker に渡すプロンプトの必須要素

```markdown
# Task: <task_id> <title>

## Working directory
cd <worktree_dir>
branch: <feature_branch-slug>
**main repo には触らない。**

## オプションの伝播 (--no-commit forward 規約: --no-commit forward)

coordinator は `$ARGUMENTS` から以下を抽出し、各 worktree への `/tdd-implement` 呼出に materialize してから渡す:

- `--profile=chill|assertive|strict`: Phase 5.5 / 6 の疑似 / 本物 CodeRabbit に伝播
- `--no-commit`: Phase 8 commit step を抑制 (tdd-implement 側で skip)
- `--max-codex-parallel=N` (default 1, integer >= 1): worker が Phase 4 で発射する `node codex-companion.mjs task` の同時実行上限。worker prompt 冒頭に `export MAX_CODEX_PARALLEL=$N` として inject し、Phase 4 の Codex 呼出を `scripts/codex-semaphore.sh` で wrap させる (subagent context overflow / parallel timeout 防止)

```bash
# $ARGUMENTS を配列化 (zsh でも 0-based に揃える)
[ -n "${ZSH_VERSION:-}" ] && emulate -L bash
read -r -a ARGS_TOKENS <<< "$ARGUMENTS"

PROFILE="chill"
NO_COMMIT=""
MAX_CODEX_PARALLEL="1"
for tok in "${ARGS_TOKENS[@]}"; do
  case "$tok" in
    --profile=chill|--profile=assertive|--profile=strict)
      PROFILE="${tok#--profile=}"
      ;;
    --no-commit)
      NO_COMMIT="--no-commit"
      ;;
    --max-codex-parallel=*)
      v="${tok#--max-codex-parallel=}"
      # 整数 >= 1 を強制 (semaphore は max=0 を許容しないため runtime fail を避ける)
      if [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 1 ]; then
        MAX_CODEX_PARALLEL="$v"
      else
        echo "ERROR: --max-codex-parallel must be integer >= 1 (got '$v')" >&2
        exit 1
      fi
      ;;
  esac
done

# 各 worktree へ forward:
#   /tdd-implement ${SUBTASK} --profile=${PROFILE} ${NO_COMMIT}
# materialize 後 (例):
#   /tdd-implement T-12 --profile=assertive --no-commit
#   /tdd-implement T-13 --profile=assertive
#
# また worker prompt 冒頭に env export を 1 行付与する (案 C: Codex 並列度制御):
#   export MAX_CODEX_PARALLEL=$MAX_CODEX_PARALLEL
# worker (harness:worker agent) は Phase 4 Codex 呼出時にこの env を読み、
# scripts/codex-semaphore.sh acquire/release で同時実行を制限する。
```

## 実行フロー (Model A: worker 責務範囲)

### Phase 2: RED
- 失敗するテストを先に書く
- テスト削除・弱体化禁止

### Phase 3: GREEN
- 最小実装でテスト通過
- 全既存テスト維持

### Phase 4: Codex 並列検証 (必須)
Bash で Codex CLI を直接呼んでレビュー依頼。3+ worker が同時に Codex を叩くと
parent subagent context が overflow し、各 worker が Codex 完了時に結果を return
できず全件 timeout する (再現率 100%)。これを防ぐため `scripts/codex-semaphore.sh`
で Codex 並列度を coordinator 指定の `MAX_CODEX_PARALLEL` (default 1) に制限する:

```bash
CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
# Fail-fast: codex plugin 未 install / cache 未展開で node を無引数呼びすると分かりにくい
# error で落ちるため、ここで検出して明示的に停止する。
if [ -z "$CODEX_COMPANION" ] || [ ! -f "$CODEX_COMPANION" ]; then
  echo "ERROR: codex-companion.mjs not found. Run /codex:setup or reinstall codex plugin." >&2
  exit 1
fi

# Codex 並列度制御 (案 C): semaphore script の path resolve.
# coordinator から forward された MAX_CODEX_PARALLEL (default 1) を採用。
# 配布パスは marketplace 名で複数候補をフォールバック (cc-triad-relay 主、後方互換用に過去名も探す)。
SEM_BIN=""
for CAND in \
  "$HOME/.claude/plugins/marketplaces/cc-triad-relay/plugins/harness/scripts/codex-semaphore.sh" \
  "$HOME/.claude/plugins/cache/cc-triad-relay/harness/scripts/codex-semaphore.sh"; do
  if [ -x "$CAND" ]; then SEM_BIN="$CAND"; break; fi
done
MAX_PAR="${MAX_CODEX_PARALLEL:-1}"

if [ -n "$SEM_BIN" ] && [ "$MAX_PAR" -ge 1 ]; then
  SLOT=$("$SEM_BIN" acquire "$MAX_PAR")
  trap "'$SEM_BIN' release '$SLOT'" EXIT INT TERM
  node "$CODEX_COMPANION" task "実装レビュー: <task概要>" --effort medium
  "$SEM_BIN" release "$SLOT"
  trap - EXIT INT TERM
else
  # Semaphore unavailable. Behaviour depends on requested parallelism:
  #   MAX_PAR > 1 → fatal exit. Silently falling back to unconstrained
  #     parallel re-introduces the exact subagent context overflow that
  #     9g was created to prevent (3+ Codex review timeout, 100% reproduction).
  #     Refusing here forces the operator to fix the install (semaphore script
  #     missing) before paying for another lost-result run.
  #   MAX_PAR == 1 (sequential, the safe default) → WARN + continue. A single
  #     Codex review cannot overflow context, so the legacy unconstrained path
  #     is acceptable as a graceful degradation when semaphore is missing.
  if [ "$MAX_PAR" -gt 1 ]; then
    echo "ERROR: scripts/codex-semaphore.sh not found but --max-codex-parallel=$MAX_PAR > 1." >&2
    echo "       refusing to fall back to unconstrained parallel Codex (subagent context overflow risk, 9g)." >&2
    echo "       fix: ensure the harness plugin (cc-triad-relay) is installed and codex-semaphore.sh is executable." >&2
    exit 1
  fi
  echo "WARN: scripts/codex-semaphore.sh not found; running Codex without semaphore (MAX_PAR=$MAX_PAR=1, sequential is safe)" >&2
  node "$CODEX_COMPANION" task "実装レビュー: <task概要>" --effort medium
fi
```

### Phase 5: Codex レビューループ (必須)
critical/major が 0 になるまで反復。

### Phase 5.5-7: coordinator 実施 (worker は担当外)
Phase 5.5 (疑似 CodeRabbit) / Phase 6 (本物 CodeRabbit) / Phase 7 (Codex セカンドオピニオン) は **coordinator が worker 完了後に実行する**。worker は push まで実施して完了報告。

## ファイル所有権
- 触ってよい: <owned_files>
- 絶対に触らない: <forbidden_files>
- Plans.md は coordinator 専任

## Push
```bash
git push -u origin <feature_branch-slug>
```
PR 作成はしない (coordinator 実施)。

## 完了報告
1. 最終 commit hash
2. diff stat
3. 全テスト結果
4. 静的解析結果
5. Codex 並列検証サマリ (Phase 4)
6. Codex レビューループで直した項目 (Phase 5)
7. Follow-up notes (coordinator が拾うべき残課題)
```

### 並列数の調整

- `--max-parallel=N` 未指定なら `min(サブタスク数, 4)` — worker (Agent tool subagent) の同時実行数
- `--max-codex-parallel=N` (default 1) — 各 worker が Phase 4 で発射する Codex CLI の同時実行数。`scripts/codex-semaphore.sh` 経由で lock-dir-based semaphore (mkdir 原子性) を使い制御。`--max-parallel=4 --max-codex-parallel=2` のように **「worker 数 ≥ Codex 並列度」を逆転させない**こと (worker が semaphore で全員 sleep する状況を避ける)
- Agent は `run_in_background=true`

---

## Phase 3: 監視 + 完了受領

各 agent 完了後に coordinator が検証:
1. push が origin に到達しているか (`git ls-remote`)
2. 完了報告の Phase 4/5 に記述があるか (省略なし)
3. 省略があれば `SendMessage` で追加対応依頼

---

## Phase 4: Coordinator の品質ゲート後半 (Phase 5.5-7)

各 worktree の push 完了後、coordinator が:

1. **Phase 5.5 疑似 CodeRabbit** (`/pseudo-coderabbit-loop --local --profile=$PROFILE`)
   - coordinator は `$ARGUMENTS` から `--profile=` を抽出して `$PROFILE` を束縛 (argv 単位 case 完全一致):

     ```bash
     # Shell 互換: bash 必須 (read -r -a / 配列 0-based / unset 'arr[idx]' は bash 拡張)。
     # BASH_VERSION 未設定なら fail-fast (zsh / sh では silent degrade するため)。
     if [ -z "${BASH_VERSION:-}" ]; then
       echo "ERROR: /parallel-worktree argv parser requires bash." >&2
       exit 1
     fi
     [ -n "${ZSH_VERSION:-}" ] && emulate -L bash
     read -r -a ARGS_TOKENS <<< "$ARGUMENTS"
     PROFILE="chill"
     for tok in "${ARGS_TOKENS[@]}"; do
       case "$tok" in
         --profile=chill|--profile=assertive|--profile=strict)
           PROFILE="${tok#--profile=}"
           ;;
       esac
     done
     ```
   - 解決後の `$PROFILE` を materialize して `/pseudo-coderabbit-loop` に渡す (literal `<profile>` 禁止)
   - 実例: `--profile=strict` / `--profile=assertive` / `--profile=chill`
   - actionable=0 まで反復
   - rate limit 無関係 (Codex ベース)
2. **PR 作成** (`gh pr create --base <feature_branch> --head <feature_branch-slug>`)
3. **Phase 6 本物 CodeRabbit** (`/coderabbit-review <pr>`)
   - Clear 3 段判定 (APPROVED / unresolved=0 / rate-limited marker 不在)
   - rate limit ヒット時は `/pseudo-coderabbit-loop <pr> --profile=$PROFILE` に切替 (Phase 4 で解決した `$PROFILE` を PR-mode fallback にも materialize 伝播)
     - 実例: `/pseudo-coderabbit-loop 42 --profile=strict`
4. **指摘対応**: 当該 worktree の agent に `SendMessage` で返す → 再修正 → 再 push
5. **Phase 7 Codex セカンドオピニオン** (`/codex-team adversarial` or `harness:codex-sync`)

---

## Phase 5: マージ順序 + コンフリクト解消

- `merge_priority` 昇順で PR を merge
- 各 merge 後、残 worktree を rebase
- コンフリクト:
  - 軽微 → coordinator が直接解消
  - 複雑 → 当該 worktree agent に resume 指示
  - 解消後 `git push --force-with-lease` (ユーザー承認必要)

---

## Phase 6: Worktree cleanup + 担当表クリア

```bash
for slug in "${slugs[@]}"; do
  git worktree remove "${worktree_parent_dir}/${worktree_prefix}${slug}"
  git branch -d "${feature_branch}-${slug}"
done
git worktree prune
```

Plans.md 担当表から行削除、完了セクションに追記。

---

## Phase 7: ドキュメント更新 + セッション引継

- Plans.md 完了セクションに Round 総括
- プロジェクト固有のセッション引継ファイル (`harness.config.json` の `work.handoffFiles` 等で指定、存在すれば) を更新
- Memory 更新 (恒久情報のみ)

---

## 単一リポジトリ縮退モード

サブタスク数 = 1 or `--max-parallel=1`:
- Phase 1 の worktree 生成を skip
- coordinator が直接 `/tdd-implement` v2 を起動。**profile は解決済み実値を materialize して handoff**:

  ```text
  # テンプレート (Phase 4 で束縛した $PROFILE を使用)
  /tdd-implement <task description> --profile=$PROFILE

  # 実例 (PROFILE=strict の場合)
  /tdd-implement "Add feature X" --profile=strict
  ```
- Phase 4 以降は同じ (rate-limit fallback でも `--profile=$PROFILE` を維持)

---

## 禁止事項

- worker が Phase 5.5-7 を自力実行すると主張すること (Model A では不可能)
- Phase 4/5 (Codex チーム) を省略すること
- Plans.md を leaf worktree が編集すること
- 他 worktree の所有ファイルを編集すること
- 「時間がない」等の理由で品質を落とすこと

---

## 関連スキル

| スキル | 呼び出し元 / 使い方 |
|---|---|
| `/tdd-implement` v2 | 縮退モードで直接起動 |
| `/pseudo-coderabbit-loop` | Phase 4 で coordinator が実行 (Phase 5.5) |
| `/coderabbit-review` | Phase 4 で coordinator が実行 (Phase 6) |
| `/codex-team` | Phase 4 で coordinator が実行 (Phase 7) |
| `harness:worker` | 各 worktree の worker agent |
| `harness:codex-sync` | Codex 並列呼出 |

---

## Model B 運用ガイド (B-manual)

**前提**: Phase 2 (2026-04-21) で実装された `scripts/parallel-sessions.sh` を使用。

### B-manual の起動フロー

```bash
# 1. 複数 worktree を一括起動 (各 worktree で独立 claude プロセス)
scripts/parallel-sessions.sh start-batch crud-projects crud-locations crud-materials

# 2. 各 tmux session にアタッチして指示
scripts/parallel-sessions.sh attach crud-projects
# → claude が起動済み。/tdd-implement で実装指示を投入

# 3. coordinator 側で進捗監視
scripts/monitor-worktrees.sh --watch

# 4. 完了後にクリーンアップ
scripts/parallel-sessions.sh stop crud-projects
```

### B-manual の利点 (Model A との差分)

| 項目 | Model A | B-manual |
|---|---|---|
| 各 worker の context | 親 context 共有要約 | **独立 1M context** |
| 各 worker の harness | 限定 tools | **全 harness** (symlink 経由) |
| Skill tool | 不可 | **可能** |
| Agent tool | 禁止 (OOM) | **可能** (top-level) |
| 品質ゲート | coordinator 依存 | **各 worker が自律実行** |
| MCP | 不可 | **可能** |

### B-manual で各 worker が実行するフロー

各 worktree の独立 claude は top-level プロセスなので、Model A の制限がない:

1. `/tdd-implement` を直接実行可能 (Phase 1-8 全て)
2. `/pseudo-coderabbit-loop --local` を worker 内で実行可能
3. `codex-team` による Codex セカンドオピニオンも worker 内で完結
4. PR 作成・CodeRabbit 対応も worker 自身が可能

coordinator の役割は:
- worktree 生成 / 削除の orchestration
- Plans.md 担当表の管理
- マージ順序 / コンフリクト解消
- 全体進捗の監視

### sibling worktree の .claude/ 共有

`parallel-sessions.sh start` は以下を自動 symlink する:
- `.claude/` → main repo の `.claude/` (settings, rules)
- プロジェクト固有の個人設定ファイル (存在すれば) → main repo の同名ファイル
- `.docs/` → main repo の `.docs/`

git tracked ファイルは worktree に自然に存在:
- `CLAUDE.md`, `.mcp.json`, `harness.config.json`

user level (`~/.claude/plugins/`) は全 claude プロセスで共有。

---

## スキル更新履歴

- **v2.0 (2026-04-21)**: Model B (B-manual) 運用ガイド追加。`scripts/parallel-sessions.sh` + symlink による sibling worktree 独立 claude 実行をサポート。
- **v1.1 (2026-04-21)**: Model A を正直に記述。worker の責務範囲を Phase 2-5 に限定、Phase 5.5-7 は coordinator 責務に明確化。Model B への将来移行パスを記載。
- **v1 (2026-04-19)**: 開発プロセス上の反省を踏まえて新設 (詳細は CHANGELOG.md)。
