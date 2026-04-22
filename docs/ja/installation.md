# インストール（日本語）

## 必要環境

- Claude Code CLI
- Node.js 18 以上

ネイティブ依存はありません（Pure JS 実装）。

## Marketplace からインストール

```bash
claude plugin marketplace add ThomasEdwardYorke/claude-code-harness
claude plugin install harness@claude-code-harness --scope project
```

## ローカル開発用ロード

```bash
claude --plugin-dir /path/to/claude-code-harness/plugins/harness
```

セッション内で `/reload-plugins` を実行すると編集が反映されます。

## プロジェクト初期化

```bash
/harness-setup init
```

`harness.config.json` を生成、`CLAUDE.md` を必要に応じて配置、`.gitignore`
を更新します。

## 動作確認

```bash
/harness-setup check
/harness-setup doctor
```

またはシェルから:

```bash
plugins/harness/bin/harness check
plugins/harness/bin/harness doctor
```

## アンインストール

```bash
claude plugin uninstall harness@claude-code-harness
```
