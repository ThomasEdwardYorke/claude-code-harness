# ガードレール R01–R13（日本語）

英語版: [../en/guardrails.md](../en/guardrails.md)

| ID | 判定 | 対象 | 概要 |
|----|------|------|------|
| R01 | deny | Bash | `sudo` をブロック |
| R02 | deny | Write/Edit | `.git/`、`.env`、秘密鍵への書込をブロック |
| R03 | deny | Bash | シェル経由の保護パス書込をブロック |
| R04 | ask（workMode でバイパス）| Write/Edit | プロジェクト外書込を確認 |
| R05 | ask（workMode でバイパス）| Bash | `rm -rf` を確認 |
| R06 | deny（バイパス無し）| Bash | `git push --force` をブロック |
| R07 | deny（codexMode 時）| Write/Edit | Codex モード中の Claude 書込をブロック |
| R08 | deny（reviewer ロール時）| Write/Edit/Bash | reviewer ロールの変更操作をブロック |
| R09 | approve + 警告 | Read | 機密ファイル読取時に警告 |
| R10 | deny | Bash | **設定可能** — `protectedDirectories` の削除をブロック |
| R11 | deny | Bash | **設定可能** — `protectedEnvVarNames` の混入をブロック |
| R12 | deny | Bash | `curl \| bash` 系をブロック |
| R13 | deny | Bash | **設定可能** — `protectedFileSuffixes` の直接読取をブロック |

## work モード

`$HARNESS_WORK_MODE=1` で R04/R05 をバイパス。R06 は例外なくブロック。

## codex モード

`$HARNESS_CODEX_MODE=1` で R07 が有効化。Codex を worker として使うとき、
Claude が書込しないように強制する。
