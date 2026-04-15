# 設定（日本語）

英語版: [../en/configuration.md](../en/configuration.md)

プロジェクトルートに `harness.config.json` を配置します。

```json
{
  "projectName": "my-app",
  "language": "ja",
  "protectedDirectories": ["datasets", "fixtures/gold"],
  "protectedEnvVarNames": ["OPENAI_API_KEY", "MY_TOKEN"],
  "protectedFileSuffixes": [".env", ".secrets"],
  "workMode": { "bypassRmRf": false, "bypassGitPush": false },
  "tampering": { "severity": "approve" }
}
```

## フィールド一覧

| フィールド | 型 | デフォルト | 役割 |
|-----------|----|-----------|------|
| `projectName` | string | `"my-project"` | 表示用プロジェクト名 |
| `language` | `"en" \| "ja"` | `"en"` | メッセージ言語 |
| `protectedDirectories` | string[] | `[]`（R10 無効） | R10 が削除ブロックするディレクトリ |
| `protectedEnvVarNames` | string[] | 標準の API キー名一覧 | R11 が Bash コマンド混入を禁止する名前 |
| `protectedFileSuffixes` | string[] | `[".env"]` | R13 が直接読取を禁止するサフィックス |
| `codex.enabled` | boolean | `false` | codex-sync エージェントを有効化 |
| `workMode.bypassRmRf` | boolean | `false` | R05 を全体でバイパス |
| `tampering.severity` | `"approve"/"ask"/"deny"` | `"approve"` | 改ざん検出の反応強度 |

## 空配列 = ルール無効化

- `protectedDirectories: []` → R10 完全無効
- `protectedEnvVarNames: []` → R11 完全無効
- `protectedFileSuffixes: []` → R13 完全無効

デフォルトで安全に動くよう、初期状態では R10 は無効、R11 は標準的な API
キー名のみ、R13 は `.env` のみをブロックします。
