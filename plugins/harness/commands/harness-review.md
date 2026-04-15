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
| **Compatibility** | `create_script_from_url`/`create_script_from_sentence` の後方互換性 |

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

- **APPROVE**: 自動コミット実行（`--no-commit` でなければ）
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

**よくある問題パターン**:

| 問題 | 調査先 |
|-----|--------|
| `create_script` が空のページを返す | `protected-data/{genre}.csv` の存在・ヘッダー整合性 |
| the LLM API エラー | `.env` の `OPENAI_API_KEY`（長さのみ確認）、レートリミット、モデル名 |
| `the output artifact` のスキーマ不正 | `save_script_json` の出力フォーマット、既存ファイルとのマージ処理 |

**注意事項**:
- `protected-data/` への書き込みは行わない
- `.env` ファイルの中身を直接表示しない（長さのみ確認）
- 修正の実装は必ず `worker` に委譲する

---

## Maintenance フロー（`maintenance` / 旧 /maintenance）

定期的な保守作業をまとめて実施する。検出した問題の**自動修正は行わない**（ユーザー承認後に worker に委譲）。

### 1. 依存パッケージの確認

```bash
python3 -m pip list --outdated
```

チェック対象: `openai`, `python-dotenv`, `requests`, `beautifulsoup4`, `pydantic`
- セキュリティ上重要な更新がある場合は警告
- **実際の更新はユーザー承認後のみ実施**（`pip install --upgrade` は自動実行しない）

### 2. コード品質チェック

```bash
python3 -m py_compile the main module
python3 -m py_compile the entry module
```

### 3. protected-data/ の整合性確認

- 全9ジャンルの CSV ファイル存在確認
- ヘッダー行の整合性チェック（全 CSV で同じ列構成か）
- 空ファイルや壊れた CSV がないか確認

### 4. ログの整理

- `.claude/logs/change-log.txt` のサイズ確認
- 1000 行を超えている場合は警告
- ログの内容を要約して表示（直近20件）

### 5. ハーネスファイルの整合性

`integrity` フローを内部的に呼び出す（後述）。

### 6. Plans.md の整合性

- 完了タスクが「完了」セクションに適切に移動されているか確認
- 長期間「進行中」のままになっているタスクを警告
- 未着手タスクの件数を表示

### 保守レポートフォーマット

```
script_generate — 保守チェック レポート

1. 依存パッケージ
  ✅ 最新: openai, pydantic
  ⚠️  更新あり: requests (2.31.0 → 2.32.0)

2. コード品質
  ✅ 構文エラー: なし

3. protected-data/ 整合性
  ✅ 9件のCSVが存在します

4. ログ
  ✅ change-log.txt: 234行（正常範囲）

5. ハーネス整合性
  ✅ 全フック: 存在・実行権限あり

6. Plans.md
  未着手: 2件 / 進行中: 0件 / 完了: 8件
```

---

## Harness Integrity フロー（`integrity` / 旧 /harness-review）

ハーネスの全ファイル存在確認・整合性チェック・構文検証を実施する。

### Step 1: フックスクリプトの確認

**ファイル存在確認**:
```
.claude/hooks/
├── pretooluse-guard.sh
├── posttooluse-test-runner.sh
├── session-init.sh
├── change-tracker.sh
├── session-end.sh
├── notification.sh
├── hardcode-detector.sh
├── test-enforcer.sh
├── import-checker.sh
└── api-key-scanner.sh
```

**実行権限確認**:
```bash
ls -la .claude/hooks/*.sh
# 実行権限がない場合: chmod +x .claude/hooks/*.sh
```

**シェル構文チェック**:
```bash
for f in .claude/hooks/*.sh; do
  bash -n "$f" && echo "OK: $f" || echo "SYNTAX ERROR: $f"
done
```

### Step 2: settings.local.json の整合性確認

| イベント | matcher | フック |
|---------|---------|--------|
| PreToolUse | Bash | pretooluse-guard.sh |
| PreToolUse | Bash\|Edit\|Write | test-enforcer.sh |
| PostToolUse | Edit\|Write | posttooluse-test-runner.sh |
| PostToolUse | Edit\|Write | change-tracker.sh |
| PostToolUse | Edit\|Write | hardcode-detector.sh |
| PostToolUse | Edit\|Write | import-checker.sh |
| PostToolUse | Edit\|Write | api-key-scanner.sh |
| SessionStart | — | session-init.sh |
| SessionEnd | — | session-end.sh |

### Step 3: エージェント定義ファイルの確認

```
.claude/agents/
├── worker.md
├── worker.md
├── reviewer.md
├── worker.md
├── worker.md
├── scaffolder.md
└── security-auditor.md
```

### Step 4: コマンド定義ファイルの確認

```
.claude/commands/
├── harness-plan.md
├── harness-work.md
├── harness-review.md
├── harness-release.md
└── harness-setup.md
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

## CodeRabbit Review Loop（`coderabbit` / 旧 /coderabbit-review）

GitHub PR へのプッシュ → CodeRabbit レビュー対応を繰り返すワークフロー。

> CodeRabbit 未設定の場合: `gh pr checks <pr_number>` で `coderabbitai` が表示されない場合、CodeRabbit が未設定の可能性がある。設定が必要かどうかユーザーに確認する。

### Step 1: 変更をプッシュ

```bash
git add <files>
git commit -m "<prefix>: <message>"
git push origin <branch>
```

### Step 2: レビューステータスを確認

プッシュ後、CodeRabbit のレビューには 1〜3 分かかることがある。

```bash
gh pr checks <pr_number>
# coderabbitai ... pending → 待機
# coderabbitai ... pass → 完了
```

pending の場合、30〜60秒後に再確認。3回確認しても pending の場合はユーザーに報告して指示を仰ぐ。

### Step 3: レビュー内容を取得

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --jq '.[-1].body'
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --jq '.[-1] | {submitted_at, state}'
```

### Step 4: 指摘に対応

- **Actionable comments**: 対応必須
- **Nitpick comments**: 任意の改善提案（対応推奨）
- **Additional comments**: 確認済み・問題なし

### Step 5: 修正をコミット・プッシュして繰り返し

```bash
git add <modified-files>
git commit -m "fix: CodeRabbitレビュー指摘対応

- <対応内容1>
- <対応内容2>"
git push origin <branch>
```

Step 2 に戻り、指摘がなくなるまで繰り返す。

### Step 6: AIスラップ除去（リファクタリング）

レビュークリア後のクリーンアップとして AI 生成コードの不要物を除去する:
- 人間なら書かない余計なコメント
- 過剰な防御的チェックや不要な try/catch
- ファイルのスタイルと不一致なコード

### 完了条件

- 最新レビューで Actionable comments: 0
- 最新レビューで Nitpick comments: 0（または「対応不要」と明記）
- AIスラップ除去を実行済み
- リファクタリング後のレビューもクリア

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
