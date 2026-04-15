# ブランチ戦略

このプロジェクトでは、以下のブランチ戦略を採用する。

## ブランチ構成

| ブランチ | 用途 | マージ先 |
|----------|------|----------|
| `main` | 本番環境用。常に安定した状態を維持 | - |
| `dev` | 開発統合ブランチ。機能ブランチの統合先 | `main` |
| `feature/*` | 機能開発ブランチ。個別の機能実装に使用 | `dev` |

## ブランチ命名規則

### feature ブランチ

```
feature/<issue番号>-<機能の短い説明>
```

例:
- `feature/1-setup-pipeline`
- `feature/12-add-genre-classification`
- `feature/23-improve-script-output`

> この命名規則は `.claude/commands/` および `.claude/hooks/` で機械的に強制されていない（Git 運用ポリシー）。

### 緊急修正（hotfix）が必要な場合

```
hotfix/<issue番号>-<修正内容>
```

例:
- `hotfix/45-fix-api-key-error`

## ワークフロー

### 1. 新機能開発

```bash
# dev ブランチから feature ブランチを作成
git checkout dev
git pull origin dev
git checkout -b feature/<issue番号>-<機能名>

# 開発作業...

# feature ブランチを dev にマージ（PR推奨）
```

### 2. リリース

```bash
# dev ブランチを main にマージ（PR推奨）
git checkout main
git pull origin main
git merge dev --no-ff -m "Merge dev into main: <summary>"
git push origin main

# devをmainと同期
git checkout dev
git merge main --ff-only
git push origin dev
```

## ルール

1. **直接プッシュ非推奨**: `main` と `dev` への直接プッシュは避け、可能な限り PR 経由でマージする（個人開発では運用に応じて緩和可）。
2. **レビュー推奨**: PR にはレビューを経ることを推奨する（個人開発では省略可）。
3. **テスト確認**: テストが失敗している状態では `main` へのマージを行わない。
4. **ブランチ削除**: マージ完了後、feature ブランチは削除する。

## 初期ブランチ作成

プロジェクト開始時に以下を実行:

```bash
# main ブランチが存在する状態で
git checkout -b dev
git push -u origin dev
```
