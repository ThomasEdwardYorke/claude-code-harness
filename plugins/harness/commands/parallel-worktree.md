---
name: parallel-worktree
description: "複数サブタスクを git worktree 並列で開発するオーケストレータスキル (Model A: 単一 Claude + Task subagent)。coordinator が worktree 生成 / worker dispatch / 担当表同期 / マージ順序 / コンフリクト解消を orchestrate する。各 worker は TDD + Codex Phase 4-5 を実行し、Phase 5.5-7 は coordinator が取りまとめて実行する。単一リポジトリ (worktree なし) でもサブタスク数 1 の縮退モードとして利用可。Use when implementing 2+ independent sub-tasks in parallel with maximum quality."
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task"]
argument-hint: "[--spec=<json-file>] [--feature-branch=<base>] [--max-parallel=N] [--profile=chill|assertive|strict] [--dry-run] [--no-merge]"
---

# `/parallel-worktree` — worktree 並列 TDD 開発オーケストレータ (Model A)

## 並列実行モデルの説明

**本スキルは Model A (単一 Claude + Task subagent) で動作する。**

- **coordinator** (本スキルを実行中の Claude セッション) が全体を管理
- **worker** (`harness:worker` agent) は coordinator から Task tool で dispatch される subagent
- 各 worker は独立した worktree ディレクトリで作業するが、coordinator の context 内で動作する
- worker は `tools: [Read, Write, Edit, Bash, Grep, Glob]` / `disallowedTools: [Task]` のため:
  - Skill tool なし → `/pseudo-coderabbit-loop` 呼出不可
  - Task tool 禁止 → 子 agent 起動不可
- **Phase 5.5 (疑似 CodeRabbit) / Phase 6 (本物 CodeRabbit) / Phase 7 (Codex セカンドオピニオン) は coordinator が worker 完了後に実行する**

### Model B (将来移行予定)

Model B は各 worktree で独立 `claude` プロセスを起動し、同一 harness で Phase 1-8 を完全実行する構成。
`claude --worktree` の `.claude/` 非継承バグ (issue #28041) 解消後、または sibling worktree + `claude -n <slug>` + tmux 管理で実現予定。
詳細は `docs/harness-model-b-plan.md` を参照。

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
  "feature_branch": "feature/new-partslist",
  "base_dir": "/Users/me/dev/myproject",
  "worktree_parent_dir": "/Users/me/dev",
  "worktree_prefix": "myproject-wt-",
  "sub_tasks": [
    {
      "slug": "frontend-foundation",
      "task_id": "R4-1",
      "title": "Vite + React 19 + Tailwind v4 + shadcn/ui scaffold",
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

## 実行フロー (Model A: worker 責務範囲)

### Phase 2: RED
- 失敗するテストを先に書く
- テスト削除・弱体化禁止

### Phase 3: GREEN
- 最小実装でテスト通過
- 全既存テスト維持

### Phase 4: Codex 並列検証 (必須)
Bash で Codex CLI を直接呼んでレビュー依頼:
```bash
CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
node "$CODEX_COMPANION" task "実装レビュー: <task概要>" --effort medium
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
7. 申送 (coordinator が拾うべき残課題)
```

### 並列数の調整

- `--max-parallel=N` 未指定なら `min(サブタスク数, 4)`
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
- `.docs/next-session-prompt.md` を更新 (存在すれば)
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
| Task tool | 禁止 (OOM) | **可能** (top-level) |
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
- `CLAUDE.local.md` → main repo の `CLAUDE.local.md`
- `.docs/` → main repo の `.docs/`

git tracked ファイルは worktree に自然に存在:
- `CLAUDE.md`, `.mcp.json`, `harness.config.json`

user level (`~/.claude/plugins/`) は全 claude プロセスで共有。

---

## スキル更新履歴

- **v2.0 (2026-04-21)**: Model B (B-manual) 運用ガイド追加。`scripts/parallel-sessions.sh` + symlink による sibling worktree 独立 claude 実行をサポート。
- **v1.1 (2026-04-21)**: Model A を正直に記述。worker の責務範囲を Phase 2-5 に限定、Phase 5.5-7 は coordinator 責務に明確化。Model B への将来移行パスを記載。
- **v1 (2026-04-19)**: Round 4 の反省を踏まえて新設。
