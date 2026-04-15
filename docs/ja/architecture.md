# アーキテクチャ（日本語）

英語版: [../en/architecture.md](../en/architecture.md)

## 全体像

```
Claude Code セッション
      ↓
hooks/hooks.json  (プラグインインストール時に登録)
      ↓ stdin JSON
scripts/hook-dispatcher.mjs  (ES Modules、ロジック無し)
      ↓ import ${CLAUDE_PLUGIN_ROOT}/core/dist/index.js
core/src/index.ts  (フックタイプで分岐)
      ├─ guardrails/pre-tool.ts   → guardrails/rules.ts (R01-R13)
      ├─ guardrails/post-tool.ts  → guardrails/tampering.ts (T01-T12)
      ├─ guardrails/permission.ts (安全なコマンドを自動承認)
      └─ state/store.ts           (JSON ファイルストア)
      ↓ stdout JSON { decision, reason?, systemMessage? }
Claude Code が decision を適用
```

## 3層構造

1. **ガードレール** — R01-R13 の宣言的ルール。R10/R11/R13 は `harness.config.json`
   でパラメータ化
2. **5 動詞スキル** — plan / work / review / release / setup
3. **3 汎用エージェント** — worker / reviewer / scaffolder + helpers（security-auditor / codex-sync）

## 設定優先順位

1. `harness.config.json`（プロジェクトルート）
2. `DEFAULT_CONFIG`（core/src/config.ts 内のデフォルト）
3. 環境変数（`HARNESS_WORK_MODE` / `HARNESS_CODEX_MODE` / `HARNESS_BREEZING_ROLE`）

## 設計原則

- プラグインルートは `${CLAUDE_PLUGIN_ROOT}` で絶対参照
- 空配列設定は「ルール無効化」を意味する（エラーにはならない）
- フックは常にフェールオープン（core エラー時も approve を返してセッションを壊さない）
