---
name: harness-work
description: "Unified execution skill for Harness v3. Implements Plans.md tasks with auto mode detection (1 task=Solo, 2-3=Parallel, 4+=Breezing). Integrates bug fix and feature add flows. Use when user mentions: implement, execute, fix bug, add feature, test pipeline, /harness-work, /work, /breezing, /fix-bug, /add-feature, /test-pipeline, build features, run tasks, --codex, --parallel. Do NOT load for: planning, code review, release, or setup."
description-ja: "Harness v3 統合実行スキル。Plans.md タスクをAuto Mode Detection（1件=Solo、2-3件=Parallel、4件以上=Breezing）で実行。バグ修正・機能追加・パイプライン検証フローを統合。以下で起動: 実装して、バグ修正、機能追加、パイプライン確認、/harness-work、/work、/breezing、/fix-bug、/add-feature、/test-pipeline、--codex、--parallel。プランニング・レビュー・リリース・セットアップには使わない。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task"]
argument-hint: "[all|task-number] [--fix <説明>|--feature <機能名>|--test-pipeline] [--codex] [--parallel N] [--breezing] [--no-commit] [--sequential]"
---

# Harness Work (v3)

Harness v3 の統合実行スキル。
以下の旧スキルを統合:

- `work` — Plans.md タスクの実装（スコープ自動判断）
- `breezing` — 全未着手タスクの並列・逐次一括実装
- `fix-bug` — バグ診断（worker）→ 修正（worker）→ 検証（worker）
- `add-feature` — 機能実装（worker）→ 検証（worker）→ レビュー（reviewer）
- `test-pipeline` — コストゼロのパイプライン確認（CSV・スキーマ・文字数制限）

---

## Quick Reference

| ユーザー入力 | モード | 動作 |
|------------|--------|------|
| `/harness-work` | **auto** | タスク数で自動判定（下記参照） |
| `/harness-work all` | **auto** | 全未完了タスクを自動モードで実行 |
| `/harness-work 3` | solo | タスク3だけ即実行 |
| `/harness-work --fix <説明>` | fix-bug | バグ修正フロー |
| `/harness-work --feature <機能名>` | add-feature | 機能追加フロー |
| `/harness-work --test-pipeline` | test-pipeline | パイプライン検証（コストゼロ） |
| `/harness-work --parallel 5` | parallel | 5ワーカーで並列実行（強制） |
| `/harness-work --breezing` | breezing | Agent Teams でチーム実行（強制） |
| `/harness-work --codex` | codex | Codex CLI に委託（明示時のみ） |

---

## Auto Mode Detection（フラグなし時の自動判定）

明示的なモードフラグ（`--parallel`, `--breezing`, `--codex`）がない場合、
対象タスク数に応じて最適なモードを自動選択する:

| 対象タスク数 | 自動選択モード | 理由 |
|-------------|---------------|------|
| **1 件** | Solo | オーバーヘッド最小。直接実装が最速 |
| **2〜3 件** | Parallel（Task tool） | Worker 分離のメリットが出始める閾値 |
| **4 件以上** | Breezing（Agent Teams） | Lead 調整 + Worker 並列 + Reviewer 独立の三者分離が効果的 |

### ルール

1. **明示フラグは常にオートモードを上書き**する
   - `--parallel N` → Parallel モード（タスク数に関係なく）
   - `--breezing` → Breezing モード（タスク数に関係なく）
   - `--codex` → Codex モード（タスク数に関係なく）
2. **`--codex` は明示時のみ発動**。Codex CLI が未インストールの環境があるため、自動選択しない
3. `--codex` は他モードと組み合わせ可能: `--codex --breezing` → Codex + Breezing

---

## オプション

| オプション | 説明 | デフォルト |
|----------|------|----------|
| `all` | 全未完了タスクを対象 | - |
| `N` or `N-M` | タスク番号/範囲指定 | - |
| `--fix <説明>` | バグ修正フローを起動 | - |
| `--feature <機能名>` | 機能追加フローを起動 | - |
| `--test-pipeline` | パイプライン検証フローを起動 | - |
| `--parallel N` | 並列ワーカー数 | auto |
| `--sequential` | 直列実行強制 | - |
| `--codex` | Codex CLI で実装委託（明示時のみ） | false |
| `--no-commit` | 自動コミット抑制 | false |
| `--breezing` | Agent Teams でチーム実行 | false |

---

## 実行フロー詳細

### Solo モード（1 件時の自動選択）

**Step 1: Plans.md の確認**

`Plans.md` を読んで「未着手」セクションのタスク一覧を確認する。

優先順位:
1. `[fix]` ラベル（バグ修正）
2. `[improve]` ラベル（機能改善）
3. `[feature]` ラベル（新機能）
4. `[test]` ラベル（テスト追加）
5. `[docs]` ラベル（ドキュメント）

**Step 2: タスク選択と状態更新**

最優先タスクを1つ選んで「進行中」セクションに移動して「（実装中）」を付記する。

**Step 3: 実装前調査（worker として）**

- 変更対象ファイルを Read で読む
- 関連コードを Grep で検索する
- 既存のパターン・規約を把握する

**Step 4: 実装（worker の禁止事項を遵守）**

- ハードコーディング禁止（モデル名、パス等）
- スタブ実装禁止（`pass`/`TODO`/`...` で終わらない）
- `protected-data/` の変更禁止
- テストの削除・改ざん禁止
- 後方互換性の破壊禁止

**Step 5: 品質チェック**

```bash
# Python 構文チェック
python3 -m py_compile the main module
python3 -m py_compile the entry module
```

変更した `.py` ファイルがあれば、`worker` エージェントを使って以下を確認する:
- `the output artifact` スキーマ検証
- 文字数制限チェック（上段 ≤10 文字/行、下段 ≤11 文字/行）
- CSV ロードへの影響確認

**Step 6: Plans.md 更新**

```markdown
## 完了
- [x] [feature] タスク名
```

---

### Parallel モード（2〜3 件時の自動選択 / `--parallel N` で強制）

`Task` ツールで独立タスクを N ワーカーで並列実行。
同一ファイルへの書き込みが競合する場合は逐次実行に切り替える。

依存関係の判断基準:
- `[feature] A → [test] A のテスト追加` → A のテストは A の実装後（依存）
- `[fix] バグ修正 + [docs] ドキュメント更新` → 互いに独立（並列可能）

---

### Breezing モード（4 件以上で自動選択 / `--breezing` で強制）

Agent Teams（Worker + Reviewer）でチーム実行。

```
Lead (this agent)
├── Worker (worker agent) — 実装担当
└── Reviewer (reviewer agent) — レビュー担当
```

フロー:
1. Lead: タスク割り当て
2. Worker: 実装 → 「完了」マーク
3. Reviewer: コードレビュー → APPROVE / REQUEST_CHANGES
4. REQUEST_CHANGES の場合: 修正タスクを作成 → 再実装

全完了後、Plans.md を一括更新する。

---

### Codex モード（`--codex` 明示時のみ）

**Step 0: Codex CLI 確認**

```bash
codex --version
# 未済なら: npm install -g @openai/codex
```

**Step 1: 状態ファイル初期化**

```bash
mkdir -p .claude/state
cat > .claude/state/work-active.json <<EOF
{
  "active": true,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "strategy": "iteration",
  "codex_mode": true
}
EOF
```

**Step 2: タスク選択 & プロンプトファイル生成**

```bash
TIMEOUT=$(command -v timeout || command -v gtimeout || echo "")
CODEX_PROMPT=$(mktemp /tmp/codex-prompt-XXXXXX.md)
# タスク内容とプロジェクトルールを書き出し
cat "$CODEX_PROMPT" | $TIMEOUT 120 codex exec - -a never -s workspace-write 2>>/tmp/harness-codex-$$.log
rm -f "$CODEX_PROMPT"
```

**Step 3: Quality Gates**

| Gate | コマンド | 失敗時 | 最大リトライ |
|------|---------|--------|------------|
| lint | `python3 -m py_compile the main module && python3 -m py_compile the entry module` | 修正指示付きで再呼び出し | 3 回 |
| test | `pytest`（tests/ 存在時のみ） | 修正指示付きで再呼び出し | 3 回 |
| tamper | diff で `it.skip` / アサーション削除 / テスト削除を検出 | 即停止・state クリア | 0 回 |

**Step 4: Plans.md 更新 & 状態クリア**

```bash
rm -f .claude/state/work-active.json
```

---

## バグ修正フロー（`--fix` / 旧 /fix-bug）

`--fix <バグの説明>` または Plans.md の `[fix]` タスクを選択して実行する。

### Step 1: バグの特定

**引数なし**: `Plans.md` から `[fix]` ラベルのタスクを最優先で選択。
**引数あり**: Plans.md にタスクを追加:
```markdown
- [ ] [fix] {バグの説明}（実装中）
```

### Step 2: 診断（worker エージェント）

worker エージェントとして:
1. エラーメッセージ・スタックトレースを解析
2. 該当ファイルを Read して根本原因を特定
3. 修正案を提示

### Step 3: 実装（worker エージェント）

worker エージェントとして:
1. 診断結果の修正案を実装
2. 既存テストへの影響を確認
3. 構文チェック: `python3 -m py_compile {修正ファイル}`

worker の禁止事項を遵守（ハードコーディング禁止・スタブ禁止・protected-data 変更禁止・テスト削除禁止）。

### Step 4: 検証（worker エージェント）

worker エージェントとして:
1. 修正したファイルの影響範囲を確認
2. `the output artifact` スキーマが崩れていないか検証
3. 文字数制限チェック（上段 ≤10 文字/行、下段 ≤11 文字/行）
4. CSV ロードに影響がないか確認

### Step 5: Plans.md 更新

```markdown
## 完了
- [x] [fix] {バグの説明}
```

**禁止事項**:
- 根本原因を特定せずに対症療法だけを行うこと
- 修正によって他の機能が壊れること（後方互換性の破壊）
- テストを削除または改ざんしてエラーを隠蔽すること

---

## 機能追加フロー（`--feature` / 旧 /add-feature）

`--feature <機能名>` または Plans.md の `[feature]` タスクを選択して実行する。

### Step 1: 機能の特定

**引数なし**: `Plans.md` から `[feature]` ラベルのタスクを最優先で選択。
**引数あり**: Plans.md にタスクを追加:
```markdown
- [ ] [feature] {機能名}（実装中）
```

### Step 2: 実装前調査

実装に入る前に必ず確認:
1. `the main module` を Read して既存実装を把握
2. 追加する機能の影響範囲を Grep で確認
3. 既存のパターン・規約を確認

### Step 3: 実装（worker エージェント）

worker エージェントとして最小限の変更で機能を追加する。
worker の禁止事項を遵守（ハードコーディング禁止・スタブ禁止・protected-data 変更禁止・テスト削除禁止・後方互換性破壊禁止）。

### Step 4: 検証（worker エージェント）

worker エージェントとして:
1. 追加した機能が `the output artifact` スキーマに影響しないか確認
2. CSV ロードへの影響を確認
3. 文字数制限チェック（上段 ≤10 文字/行、下段 ≤11 文字/行）

### Step 5: コードレビュー（reviewer エージェント）

reviewer エージェントとして:
1. 実装されたコードのレビューを実施
2. Critical な問題があれば worker に差し戻して修正
3. Warning は Plans.md に改善タスクとして記録

### Step 6: Plans.md 更新

```markdown
## 完了
- [x] [feature] {機能名}
```

Warning レベルの改善事項があれば:
```markdown
## 未着手
- [ ] [improve] {改善内容}（/add-feature {機能名} のレビューから）
```

**禁止事項**:
- 要件外の機能の追加（スコープクリープ）
- 既存インターフェースの破壊
- テストなしの複雑な機能追加

---

## パイプライン検証フロー（`--test-pipeline` / 旧 /test-pipeline）

API を呼び出さないコストゼロのパイプライン確認。

### Step 1: 依存関係の確認

```python
python3 -c "import openai, dotenv, requests, bs4, pydantic; print('依存関係 OK')"
```

### Step 2: protected-data/ の全 CSV ロード確認

9ジャンルの CSV ファイル存在・件数・列数を確認する:
`感動系`, `スカっと系`, `笑える系`, `興味深い系`, `逆転劇系`, `凄いこと成し遂げた系`, `変な癖や習慣がある人系`, `今話題になっている系`, `その他`

### Step 3: the main class クラスのインポート確認

パッケージインポート → 失敗時は直接インポートを試みる。

### Step 4: the output artifact スキーマ検証（存在する場合）

- 必須キー確認: `meta_data`, `other_info`, `page`
- 文字数チェック: 上段 ≤10 文字/行、下段 ≤11 文字/行

### Step 5: テスト結果サマリー出力

```
パイプラインテスト結果

依存関係: ✅ 全パッケージ利用可能
protected-data/ CSV: ✅ 全9ジャンル確認済み
the main class インポート: ✅
the output artifact スキーマ: ✅ / ℹ️ ファイルなし（未実行）

総合判定: ✅ パイプライン正常
```

このフローは **API を呼び出さない**（コストゼロ）。

---

## CI 失敗時の対応

CI が失敗した場合:
1. ログを確認してエラーを特定
2. 修正を実施
3. 同一原因で 3 回失敗したら自動修正ループを停止
4. 失敗ログ・試みた修正・残る論点をまとめてエスカレーション

---

## 関連スキル

- `harness-plan` — 実行するタスクを計画する（旧 /plan-with-agent、/sync-status）
- `harness-review` — 実装のレビュー・トラブルシュート・保守
- `harness-release` — バージョンバンプ・ブランチマージ・リリース
