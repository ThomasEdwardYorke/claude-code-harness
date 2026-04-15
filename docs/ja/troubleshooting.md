# トラブルシューティング（日本語）

英語版: [../en/troubleshooting.md](../en/troubleshooting.md)

## `harness check` が MISSING を出す

`plugins/harness/core/` で `npm run build` を実行してください。
dispatcher は `core/dist/index.js` を絶対参照します。

## フックが発火しない

1. `claude plugin list --json` でプラグインが有効か確認
2. `harness doctor` で `CLAUDE_PLUGIN_ROOT` を確認
3. パスが plugin ディレクトリで終わっていない場合は Claude Code の再インストールを検討

## すべてブロックされる

`harness.config.json` を確認：

- `protectedDirectories` に `/` を含めると全パスにマッチ
- `protectedEnvVarNames` に短い一般語を含めると誤検知
- `protectedFileSuffixes` に `.` のみを含めると全ファイルマッチ

デバッグ用:
```bash
bin/harness rules test "some bash command"
```

## tampering 検出が煩い

`tampering.severity` を `"approve"` に（デフォルト、警告のみ）。

## Codex プラグインのバージョンズレ

`harness doctor` でインストール済みか確認。再インストール推奨:
```bash
claude plugin install codex@openai-codex
```
