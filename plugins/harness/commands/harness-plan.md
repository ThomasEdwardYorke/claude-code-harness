---
name: harness-plan
description: "Unified planning skill for Harness v3. Handles task planning, Plans.md management, progress sync, and development principles. Use when user mentions: create a plan, add tasks, update Plans.md, sync status, check progress, show principles, /harness-plan, /plan-with-agent, /sync-status, /principles. Do NOT load for: implementation, code review, or release tasks."
description-ja: "Harness v3 統合プランニングスキル。タスク計画・Plans.md管理・進捗同期・開発原則表示を担当。以下のフレーズで起動: 計画を作る、タスクを追加、Plans.md更新、同期確認、進捗確認、原則を表示、/harness-plan、/plan-with-agent、/sync-status、/principles。実装・レビュー・リリースには使わない。"
allowed-tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebSearch", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput"]
argument-hint: "[create|sync|principles]"
---

# Harness Plan (v3)

Harness v3 の統合プランニングスキル。
以下の旧スキルを統合:

- `plan-with-agent` — アイデア → Plans.md への落とし込み（reviewer・reviewer エージェント呼び出し）
- `sync-status` — Plans.md と実装の同期確認・不一致検出
- `principles` — このプロジェクトの開発原則一覧表示

---

## Quick Reference

| ユーザー入力 | サブコマンド | 動作 |
|------------|------------|------|
| "計画を作って" / "plan-with-agent" | `create` | 対話型ヒアリング → reviewer → reviewer → Plans.md 保存 |
| "同期確認" / "sync-status" | `sync` | Plans.md と実装の不一致を検出・更新提案 |
| "原則を見せて" / "principles" | `principles` | 開発原則一覧を表示 |

---

## サブコマンド詳細

### create — 計画作成（旧 /plan-with-agent）

アイデアや要件を受け取り、受け入れ基準（AC）付きの構造化タスクとして `Plans.md` に保存する。

#### 実行フロー

**Step 1: 要件ヒアリング**

ユーザーのアイデア・課題・ゴールを確認する。
以下の情報を収集する:
- **何を**: 実装・改善・修正したい機能や問題
- **なぜ**: 動機・目標・期待する効果
- **制約**: 変更してはいけないこと（API互換性、既存動作）

**Step 2: タスク分解**

独立した実装可能なサブタスクに分解する。
各タスクに以下を付与する:
- **ラベル**: `[feature]` / `[fix]` / `[improve]` / `[test]` / `[docs]` / `[refactor]` / `[security]`
- **受け入れ基準（AC）**: 完了判定できる具体的な条件

```markdown
- [ ] [feature] extract_keywords を単独メソッド化
  - AC: 既存の動作を変えず、単体テストが書ける粒度にする
  - AC: the main class の他のメソッドから独立して呼び出し可能

- [ ] [test] extract_keywords の単体テストを追加
  - AC: モックなしで実行可能（入力・出力のみ検証）
  - AC: エッジケース（空文字・長文）のカバレッジあり
```

**Step 3: reviewer による分析**

`reviewer` エージェントを起動して以下を検証する:
- 粒度が適切か（1〜2時間以内のサイズか）
- 依存関係が正しくマッピングされているか
- 並列実行可能なタスクが逐次になっていないか
- リスクが高いタスクの特定

**Step 4: reviewer による評価**

`reviewer` エージェントを起動して赤チームレビューを実施する:
- 目標を達成できるタスク構成か
- 見落とされた依存はないか
- 代替アプローチはないか
- 判定: `approve` / `revise_recommended` / `revise_required`

**Step 5: 修正（revise の場合）**

指摘事項をもとにタスクを再構成する。
`revise_required` の場合は Step 3 から再実行する。

**Step 6: Plans.md への書き込み**

`Plans.md` の「未着手」セクションに追加する:

```markdown
- [ ] [ラベル] タスク名（概要）
  - AC: {受け入れ基準1}
  - AC: {受け入れ基準2}
```

#### 注意事項

- `Plans.md` が存在しない場合は新規作成する
- 既存タスクと重複する内容は統合を提案する
- 1回のセッションで追加するタスクは最大10件を目安にする

---

### sync — 進捗同期（旧 /sync-status）

`Plans.md` のタスクステータスと実際の実装状態の不一致を検出して更新提案を行う。

#### 実行フロー

**Step 1: Plans.md の全タスク読み込み**

`Plans.md` を読み込み、以下を把握する:
- 「未着手」タスクの全件リスト
- 「進行中」タスクの全件リスト
- 「完了」タスクの全件リスト

**Step 2: 変更ログの確認**

`.claude/logs/change-log.txt` を読み込み、直近のファイル変更履歴を確認する。

**Step 3: 実装状態の確認**

各タスクに関連するコード・ファイルを確認する:
- 「未着手」タスクに対応する実装がすでに存在するか
- 「完了」タスクの実装が削除・破壊されていないか
- 「進行中」タスクの実装が途中になっていないか

確認対象ファイル:
- the main module / the entry module (リポジトリ規約に従う)
- `tests/` ディレクトリ（存在する場合）
- プロジェクト固有の data ディレクトリ (CLAUDE.md / AGENTS.md で宣言されていれば参照)

**Step 4: 不一致の検出**

| パターン | 説明 |
|---------|------|
| **実装済み・未完了** | コードに実装が存在するが Plans.md が「未着手」 |
| **完了済み・実装なし** | Plans.md が「完了」だが対応コードが見当たらない |
| **長期進行中** | 「進行中」のまま長期間放置されているタスク |
| **孤立タスク** | 依存するタスクが「完了」しているのに「未着手」のまま |

**Step 5: 更新提案の表示**

```
Plans.md 同期チェック結果

一致: N件
不一致: N件

【実装済み・未完了マーク】
  - [ ] [feature] extract_keywords を単独メソッド化
    → the main module に実装が確認されました
    → 「完了」への移動を提案します

【完了済み・実装なし】
  - [x] [fix] save_script_json の文字数バリデーション
    → 対応コードが見当たりません
    → 「未着手」に戻すことを提案します
```

**Step 6: ユーザー確認後に更新を適用**

表示した提案についてユーザーに確認を取り、承認された項目のみ `Plans.md` を更新する。

#### 注意事項

- `Plans.md` の自動更新はユーザー承認後のみ実施する
- 不明確な場合は「不明」として報告し、ユーザーに判断を委ねる
- sync check 自体は read-only。プロジェクト固有のデータディレクトリへの書き込みは行わない

---

### principles — 開発原則一覧（旧 /principles）

プロジェクトの開発原則を一覧表示し、実装時の判断基準を提供する。

**本スキルは汎用テンプレートを提供する。プロジェクト固有の業務原則 (API 制約 / UI 仕様 / 業務ルール / 保護データ扱い等) は `CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md` に記載し、本スキルはそれらを読み込んで合わせて表示する。**

#### 汎用テンプレート (全プロジェクト共通)

**コード品質**

| 原則 | 詳細 |
|------|------|
| **定数化** | モデル名・パス・設定値の直書き禁止。設定や定数として定義する |
| **後方互換性の維持** | 既存の public API / function signatures を不用意に変えない |
| **スタブ禁止** | `pass`, `TODO`, `...` で終わる実装は完成とみなさない |

**セキュリティ**

| 原則 | 詳細 |
|------|------|
| **API キーは環境変数のみ** | `OPENAI_API_KEY` 等はコードへの直書き禁止、`.env` / 秘匿ストアからのみ読み込む |
| **秘匿ファイルへの直接アクセス禁止** | `cat .env`, `head .env` 等はブロックされる (guardrail R13) |
| **保護データの取り扱い** | プロジェクト固有の保護データディレクトリは `protectedDirectories` / `.claude/rules/*.md` で宣言し、guardrail が書き込みを遮断する |

**禁止事項**

| 禁止 | 理由 |
|------|------|
| **ハードコーディング** | モデル名・パス・設定値を直書きしない（保守性低下） |
| **スタブ実装** | `pass`/`TODO`/`...` で終わる実装を完成と称しない |
| **テストの削除・改ざん** | テストカバレッジの意図的な低下を防ぐ |

**実装ガイドライン**

| ガイドライン | 詳細 |
|------------|------|
| **読んでから書く** | 変更前に必ず対象ファイルを `Read` ツールで確認する |
| **最小変更の原則** | 要求された変更のみ実施し、不要なリファクタリングをしない |
| **既存テストを壊さない** | 変更後も全既存テストがパスすること |
| **エラーハンドリング** | 外部 API 呼び出しには適切なエラーハンドリングを追加する |

**プロジェクト固有の追加原則**

- `CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md` / `harness.config.json` の `protectedDirectories` / `protectedFileSuffixes` / `protectedEnvVarNames` を参照
- これらのファイルに記載された原則 (業務制約 / UI ルール / 命名規約 / API 互換性要件 等) を本スキルは併せて表示する

**エージェント別の原則適用**

| エージェント | 遵守事項 |
|------------|---------|
| `worker` | 禁止事項と実装ガイドラインを全て遵守。実装前に Read で確認。プロジェクト固有の制約は CLAUDE.md / AGENTS.md を参照 |
| `reviewer` | ハードコーディング・スタブ実装・後方互換性破壊・プロジェクト固有制約違反を特定。セキュリティ原則の遵守確認 |

---

## Plans.md フォーマット規約

```markdown
## 未着手
- [ ] [feature] タスク名
  - AC: 受け入れ基準1
  - AC: 受け入れ基準2

## 進行中
- [ ] [fix] タスク名（実装中）

## 完了
- [x] [feature] 完了したタスク名
```

ラベル: `[feature]`, `[fix]`, `[improve]`, `[test]`, `[docs]`, `[refactor]`, `[security]`

---

## 関連スキル

- `harness-work` — 計画したタスクを実装する（旧 /work、/breezing 等）
- `harness-review` — 実装のレビュー・トラブルシュート・保守
- `harness-release` — バージョンバンプ・ブランチマージ・リリース
- `harness-setup` — プロジェクト初期化・ハーネス整合性確認
