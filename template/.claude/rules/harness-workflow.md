# ハーネスワークフロー詳細

## セキュリティ保護（`.claude/hooks/` + TypeScript コア）

v3 では 4 本の薄いシム（Bash スクリプト各 5 行以内）が `.claude/core/dist/index.js` に委譲し、
TypeScript コアが R01-R13 のガードルールを評価する。

| ルール | 保護内容 |
|--------|---------|
| R01-R06 | 危険な Bash コマンド（rm -rf・curl\|bash 等）ブロック |
| R07-R09 | .env / 認証情報ファイルへのアクセスブロック |
| R10 | `annotated_data/` 削除ブロック（学習データ保護） |
| R11 | `OPENAI_API_KEY` を含む Bash コマンドブロック |
| R12 | `curl \| bash` 等の外部スクリプト実行ブロック |
| R13 | `.env` ファイルへの直接アクセスブロック |

**薄いシム一覧（`.claude/hooks/`）:**
- `pre-tool.sh` — PreToolUse イベント → `node core/dist/index.js pre-tool`
- `post-tool.sh` — PostToolUse イベント → `node core/dist/index.js post-tool`
- `permission.sh` — PermissionRequest イベント → `node core/dist/index.js permission`
- `session.sh` — SessionStart/SessionEnd イベント → `node core/dist/index.js session`

旧 Bash フック 10 本は `.claude/hooks/archive/` に保持。

## ハーネスドキュメント更新ルール

**ハーネスファイルを変更した場合は、必ず `.docs/harnessdocument/` の関連ドキュメントも同時に更新すること。**

| 変更対象 | 更新が必要なドキュメント |
|---------|----------------------|
| `.claude/commands/harness-*.md`（5 動詞スキル） | `harness-usage.md`（スキル説明）、`harness-porting-status.md`（移植状況） |
| `.claude/hooks/*.sh`（薄いシム） | `harness-usage.md`（フック説明）、`harness-porting-status.md` |
| `.claude/core/src/guardrails/rules.ts` | `harness-usage.md`（セキュリティ保護セクション）、`harness-porting-status.md` |
| `.claude/agents/*.md` | `harness-usage.md`（エージェント説明）、`harness-porting-status.md` |
| ファイル構成変更（新規作成・削除） | `harness-porting-status.md`（移植状況） |
| `.claude/CLAUDE.md` 変更 | `harness-usage.md`（概要セクション）|
| `.claude/rules/*.md` 変更 | `harness-usage.md`（関連セクション）、`harness-porting-status.md` |

エージェント（`scaffolder`）に更新を委譲してもよい。

## ドキュメント（`.docs/harnessdocument/`）

| ファイル | 内容 |
|---------|------|
| `.docs/harnessdocument/harness-usage.md` | このプロジェクトでのハーネスの使い方（5 動詞スキル・エージェント呼び出し方） |
| `.docs/harnessdocument/harness-porting-status.md` | 機能移植状況トラッキングテーブル（v2 → v3 含む） |
