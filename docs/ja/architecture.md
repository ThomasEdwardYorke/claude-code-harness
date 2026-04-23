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
      ↓ stdout JSON { decision, reason?, systemMessage?, continue?,
                       stopReason?, suppressOutput?, worktreePath? }
Claude Code が decision を適用
```

> **例外 — `WorktreeCreate` blocking hook**: 他の全 event と異なり、
> `WorktreeCreate` は Claude Code の default `git worktree add` 挙動を
> **完全置換**する。公式 *command* hook contract に準拠
> (<https://code.claude.com/docs/en/hooks>)、成功時は raw な絶対パスを
> stdout に出力 (JSON エンベロープなし)、non-zero exit で worktree 生成が
> 失敗する。dispatcher (`scripts/hook-dispatcher.mjs`) と `core/src/index.ts
> main()` の両方に `worktree-create` 分岐があり、この blocking contract を
> end-to-end で守る。他 event は上記 JSON-decision protocol を継続使用。

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
- フックは **`WorktreeCreate` を除いて** フェールオープン（core エラー時も
  approve を返してセッションを壊さない）。`WorktreeCreate` のみ公式
  blocking contract に準拠し、raw stdout + non-zero exit で worktree 生成
  を失敗させる。dispatcher `failOpen()` にも `worktree-create` 特例分岐が
  あり、dispatcher 自体が壊れた場合 (`CLAUDE_PLUGIN_ROOT` 未設定、
  `core/dist` 欠損等) でも stderr に書いて exit 1 する end-to-end 防御
