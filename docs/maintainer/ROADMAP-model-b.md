# claude-code-harness: Model B 進化ロードマップ

> **Maintainer-only notes.** This file lives under `docs/maintainer/` and is **excluded from the public plugin surface**. It references the concrete test-bed project used during development. Public contributors and plugin consumers do not need to read this. See `CONTRIBUTING.md` Section 5 for the test-bed policy (test-bed project = proving ground, not specification). Reusable invariants extracted from the test-bed are documented separately in shipped specs under `plugins/harness/`.

**branch**: `feature/model-b-evolution`
**作成日**: 2026-04-20
**発端プロジェクト (test-bed)**: `parts-management` (maintainer-side reference only)
**関連 doc (test-bed side)**: `docs/harness-model-b-plan.md` (external, test-bed repo)

本 doc は claude-code-harness plugin を Model A (coordinator + subagent) から
Model B (各 worktree で独立 claude プロセス + 同一ハーネス) へ進化させる
技術ロードマップ。**plugin 単体**の観点で必要な改修を記述。

---

## 背景

2026-04-20 時点で `parts-management` プロジェクトの Phase 1 実装中に、
本 plugin の v4.1 が以下の構造的矛盾を抱えていることが判明:

1. **`/parallel-worktree` が Model A を Model B として虚偽記載**
   - 仕様書: 「各 worktree で /tdd-implement v2 を完全実行」「各 worktree に同一 harness」
   - 実装: 単一 Claude セッション内で Task subagent を cd で動かすだけ

2. **`harness:worker` に品質ゲート実装が無い**
   - `disallowedTools: [Task]` + `Skill` tool 不在 → `/pseudo-coderabbit-loop` 呼出不可
   - 本文に TDD フロー具体記述なし、coordinator から渡されるプロンプト文字列依存

3. **`/tdd-implement` がプラグイン外 (user space) に孤立**
   - `~/.claude/commands/tdd-implement.md` に存在、plugin 配布不能

4. **`security-auditor.md` frontmatter 欠落** (tool 制約不機能)

5. **`harness.config.json` の spec 記述と実装 (`core/src/config.ts`) に乖離** (dead fields)

6. **全 6 agent `model: sonnet` 固定** (security-auditor は opus 向き、codex-sync は haiku で十分)

7. **未活用の Claude Code 機能** (subagent frontmatter `maxTurns`/`memory`/`isolation`、hooks `SubagentStop`/`PreCompact`/`FileChanged`、MCP 0 個)

詳細は `parts-management/docs/harness-model-b-plan.md` 参照。

---

## ゴール

1. **Phase 0**: 現 Model A の虚偽記載 / dead code / frontmatter 欠落を解消し、Honest Model A を確立
2. **Phase 1**: 未活用の Claude Code 機能 (hooks / per-agent model routing / skill frontmatter 整備) を統合
3. **Phase 2**: Model B (各 worktree で独立 claude) をサポートする `/parallel-worktree v2` を実装
4. **Phase 3**: 実戦投入で Model A vs B の定量比較、v2 を main へ merge

---

## Phase 0: Honest Model A cleanup

### 対象ファイル

| # | ファイル | 修正内容 |
|---|---|---|
| P0.1 | `plugins/harness/commands/parallel-worktree.md` | Model A として正直に書き直す。「各 worktree に同一 harness」「Phase 5.5 は worker 内」の虚偽削除。Phase 5.5 以降は coordinator 責務と明示 |
| P0.2 | `plugins/harness/agents/worker.md` | Phase 5.5 呼出の嘘記述削除。TDD フロー具体を本文に追加 |
| P0.3 | `plugins/harness/agents/worker.md` / `reviewer.md` | stale コマンド参照 (`/work`, `/breezing`, `/fix-bug`, `/add-feature`, `/plan-with-agent`) を現行 (`/harness-work`, `/harness-review`) に更新 |
| P0.4 | `plugins/harness/agents/worker.md` / `reviewer.md` | テンプレート未置換 (`roles of worker and worker`) を修正 |
| P0.5 | `plugins/harness/agents/security-auditor.md` | frontmatter 追加 (name / description / tools / disallowedTools / model / color / maxTurns) |
| P0.6 | `plugins/harness/agents/*.md` | 全 6 agent に `maxTurns: 20-40` 追記 (worker: 40, coderabbit-mimic: 30, reviewer: 20, security-auditor: 30, codex-sync: 10, scaffolder: 20 目安) |
| P0.7 | `plugins/harness/commands/tdd-implement.md` (新規) | `~/.claude/commands/tdd-implement.md` を plugin 内に移動、`allowed-tools` / `argument-hint` 明示追加 |
| P0.8 | `plugins/harness/commands/harness-setup.md` | check サブコマンドのファイルリストに `tdd-implement.md` / `parallel-worktree.md` / `pseudo-coderabbit-loop.md` / `coderabbit-mimic.md` 追加 |
| P0.9 | `plugins/harness/commands/harness-review.md` | 旧 CodeRabbit 節削除、`/coderabbit-review` への参照に統一 |
| P0.10 | `plugins/harness/commands/harness-work.md` + `plugins/harness/schemas/harness.config.schema.json` + `plugins/harness/core/src/config.ts` | dead field 整合 (spec の `work.*`/`worktree.*`/`tddEnforce.*`/`codeRabbit.*` を core schema と合わせる or spec から削除) |
| P0.11 | `plugins/harness/commands/{tdd-implement,harness-work,parallel-worktree}.md` | Phase 番号体系を統一 (Phase 5.5 / 6 / 7 / 8 の意味を 3 文書で一致させる) |

### Phase 0 完了条件

- [ ] 全 P0.1-11 が commit された
- [ ] harness-setup check が全て緑
- [ ] Claude Code の smoke test (`claude --version` + `/harness-plan` 起動) が通る
- [ ] Codex 1 agent で差分レビュー (敵対的視点) が actionable 0

---

## Phase 1: 未活用 Claude Code 機能の統合

### 対象

| # | ファイル | 修正内容 |
|---|---|---|
| P1.1 | `plugins/harness/core/src/hooks/pre-compact.ts` (新規) + `plugins/harness/hooks/hooks.json` | `PreCompact` hook で担当表 / 進行中 PR # / 現 Phase を `systemMessage` として注入 |
| P1.2 | `plugins/harness/core/src/hooks/subagent-stop.ts` (新規) + `hooks.json` | `SubagentStop` hook で ruff / mypy / pytest を自動実行 (CI safety net) |
| P1.3 | `plugins/harness/agents/security-auditor.md` | `model: opus` + skill 本文先頭に `ultrathink` プレフィックス |
| P1.4 | `plugins/harness/agents/codex-sync.md` | `model: haiku` 試験 (軽量 wrapper のため) |
| P1.5 | `plugins/harness/commands/*.md` | 全 skill に `allowed-tools` / `argument-hint` 明示 |
| P1.6 | `plugins/harness/core/src/hooks/task-lifecycle.ts` (新規) | `TaskCreated` / `TaskCompleted` で Plans.md 担当表を自動同期 (プロジェクトが Plans.md 運用を持つ場合のみ) |

### Phase 1 完了条件

- [ ] `/compact` 後も担当表コンテキスト維持
- [ ] `harness:worker` 完了時に CI が自動実行
- [ ] per-agent model routing が効く (security-auditor に opus、codex-sync に haiku)

---

## Phase 2: Model B infrastructure

### 対象

| # | ファイル | 修正内容 |
|---|---|---|
| P2.1 | `plugins/harness/commands/parallel-worktree.md` v2 | B-manual (tmux + `claude -n <slug>`) 前提に全面書き直し。Claude subagent 不使用、各 worktree で独立 Claude プロセスを起動する設計 |
| P2.2 | `plugins/harness/scripts/parallel-sessions-template.sh` (新規) | tmux session 管理スクリプトのテンプレート (プロジェクト個別にコピーして使う) |
| P2.3 | `plugins/harness/core/src/session-manager.ts` (新規) | 独立 claude プロセスの progress 監視 (git log + `/tmp/claude-log-*.jsonl` stream-json aggregator) |
| P2.4 | `plugins/harness/commands/claude-oneshot.md` (新規 skill) | `claude -p <instruction> --output-format stream-json` の wrapper skill |

### Phase 2 完了条件

- [ ] `bash scripts/parallel-sessions-template.sh start N <slugs>` で N worktree + N tmux window + N 独立 claude 起動
- [ ] 各 claude が同一 harness (skills / agents / rules / MCP) を使える
- [ ] coordinator から各 session の progress を監視可能
- [ ] 実プロジェクト (parts-management Week 5-6 CRUD) で動作検証済

---

## Phase 3: 実戦投入 + 定量評価

### 対象

| # | 内容 |
|---|---|
| P3.1 | parts-management Week 5-6 CRUD 4 endpoint を `/parallel-worktree v2` で実装 |
| P3.2 | Model A vs Model B の time / cost / quality データ収集 |
| P3.3 | B-manual 痛み点改善 (session 監視 / conflict 検出 / rollback) |
| P3.4 | `feature/model-b-evolution` → `main` merge PR 作成 |

### Phase 3 完了条件

- [ ] 1 週間で CRUD 4 endpoint 完成
- [ ] Model A vs B 定量比較データ出力
- [ ] main merge PR approved + merged
- [ ] upstream (他プロジェクトも使える状態) にリリース可能

---

## 重要な設計判断

### なぜ `claude --worktree` を使わないか

Claude Code 2.1.49 の公式 `claude --worktree` は `<repo>/.claude/worktrees/<name>` に worktree を作るが、`.claude/skills` / `agents` / `rules` が worktree に**非継承**というバグ ([issue #28041](https://github.com/anthropics/claude-code/issues/28041)) がある (2026-04-20 未解決)。これは Model B の「各 worktree で同一ハーネス」要件と正面衝突。

**回避**: sibling worktree (`../<project>-wt-<slug>`) を `git worktree add` で作成。sibling はユーザー level `~/.claude/` (harness plugin / user agents / user commands) を共有できる。プロジェクト level `.claude/` は sibling 側で初期化されるが、その空きを利用してプロジェクト個別の overlay を載せる構造を設計する。

### なぜ subagent に `Task` tool を戻さないか

[issue #19077](https://github.com/anthropics/claude-code/issues/19077): subagent に `Task` を許可すると sub-sub-agent 起動で OOM が報告されている。現 `disallowedTools: [Task]` は安全上妥当。

**Model B の意義**: nesting 問題そのものを回避。各 worktree の独立 claude プロセスはそれぞれが top-level、各々が Task tool で subagent を起動できる (single-level nesting、OOM リスクなし)。

---

## 運用ルール

### branch 切替時

harness plugin は single working tree のため、branch 切替すると全 active Claude session に影響する。したがって:

- Phase 0-3 作業は**全ての他 active Claude session を一時停止してから** `feature/model-b-evolution` に切替
- 作業完了後は `main` に戻し、smoke test OK を確認してから他 session 再開
- 長時間作業中は全 session を閉じた状態で実施

### commit 粒度

- 1 commit = 1 Phase task (P0.1 / P0.2 / P1.1 ...)
- commit message 先頭に `[P0.1]` 等の task ID 明示
- `feature/model-b-evolution` にのみ push、main に直 commit しない

### rollback

作業中にハーネスが壊れた場合:

```bash
cd ~/.claude/plugins/marketplaces/claude-code-harness
git checkout main  # v4.1 動作確認済 main に戻る
# 他 session 再開 OK
```

---

## 関連 resources

- Claude Code 公式 docs: `https://code.claude.com/docs/en/`
- Open issues:
  - `anthropics/claude-code#28041`: `.claude/` 非継承 in `--worktree`
  - `anthropics/claude-code#19077`: nested subagent OOM
- OSS 実装例:
  - [workmux](https://github.com/raine/workmux)
  - [Codeman](https://github.com/Ark0N/Codeman)
- parts-management project docs:
  - `docs/harness-model-b-plan.md` (committed、プロジェクト側プラン)
  - `.docs/harness-analysis-2026-04-20.md` (local、現状診断)
  - `.docs/harness-model-b-session-prompt.md` (local、セッション起動手順)

---

**次アクション**: Phase 0.1 (`commands/parallel-worktree.md` を honest Model A として書き直す) から開始。`parts-management/.docs/harness-model-b-session-prompt.md` のステップ 2-1 に従ってセッション起動。
