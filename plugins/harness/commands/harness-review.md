---
name: harness-review
description: "Unified review skill for Harness v3. Multi-angle code, plan, and scope review. Integrates troubleshoot, maintenance, harness integrity check, and CodeRabbit review loop. Use when user mentions: review, code review, plan review, troubleshoot, maintenance, harness check, coderabbit, /harness-review, /troubleshoot, /maintenance. Do NOT load for: implementation, new features, bug fixes, setup, or release."
description-ja: "Harness v3 統合レビュースキル。コード・プラン・スコープの多角的レビュー、トラブルシュート、保守作業、ハーネス整合性確認、CodeRabbitレビューループを統合。以下で起動: レビュー、コードレビュー、プランレビュー、トラブルシュート、保守、ハーネス確認、coderabbit、/harness-review、/troubleshoot、/maintenance。実装・新機能・バグ修正・セットアップ・リリースには使わない。"
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Task"]
argument-hint: "[code|plan|scope|troubleshoot|maintenance|integrity|coderabbit]"
context: fork
---

# Harness Review (v3)

Harness v3 の統合レビュースキル。
以下の旧スキルを統合:

- `harness-review`（元） — ハーネスファイル存在・整合性・構文検証
- `troubleshoot` — 問題の症状から始める原因調査・修正提案・防止策フロー
- `maintenance` — 依存更新・コード整理・CSV整合性・ログ管理などの保守作業
- `coderabbit-review` — GitHub PR へのプッシュ → CodeRabbit レビュー対応ループ

---

## Quick Reference

| ユーザー入力 | サブコマンド | 動作 |
|------------|------------|------|
| "レビューして" / "review" | `code`（自動） | コードレビュー（直近の変更） |
| "プランをレビューして" | `plan`（自動） | 計画レビュー |
| "スコープ確認" | `scope`（自動） | スコープ分析 |
| "問題を調査して" / "troubleshoot" | `troubleshoot` | 症状から根本原因を診断 |
| "保守作業" / "maintenance" | `maintenance` | 依存・コード品質・CSV・ログの一括チェック |
| "ハーネス確認" / "harness check" | `integrity` | ハーネスファイルの存在・権限・整合性 |
| "coderabbitのレビュー対応" | `coderabbit` | PR プッシュ → CodeRabbit レビューループ |

---

## レビュータイプ自動判定

| 直前のアクティビティ | レビュータイプ | 観点 |
|--------------------|--------------|------|
| `/harness-work` 後 | **Code Review** | Security, Performance, Quality |
| `/harness-plan create` 後 | **Plan Review** | Clarity, Feasibility, Dependencies, Acceptance |
| タスク追加後 | **Scope Review** | Scope-creep, Priority, Feasibility, Impact |

---

## Code Review フロー（`code`）

### Step 1: 変更差分を収集

```bash
git diff HEAD~1 --stat
git diff HEAD~1 -- <changed_files>
```

### Step 2: 4観点でレビュー

| 観点 | チェック内容 |
|------|------------|
| **Security** | APIキー漏洩、入力バリデーション、インジェクション対策 |
| **Performance** | 不要な API 呼び出し、メモリリーク |
| **Quality** | 命名、単一責任、エラーハンドリング、スタブ禁止 |
| **Compatibility** | 既存 public API / function signatures の後方互換性 (プロジェクト固有の互換性要件は CLAUDE.md / AGENTS.md を参照) |

### Step 3: レビュー結果出力

```markdown
## レビュー結果

### APPROVE / REQUEST_CHANGES

**重大な問題**: なし / {{詳細}}

| 観点 | 評価 | 詳細 |
|------|------|------|
| Security | OK / NG | {{詳細}} |
| Performance | OK / NG | {{詳細}} |
| Quality | OK / NG | {{詳細}} |
| Compatibility | OK / NG | {{詳細}} |

### 推奨改善点（必須ではない）
- {{改善提案}}
```

### Step 4: 判定

- **APPROVE**: レビュー結果を報告 (コミット・push はしない。実施は `/harness-work` に委譲)
- **REQUEST_CHANGES**: 問題箇所と修正方針を提示。`/harness-work` で修正後に再レビュー

---

## Plan Review フロー（`plan`）

1. Plans.md を読み込む
2. 以下の観点でレビュー:
   - **Clarity**: タスク説明が明確か
   - **Feasibility**: 技術的に実現可能か
   - **Dependencies**: タスク間の依存関係が正しいか
   - **Acceptance**: 完了条件（AC）が定義されているか
3. 改善提案を提示

---

## Scope Review フロー（`scope`）

1. 追加されたタスク/機能をリスト化
2. 以下の観点で分析:
   - **Scope-creep**: 当初スコープからの逸脱
   - **Priority**: 優先度は適切か
   - **Feasibility**: 現在のリソースで実現可能か
   - **Impact**: 既存機能への影響
3. リスクと推奨アクションを提示

---

## Troubleshoot フロー（`troubleshoot` / 旧 /troubleshoot）

`/harness-work --fix` が「Plans.md の [fix] タスクを選んで修正する」フローなのに対し、
`troubleshoot` は「問題の症状から始めて原因→修正→防止策まで網羅する」フロー。

### Step 1: 問題の症状・エラーメッセージを収集

以下の情報を収集する（不明な場合は確認する）:
- エラーメッセージ（あれば全文）
- 再現条件（どんな入力で発生するか）
- 発生タイミング（常時 / 特定条件下のみ）
- 期待する動作と実際の動作

### Step 2: worker エージェントで根本原因を診断

`worker` エージェントを起動して以下を実施する:
- エラーメッセージの解析
- 関連コードの読み込みと調査
- 根本原因の特定（表面的な原因ではなく根本）
- 影響範囲の特定

### Step 3: 修正案の提示

診断結果をもとに修正案を提示する（複数ある場合はトレードオフを示す）:
- 即時修正案（最小限の変更）
- 根本的修正案（再発防止を含む）

**修正の実装は `worker` に委譲する（`/harness-work --fix` を使用）。**

### Step 4: 再発防止策の提案

- テストケースの追加（worker に委譲可能）
- バリデーションの強化
- ドキュメントへの注意事項追加

### Step 5: Plans.md へのタスク追加（必要に応じて）

修正・防止策が即時実施できない場合、`Plans.md` に `[fix]` タスクとして追加する:

```markdown
- [ ] [fix] {問題の概要}（再現条件: {条件}）
  - AC: {修正完了の条件}
  - AC: テストで再発を防止できること
```

**よくある問題パターン** (プロジェクト固有の問題は CLAUDE.md / AGENTS.md / プロジェクト固有 skill を参照):

| 問題カテゴリ | 一般的な調査先 |
|-----|--------|
| 外部 API / LLM API エラー | `.env` の関連 API キー（長さのみ確認）、レートリミット、モデル名 / エンドポイント |
| データ整合性エラー | プロジェクト固有のデータファイル / ディレクトリの存在・スキーマ整合性 (`CLAUDE.md` で宣言) |
| 出力フォーマット不整合 | シリアライザの出力仕様、既存ファイルとのマージ処理 |

**注意事項**:
- プロジェクト固有の保護ディレクトリ (`protectedDirectories`) への書き込みは行わない
- `.env` ファイルの中身を直接表示しない（長さのみ確認、guardrail R13 が遮断）
- 修正の実装は必ず `worker` に委譲する

---

## Maintenance フロー（`maintenance` / 旧 /maintenance）

定期的な保守作業をまとめて実施する。検出した問題の**自動修正は行わない**（ユーザー承認後に worker に委譲）。

### 1. 依存パッケージの確認

プロジェクトの package manager に応じて実行:

```bash
# Python:       python3 -m pip list --outdated
# Node.js:      npm outdated
# Rust:         cargo outdated
# Go:           go list -u -m all
```

- セキュリティ上重要な更新がある場合は警告
- **実際の更新はユーザー承認後のみ実施**（自動 upgrade は禁止）

### 2. コード品質チェック

プロジェクトの lint / typecheck コマンドを実行:

```bash
# プロジェクトの慣用コマンドに従う:
#   Python:   ruff check / mypy (pyproject.toml あり)
#   Node.js:  npm run lint / npm run typecheck
#   Rust:     cargo clippy / cargo check
#   Go:       go vet ./... / golangci-lint run
# 実コマンドは harness.config.json の work.testCommand / project scripts を参照
```

### 3. プロジェクト固有データの整合性確認 (該当する場合)

プロジェクトに固有のデータディレクトリ (`CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md` で宣言) がある場合:

- 必要なファイルの存在確認
- スキーマ / ヘッダーの整合性チェック
- 空ファイルや破損の有無

具体手順は project-local skill (`.claude/skills/*`) に委譲。

### 4. ログの整理 (該当する場合)

プロジェクトが内部 log を持つ場合 (path は `harness.config.json` の `work.changeLogFile` 等で受ける):
- ファイルサイズ確認
- 長大な場合は警告
- 直近エントリの要約表示

### 5. ハーネスファイルの整合性

`integrity` フローを内部的に呼び出す（後述）。

### 6. Plans.md の整合性

- 完了タスクが「完了」セクションに適切に移動されているか確認
- 長期間「進行中」のままになっているタスクを警告
- 未着手タスクの件数を表示

### 保守レポートフォーマット (汎用テンプレート)

```
<project-name> — 保守チェック レポート

1. 依存パッケージ
  ✅ 最新: <package-list>
  ⚠️  更新あり: <package> (<old-version> → <new-version>)

2. コード品質
  ✅ lint / typecheck: クリーン

3. プロジェクト固有データ整合性 (該当する場合)
  ✅ <project-specific check result>

4. ログ
  ✅ <log-file>: <lines>行（正常範囲）

5. ハーネス整合性
  ✅ 全フック: 存在・実行権限あり

6. Plans.md
  未着手: N件 / 進行中: N件 / 完了: N件
```

---

## Harness Integrity フロー（`integrity` / 旧 /harness-review）

ハーネスの全ファイル存在確認・整合性チェック・構文検証を実施する。

### Step 1: Plugin コアファイルの確認

**harness plugin の核ファイル存在確認**:
```text
plugins/harness/
├── .claude-plugin/plugin.json    # manifest
├── hooks/hooks.json              # hook 登録
├── scripts/hook-dispatcher.mjs   # hook dispatcher
└── core/dist/index.js            # compiled core
```

**hooks.json と settings の整合性確認**:
- `hooks/hooks.json` に登録された hook が `scripts/` 内に存在するか
- プロジェクト側の `.claude/settings.local.json` と矛盾がないか

### Step 2: プロジェクト設定の整合性確認

- `harness.config.json` が存在するか
- `harness.config.json` のフィールドが `harness-work.md` の spec と一致するか
- `CLAUDE.md` が存在するか
- `Plans.md` が存在するか (プロジェクトで使用している場合)

### Step 3: エージェント定義ファイルの確認

```
plugins/harness/agents/
├── worker.md
├── reviewer.md
├── scaffolder.md
├── security-auditor.md
├── codex-sync.md
└── coderabbit-mimic.md
```

### Step 4: コマンド定義ファイルの確認

```
plugins/harness/commands/
├── harness-plan.md
├── harness-work.md
├── harness-review.md
├── harness-release.md
├── harness-setup.md
├── branch-merge.md
├── new-feature-branch.md
├── coderabbit-review.md
├── codex-team.md
├── parallel-worktree.md
├── pseudo-coderabbit-loop.md
└── tdd-implement.md
```

### Step 5: レポート出力

```
ハーネスレビューレポート

フックスクリプト
| スクリプト | 存在 | 実行権限 | 構文 | settings登録 |
|-----------|------|---------|------|------------|
| pretooluse-guard.sh | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |

エージェント定義
| ファイル | 存在 |
|---------|------|
| worker.md | ✅/❌ |

コマンド定義
| ファイル | 存在 |
|---------|------|
| harness-plan.md | ✅/❌ |

総合判定: ✅ すべて正常 / ❌ {問題件数}件の問題あり
```

---

## CodeRabbit Review Loop（`coderabbit`）

**本フローは `/coderabbit-review` スキルに委譲する。**

`/harness-review coderabbit <pr-number>` で呼ばれた場合、内部的に `/coderabbit-review <pr-number>` を起動する。

`/coderabbit-review` は以下を提供:
- Clear 3 段判定 (APPROVED / unresolved=0 / rate-limited marker 不在)
- Rate limit 検出 + `/pseudo-coderabbit-loop` への自動切替
- AI スラップ除去

詳細は `commands/coderabbit-review.md` を参照。

---

## 異常検知

| 状況 | アクション |
|------|----------|
| セキュリティ脆弱性（APIキー露出等） | 即座に REQUEST_CHANGES |
| テスト改ざん疑い | 警告 + 修正要求 |
| force push 試み | 拒否 + 代替案提示 |

---

## 関連スキル

- `harness-work` — レビュー後に修正を実装（`--fix`、`--feature`）
- `harness-plan` — 計画を作成・修正（`create`、`sync`）
- `harness-release` — レビュー通過後にリリース
