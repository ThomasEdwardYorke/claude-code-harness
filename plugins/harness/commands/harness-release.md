---
name: harness-release
description: "Unified release skill for Harness v3. Handles branch creation, branch merge, CHANGELOG, version bump, tag, GitHub Release automation. Use when user mentions: release, version bump, create tag, publish, create branch, new feature branch, merge, /harness-release, /branch-merge, /new-feature-branch. Do NOT load for: implementation, code review, planning, or setup."
description-ja: "Harness v3 統合リリーススキル。新規featureブランチ作成・ブランチマージ・CHANGELOG・バージョンバンプ・タグ・GitHub Release を統合。以下で起動: リリース、バージョンバンプ、タグ作成、ブランチ作成、マージ、/harness-release、/branch-merge、/new-feature-branch。実装・コードレビュー・プランニング・セットアップには使わない。"
allowed-tools: ["Read", "Write", "Edit", "Bash"]
argument-hint: "[branch|merge|patch|minor|major|--dry-run]"
context: fork
---

# Harness Release (v3)

Harness v3 の統合リリーススキル。
以下の旧スキルを統合:

- `branch-merge` — feature → dev → main の順でマージし、各段階でテストを実行
- `new-feature-branch` — ブランチ戦略に則って正しく feature ブランチを作成
- リリース自動化 — CHANGELOG 更新・バージョンバンプ・タグ・GitHub Release

---

## Quick Reference

```bash
/harness-release branch <名前>   # 新規 feature ブランチ作成
/harness-release merge           # feature → dev → main マージ
/harness-release patch           # パッチバージョンバンプ + リリース
/harness-release minor           # マイナーバージョンバンプ + リリース
/harness-release major           # メジャーバージョンバンプ + リリース（破壊的変更）
/harness-release --dry-run       # プレビューのみ（実行しない）
```

---

## ブランチ戦略

このプロジェクトのブランチ構成:

| ブランチ | 用途 | マージ先 |
|----------|------|----------|
| `main` | 本番環境用。常に安定した状態を維持 | - |
| `dev` | 開発統合ブランチ。機能ブランチの統合先 | `main` |
| `feature/*` | 機能開発ブランチ。個別の機能実装に使用 | `dev` |

**命名規則**:
- 機能追加: `feature/add-*`
- バグ修正: `feature/fix-*`
- リファクタ: `feature/refactor-*`
- 改善: `feature/improve-*`
- ドキュメント: `feature/docs-*`
- 緊急修正: `hotfix/<issue番号>-<修正内容>`

**ブランチポリシー**:
- `main` への直接プッシュは避け、可能な限り PR 経由でマージする
- force push（`--force` / `--force-with-lease`）は常に禁止
- テストが失敗している状態では `main` へのマージを行わない

---

## Branch フロー（`branch` / 旧 /new-feature-branch）

新規開発を開始する際に、ブランチ戦略に則って正しく feature ブランチを作成する。

### Step 1: 作業状態の確認

```bash
git status
```

未コミットの変更がある場合はコミットまたはスタッシュしてから続行。

### Step 2: リモートの状態を取得

```bash
git fetch origin
```

`git pull` ではなく `git fetch`。ローカルを変更せずにリモート状態を確認する。

### Step 3: main/dev の状態確認

```bash
# mainにあってdevにないコミット
git log origin/dev..origin/main --oneline

# devにあってmainにないコミット
git log origin/main..origin/dev --oneline
```

| main→dev | dev→main | 状態 | 対応 |
|----------|----------|------|------|
| なし | なし | 完全同期 | Step 4へ |
| なし | あり | devが先行（リリース待ち） | ユーザーに確認後 Step 4へ |
| あり | なし | mainが先行（同期待ち） | devをmainに同期後 Step 4へ |
| あり | あり | 分岐（異常状態） | ユーザーに報告・手動解決 |

mainがdevより先行している場合の同期:
```bash
git checkout dev
git pull origin dev
git merge origin/main --ff-only
git push origin dev
```

### Step 4: ローカル dev の状態を確認

```bash
git checkout dev
git status
git pull origin dev  # behind の場合
```

### Step 5: feature ブランチを作成

```bash
# ブランチ名の重複確認
git branch -a | grep "feature/<branch-name>"

# 重複がなければ作成
git checkout -b feature/<branch-name>
```

### Step 6: リモートにプッシュ

```bash
git push -u origin feature/<branch-name>
```

### 完了報告

```
featureブランチ作成完了

| 項目 | 状態 |
|-----|------|
| リモート取得 | ✅ |
| main/dev状態 | ✅ [同期済み / devが先行] |
| ローカルdev | ✅ |
| ブランチ作成 | ✅ feature/<branch-name> |
| リモートプッシュ | ✅ |

次のステップ: 開発を開始してください
```

---

## Merge フロー（`merge` / 旧 /branch-merge）

feature → dev → main の順でマージし、各段階でテストを実行する。

### 前提条件

現在のブランチが `feature/*` であることを確認:
```bash
git branch --show-current
```

### Step 1: feature → dev マージ

```bash
git fetch origin
git checkout dev
git pull origin dev
git merge origin/<feature-branch> --no-ff -m "Merge <feature-branch> into dev"
git push origin dev
```

コンフリクト発生時: ユーザーに報告し、解決方法を相談。

### Step 2: dev でテスト実行

```bash
# プロジェクトの test command を実行する。優先順位:
#   1. harness.config.json の `release.testCommand` (明示設定)
#   2. harness.config.json の `work.testCommand`
#   3. package.json に `"test"` script があれば `npm test`
#   4. pyproject.toml + tests/ があれば `pytest tests/`
#   5. 該当なしなら警告 (skip)
#
# Language-specific example invocations (run manually only when `release.testCommand`
# is unset and the auto-detect heuristics miss):
# - Python (virtualenv + pytest): activate `.venv` then run `pytest`
# - Node.js:   `npm test`
# - Rust:      `cargo test`
# (Concrete `source .venv/...` / `PYTHONPATH=...` invocations intentionally omitted
# from the universal default to keep plugin core stack-neutral.)
```

| 結果 | 対応 |
|-----|------|
| 全テストパス | Step 3へ進む |
| テスト失敗 | ユーザーに報告、修正後に再実行 |
| 環境エラー | プロジェクトの依存セットアップ手順 (`pip install -r requirements.txt` / `npm install` / `cargo fetch` 等) を実行後に再実行 |

**重要**: テストが失敗した場合、**main へのマージは行わない**。

### Step 3: dev → main マージ

```bash
git checkout main
git pull origin main
git merge dev --no-ff -m "Merge dev into main: <summary>"
git push origin main
```

### Step 4: dev を main と同期（重要）

```bash
git checkout dev
git merge main --ff-only
git push origin dev
```

`--ff-only` が失敗する場合は異常状態 → 調査が必要。

### Step 5: main での動作確認

```bash
git checkout main
git pull origin main
# Step 2 と同じ手順でプロジェクトの test command を実行
# (harness.config.json の release.testCommand / work.testCommand / 自動検出)
```

### Step 6: feature ブランチの削除

削除前にユーザーに確認:
```
featureブランチを削除しますか？
- リモート: origin/<feature-branch>
- ローカル: <feature-branch>
```

ユーザー承認後:
```bash
git push origin --delete <feature-branch>
git branch -d <feature-branch>
git fetch --prune
```

### 完了報告

```
マージ完了

| 項目 | 状態 |
|-----|------|
| feature → dev | ✅ |
| devでテスト | ✅ (N件パス) |
| dev → main | ✅ |
| dev同期 | ✅ (mainと同期済み) |
| mainで動作確認 | ✅ |
| ブランチ削除 | ✅ / スキップ |
```

---

## Release フロー（`patch|minor|major`）

### Pre-flight チェック（必須）

```bash
# 1. gh コマンド確認
command -v gh &>/dev/null || echo "gh なし: GitHub Release はスキップ"

# 2. 未コミット変更確認
git diff --quiet && git diff --cached --quiet || {
  echo "未コミット変更あり。先にコミットしてください。"
  exit 1
}

# 3. CI 状態確認（gh がある場合）
gh run list --branch main --limit 3 --json status,conclusion 2>/dev/null || true
```

### Step 1: 現在バージョン取得

プロジェクト構成に応じて検出。Claude Code plugin の場合は `plugin.json` を primary source of truth とする:

```bash
# Claude Code plugin の場合（推奨）
CURRENT=$(jq -r .version plugins/*/.claude-plugin/plugin.json 2>/dev/null)

# 古い構成（VERSION file or root package.json）
CURRENT=${CURRENT:-$(cat VERSION 2>/dev/null)}
CURRENT=${CURRENT:-$(jq -r .version package.json 2>/dev/null)}
CURRENT=${CURRENT:-"0.0.0"}
```

### Step 2: 新バージョン算出（SemVer）

- `patch`: x.y.Z → x.y.(Z+1)（バグ修正）
- `minor`: x.Y.z → x.(Y+1).0（新機能・後方互換）
- `major`: X.y.z → (X+1).0.0（破壊的変更）

### Step 3: CHANGELOG 更新

Keep a Changelog 1.1.0 フォーマット（英語）+ `[Unreleased]` section の空 header を保持:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- **Feature name**: Description

### Changed
- **Change**: Description

### Fixed
- **Fix**: Description
```

比較 link も rewrite:

```markdown
[Unreleased]: <repo>/compare/vX.Y.Z...HEAD
[X.Y.Z]: <repo>/compare/v{prev}...vX.Y.Z
[{prev}]: <repo>/releases/tag/v{prev}  # 直近以外は tag link に migrate
```

### Step 4: バージョンファイル更新（全 manifest 同期）

version drift を避けるため、プロジェクトにある version 保持ファイル全てを一斉更新:

```bash
# (a) 古い構成: VERSION file
[ -f VERSION ] && echo "$NEW_VERSION" > VERSION

# (b) npm workspace（root + sub-workspaces 全部）
for pkg in package.json plugins/*/core/package.json plugins/*/package.json; do
  [ -f "$pkg" ] || continue
  jq --arg v "$NEW_VERSION" '.version = $v' "$pkg" > "$pkg.tmp" && mv "$pkg.tmp" "$pkg"
done

# (c) Claude Code plugin manifest
for pj in plugins/*/.claude-plugin/plugin.json; do
  [ -f "$pj" ] || continue
  jq --arg v "$NEW_VERSION" '.version = $v' "$pj" > "$pj.tmp" && mv "$pj.tmp" "$pj"
done

# (d) marketplace manifest (metadata.version + plugins[].version 両方)
if [ -f .claude-plugin/marketplace.json ]; then
  jq --arg v "$NEW_VERSION" '.metadata.version = $v | .plugins[].version = $v' \
    .claude-plugin/marketplace.json > mp.tmp && mv mp.tmp .claude-plugin/marketplace.json
fi

# (e) npm lockfile 再生成（workspaces 全体の version drift を解消）
[ -f package.json ] && npm install --package-lock-only
```

**Phase μ release guard (harness plugin 固有)**: `content-integrity.test.ts` に `EXPECTED_VERSION` / `EXPECTED_PREV_VERSION` / `EXPECTED_RELEASE_DATE` の hardcode 定数がある場合、手動で 3 箇所更新する (詳細は `docs/maintainer/release-process.md`)。forcing function として意図的に hardcode なので、release PR で必ず test 更新を伴う設計。

### Step 5: コミット & タグ

```bash
git add CHANGELOG.md package.json package-lock.json \
  plugins/*/.claude-plugin/plugin.json \
  plugins/*/core/package.json \
  .claude-plugin/marketplace.json 2>/dev/null
# Phase μ test がある場合
git add plugins/*/core/src/__tests__/content-integrity.test.ts 2>/dev/null

git commit -m "release: v$NEW_VERSION — <summary>"
# main にマージしてから tag を打つ（feature branch 経由の場合）
git tag -a "v$NEW_VERSION" -m "release: v$NEW_VERSION"

# --tags を使わず単体 tag push（意図しない tag の一括 push を防止）
git push origin "v$NEW_VERSION"
```

### Step 6: GitHub Release 作成（gh がある場合）

```bash
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes "$(cat <<'EOF'
## What's Changed

**[変更の概要]**

### Before / After

| Before | After |
|--------|-------|
| 旧状態 | 新状態 |

---

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

GitHub Release Notes 必須要素:
- `## What's Changed` セクション
- **太字**の1行サマリー
- Before / After テーブル
- `Generated with [Claude Code](...)` フッター
- 言語: **英語**

### `--dry-run` モード

`--dry-run` フラグがある場合はプレビューのみ表示し、実際の変更・タグ・プッシュは実行しない。

---

## エラー対応

| エラー | 対応 |
|-------|------|
| マージコンフリクト | `git status` で確認、ユーザーと相談して解決 |
| テスト失敗 | 失敗内容を報告、feature ブランチで修正 |
| プッシュ拒否 | `git pull --rebase` 後に再プッシュ |
| `--ff-only` 失敗 | main への直接コミットの可能性 → 差分を調査 |
| ブランチ名重複 | 別名を使用 |

---

## 関連スキル

- `harness-review` — リリース前にコードレビューを実施
- `harness-work` — リリース後の次のタスクを実装
- `harness-plan` — 次バージョンの計画を作成
