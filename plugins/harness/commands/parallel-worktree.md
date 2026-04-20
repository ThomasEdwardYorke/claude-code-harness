---
name: parallel-worktree
description: "複数サブタスクを git worktree 並列で開発するオーケストレータスキル。各 worktree 内で `/tdd-implement` v2 を完全強制 (TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオン) し、coordinator が worktree 生成 / 担当表同期 / マージ順序 / コンフリクト解消を orchestrate。単一リポジトリ (worktree なし) でもサブタスク数 1 の縮退モードとして利用可。Use when implementing 2+ independent sub-tasks in parallel with maximum quality."
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task"]
argument-hint: "[--spec=<json-file>] [--feature-branch=<base>] [--max-parallel=N] [--dry-run] [--no-merge]"
---

# `/parallel-worktree` — worktree 並列 TDD 開発オーケストレータ

**目的**: 複数サブタスクを git worktree で並列実装する際に、**各 worktree 内で `/tdd-implement` v2 を完全実行**し、coordinator 側で worktree 生成・担当表・マージ順序・コンフリクト解消を orchestrate する。

**本スキルの価値 (Round 4 反省から)**:
Round 4 では各 worktree で `/tdd-implement` v2 を完全には走らせず、coordinator が後追いで Codex レビュー / 疑似 CodeRabbit を補完していた。これをプロトコル違反として撲滅し、**「各 worktree = 独立した完全チーム」** の原則を強制する。

**単一リポジトリでも使える**: サブタスク数 1 or worktree 非推奨の場合は縮退モードで `/tdd-implement` v2 を直接起動するだけ。

---

## 基本原則（鉄則）

1. **各 worktree で `/tdd-implement` v2 を完全強制**（TDD + Codex 並列 + Codex レビュー + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオン）
2. **Codex チーム必須**: 各 worktree で worker + reviewer の Codex 並列呼出を行う（`harness:codex-sync` 複数並列）
3. **公式ドキュメント確認は Codex 経由**: ライブラリの最新仕様は `/ask-codex` で確認、WebSearch は補助
4. **妥協禁止**: 「基盤が無い」「時間がない」等の理由で TDD / Codex / 疑似 CodeRabbit を外さない
5. **Coordinator は orchestrate のみ**: 実装そのものは各 worktree の agent に任せる、coordinator は担当表・マージ順序・コンフリクト解消のみ
6. **汎用スキル**: 全プロジェクトで使える (プロジェクト固有は `.coderabbit.yaml` / `CLAUDE.md` / `AGENTS.md` で自動判定)

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
      "task_id": "R4-①",
      "title": "Vite + React 19 + Tailwind v4 + shadcn/ui scaffold",
      "description": "…",
      "acceptance_criteria": [
        "既存 frontend/ を frontend-legacy/ にリネーム",
        "Vite 8 + React 19 + TS strict",
        "…"
      ],
      "owned_files": ["frontend/**", "frontend-legacy/**", "backend/main.py (StaticFiles mount のみ)"],
      "forbidden_files": ["pyproject.toml", "requirements*.txt", "backend/* (main.py 以外)"],
      "depends_on": [],
      "merge_priority": 4
    }
  ]
}
```

### Option B: 対話的入力

引数なしで起動されたら、ユーザーに以下を尋ねる:
1. feature branch 名
2. サブタスク数
3. 各サブタスクの slug / title / AC / 所有ファイル / 禁止ファイル / 依存関係

### Option C: Plans.md から自動抽出

プロジェクトに `Plans.md` + 担当表運用がある場合:
- `/harness-plan` で `wt:recommended` / `wt:coordination` ラベルタスクを抽出
- 自動的に sub_tasks に変換

---

## Pre-flight（並列開発の前提確認）

coordinator は並列開発着手前に以下を全て検証:

- [ ] `git status` clean (coordinator worktree)
- [ ] feature_branch が origin と同期 (`git fetch && git log` で ahead/behind 確認)
- [ ] 各 sub_task の `owned_files` / `forbidden_files` が相互に衝突しないか確認（ファイルオーバーラップを検出）
- [ ] `depends_on` チェーンに循環がないか確認
- [ ] `merge_priority` (依存度低い = 先 merge) でマージ順序を決定
- [ ] 各 worktree の worktree_dir が既存ディレクトリと衝突しないか確認
- [ ] Codex CLI が利用可能か確認 (`codex --version`)
- [ ] `.coderabbit.yaml` から profile 取得（未設定なら `chill`）
- [ ] プロジェクト規約ファイル (`CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md`) を確認

**全項目 ✅ になってから Phase 1 へ**。

---

## Phase 1: Worktree 生成 + 担当表更新

```bash
# 各 sub_task ごとに:
git worktree add "${worktree_parent_dir}/${worktree_prefix}${slug}" \
  -b "${feature_branch}-${slug}" "${feature_branch}"

# Plans.md 担当表に行追加（プロジェクトに担当表運用があれば）
# task_id | owner | branch | worktree_dir | status=in_progress | touched_files | 備考
```

---

## Phase 2: 各 worktree に worker agent を dispatch（並列）

**各 sub_task に対して `harness:worker` agent を 1 つずつ、`run_in_background=true` で並列起動**。

各 agent に渡すプロンプトの必須要素（テンプレート）:

```markdown
# Phase <X> - <task_id> <title>

## Working directory
cd <worktree_dir>
branch: <feature_branch-slug> (checkout 済み)
**main repo (<base_dir>) には触らない**。

## 必須: /tdd-implement v2 を完全実行する

本タスクは `/tdd-implement` v2 (TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオン) を**省略せず**実行する。

### Phase 1: 計画とチェックリスト
- AC を TaskCreate で細分化
- 実装順序を決定

### Phase 2: RED
- 失敗するテストを先に書く
- テスト削除・弱体化禁止

### Phase 3: GREEN
- 最小実装でテスト通過
- 全既存テスト維持

### Phase 4: Codex 並列検証 (必須)
- `harness:codex-sync` agent を起動、または Codex CLI を直接呼ぶ:
  ```bash
  node "<codex-companion.mjs>" task "実装レビュー (独立検証)" --effort medium
  ```
- 差分が出たら優れた方を採用

### Phase 5: Codex レビューループ (必須)
- バグ・論理エラー・後方互換性・セキュリティ・パフォーマンス観点で Codex にレビュー依頼
- 全観点 OK まで反復

### Phase 5.5: 疑似 CodeRabbit pre-review (必須)
```bash
# このスキルを Skill tool で呼び出す:
/pseudo-coderabbit-loop --local --profile=<profile> --worktree=<worktree_dir>
```
- actionable=0 になるまで反復
- profile は coordinator から渡された値 (chill/assertive/strict)

### Phase 6: (coordinator に引き継ぎ)
PR 作成 + 本物 CodeRabbit レビュー監視は coordinator の責務。
worker は最後の push まで実施して完了報告。

## 公式ドキュメント確認
ライブラリ仕様が曖昧なら **Codex CLI で公式ドキュメントを読ませて確認**:
```bash
node "<codex-companion.mjs>" task "<ライブラリ> <X> 機能の公式仕様を docs から読んで要点抽出" --effort medium
```
WebSearch / WebFetch は補助、主は Codex。

## ファイル所有権
- **触ってよい**: <owned_files>
- **絶対に触らない**: <forbidden_files>
- **共通 (触らない)**: Plans.md (coordinator 専任) / `.claude/rules/**` / `CLAUDE.md` / 他 worktree

## コミット
- 意味単位で分割、日本語メッセージ、HEREDOC 渡し
- 末尾必須: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- `--no-verify` 禁止

## Push
```bash
git push -u origin <feature_branch-slug>
```
PR 作成はしない (coordinator 実施)。

## 完了報告
1. 最終 commit hash
2. diff stat
3. 全テスト結果 (pytest / npm test / etc)
4. 静的解析結果 (ruff / mypy / eslint / etc)
5. Codex 並列検証サマリ
6. Codex レビューループで直した項目
7. 疑似 CodeRabbit (Phase 5.5) で直した項目
8. 公式ドキュメント確認した内容 (あれば)
9. 申送 (coordinator が拾うべき残課題)
10. **妥協した箇所があれば明示** (本来は禁止)
```

### 並列数の調整

- `--max-parallel=N` 未指定なら `min(サブタスク数, 4)`
- Agent は `run_in_background=true`
- 各 agent は独立した `output_file` を持つ

---

## Phase 3: 監視 + 完了受領

- 各 agent が完了するとタスク通知 (`<task-notification>`) が届く
- coordinator は以下を検証:
  1. push が実際に origin に到達しているか (`git ls-remote`)
  2. agent 報告の妥協箇所ゼロを確認
  3. 完了報告の Phase 4/5/5.5 すべてに記述があるか（省略なし）
  4. 省略があれば agent に resume 指示 (`SendMessage` で追加対応依頼)

---

## Phase 4: Coordinator レイヤーの本物 CodeRabbit + セカンドオピニオン

各 worktree の push 完了後、coordinator が:

1. **PR 作成** (`gh pr create --base <feature_branch> --head <feature_branch-slug>`)
2. **本物 CodeRabbit レビューループ** (`/coderabbit-review <pr>`)
   - Clear 3 段判定 (APPROVED / unresolved=0 / rate-limited marker 不在)
   - rate limit ヒット時は `/pseudo-coderabbit-loop <pr>` に切替
3. **指摘対応**: 当該 worktree の agent に `SendMessage` で返す → agent が Phase 2-5.5 を再走 → 再 push
4. **Codex セカンドオピニオン** (`/codex-team adversarial` or `harness:codex-sync`): CodeRabbit が見逃した critical を探す

---

## Phase 5: マージ順序 + コンフリクト解消

- `merge_priority` 昇順 (依存低い順) で PR を merge
- 各 merge 後、残 worktree を rebase: `git rebase origin/<feature_branch>`
- コンフリクトが発生したら:
  - 軽微 (import の並び等) → coordinator が直接解消
  - 複雑 → 当該 worktree の agent に resume 指示して解消依頼
  - 解消後 `git push --force-with-lease`（ユーザー明示承認が必要、CLAUDE.md の許可規則に従う）

---

## Phase 6: Worktree cleanup + 担当表クリア

```bash
for slug in "${slugs[@]}"; do
  git worktree remove "${worktree_parent_dir}/${worktree_prefix}${slug}"
  git branch -d "${feature_branch}-${slug}"
done
git worktree prune
```

Plans.md 担当表から該当行削除、完了セクションに task_id 追記。

---

## Phase 7: ドキュメント更新 + セッション引継

- `Plans.md` の完了セクションに Round 総括
- `.docs/next-session-prompt.md` (プロジェクトに存在すれば) を次 Round 向けに更新
- `CLAUDE.local.md` (プロジェクトに存在すれば) の矛盾チェック
- Memory 更新 (恒久情報のみ、ephemeral state は入れない)

---

## 単一リポジトリ (worktree なし) 縮退モード

サブタスク数 = 1 or `--max-parallel=1` or worktree 非推奨プロジェクト:
- Phase 1 の worktree 生成を skip
- Phase 2 の agent dispatch を skip、coordinator が直接 `/tdd-implement` v2 を起動
- Phase 4 以降は同じ

---

## 呼び出し例

### 例 1: Plans.md ベース、4 並列

```
/parallel-worktree --feature-branch=feature/new-partslist --max-parallel=4
```

→ `/harness-plan` で `wt:recommended` / `wt:coordination` タスクを抽出、4 並列で実行。

### 例 2: JSON spec で厳密指定

```
/parallel-worktree --spec=.claude/scratch/round5-spec.json
```

### 例 3: 縮退モード (単一タスク)

```
/parallel-worktree --max-parallel=1
```
→ `/tdd-implement` v2 を直接起動。

---

## 禁止事項 (絶対守る)

- 各 worktree で `/tdd-implement` v2 を省略すること
- Phase 4 / Phase 5 / Phase 5.5 を省略すること (Codex チーム + 疑似 CodeRabbit なしでの push 禁止)
- Plans.md を leaf worktree が編集すること
- 他 worktree の所有ファイルを編集すること
- 「時間がない」等の理由で品質を落とすこと

---

## 関連スキル

| スキル | 呼び出し元 / 使い方 |
|---|---|
| `/tdd-implement` v2 | 各 worktree 内で必須実行 (本スキルが enforce) |
| `/pseudo-coderabbit-loop` | Phase 5.5 (push 前 pre-review) + Phase 4 (rate-limited 時) |
| `/coderabbit-review` | Phase 4 (本物 CodeRabbit 監視) |
| `/codex-team` | Phase 4 (セカンドオピニオン) |
| `harness:worker` | 各 worktree の worker agent |
| `harness:codex-sync` | 各 worktree 内の Codex 並列呼出 |
| `coderabbit-mimic` | `/pseudo-coderabbit-loop` から呼ばれる Codex-based reviewer |

---

## このスキルの更新履歴

- **v1 (2026-04-19)**: Round 4 の反省 (各 worktree で `/tdd-implement` v2 未完全実行) を踏まえて新設。全プロジェクト共通。
