# Claude Code プラグイン ベストプラクティス調査レポート — 2026-04-22

**調査者**: Codex Worker B (Synchronous Foreground Mode)
**調査日**: 2026-04-22
**対象プラグイン**: `~/.claude/plugins/marketplaces/cc-triad-relay/` (branch: `feature/model-b-evolution`)
**調査目的**: 公式仕様との差分を特定し、Harness を最強のプラグインへ進化させるための具体的改善案を提示する。

---

## 0. 調査方法

- 公式ドキュメント (code.claude.com/docs/en/) を Codex エージェント経由でフェッチ・解析
- ローカル実装を直接 inspect (plugin.json / marketplace.json / hooks.json / scripts / agents / commands)
- GitHub Issues / コミュニティブログを照合
- 主要参照 URL は各セクション末尾に列挙

---

## 1. Plugin / Marketplace 構造

### 1.1 plugin.json マニフェスト（公式仕様）

`plugin.json` は `.claude-plugin/plugin.json` に配置する（プラグインルート直下 **ではなく** `.claude-plugin/` サブディレクトリ）。

**必須フィールド**:
- `name` のみ

**オプションフィールド**（公式ドキュメントで確認済み）:

| フィールド | 型 | 説明 |
|---|---|---|
| `version` | string | semver |
| `description` | string | マーケットプレイス表示用 |
| `author` | object (`name`, `email`, `url`) | |
| `homepage` | string | |
| `repository` | string | |
| `license` | string | |
| `keywords` | string[] | |
| `skills` | string[] | スキルパス配列 |
| `commands` | string[] | コマンドパス配列 |
| `agents` | string[] | エージェントパス配列 |
| `hooks` | string | hooks.json パス |
| `mcpServers` | string | .mcp.json パス |
| `outputStyles` | string[] | |
| `lspServers` | string | .lsp.json パス |
| `monitors` | string | monitors.json パス |
| `userConfig` | object[] | ユーザー設定スキーマ |
| `channels` | object[] | 通知チャネル設定 |
| `dependencies` | object | 完全スキーマ例には存在するが公式フィールド表には未記載 |

**重要な発見**: 現在の Harness `plugin.json` には `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `userConfig` フィールドが **すべて欠落** している。これらがなくても Claude Code はディレクトリ規約からデフォルト探索を行うため動作するが、明示指定がないと将来のデフォルトパス変更で壊れる。

Source: [plugins-reference](https://code.claude.com/docs/en/plugins-reference), [plugins](https://code.claude.com/docs/en/plugins)

### 1.2 marketplace.json マニフェスト（公式仕様）

**必須フィールド**:
- `name` (marketplace 名)
- `owner.name`
- `plugins` (配列)
  - 各エントリに `name` と `source` が必須

**オプションフィールド**:
- `owner.email`
- `metadata.description`, `metadata.version`, `metadata.pluginRoot`
- `allowCrossMarketplaceDependenciesOn`
- プラグインエントリに `category`, `tags`, `strict`

**`strict` フィールドの挙動**:
- `strict: true`（デフォルト）: `plugin.json` が権威。marketplace エントリは merge される
- `strict: false`: marketplace エントリが権威。`plugin.json` にも同コンポーネントがある場合はロード失敗

**Source エントリの形式**:

```jsonc
// 相対パス（git-backed marketplace のみ有効）
{ "source": "./plugins/harness" }

// GitHub
{ "source": "github", "repo": "owner/repo", "ref": "v1.2.3", "sha": "<40-char-sha>" }

// npm
{ "source": "npm", "package": "@scope/pkg", "version": "^1.0.0" }

// git subdir
{ "source": "git-subdir", "url": "https://...", "path": "plugins/foo", "ref": "main" }

// URL
{ "source": "url", "url": "https://...", "sha": "<sha>" }
```

**現状の Harness marketplace.json との差分**:
- ✅ `name`, `owner.name`, `plugins[].name`, `plugins[].source` — 実装済み
- ❌ `metadata.version` — `strict: true` だが `metadata` オブジェクト全体がない（現状は `plugins[].version` で代替）
- ❌ `allowCrossMarketplaceDependenciesOn` — 他マーケットプレイス（openai-codex 等）への依存を宣言する場所がない
- ❌ `plugins[].sha` — バージョン固定なし（`source: "./plugins/harness"` は相対パスのため git-backed install 前提、これは正しい）

Source: [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

### 1.3 プラグインディレクトリレイアウト規約

公式が定義する標準レイアウト:

```
plugins/<plugin-name>/
  .claude-plugin/
    plugin.json          ← 必須
  skills/                ← 推奨（SKILL.md 形式）
    <name>/
      SKILL.md
  commands/              ← レガシー（*.md 形式）
  agents/                ← *.md 形式 (YAML frontmatter + prompt)
  output-styles/
  monitors/
    monitors.json
  hooks/
    hooks.json
  .mcp.json
  .lsp.json
  bin/                   ← CLI ツール
  settings.json          ← エージェント設定のみ (agent / subagentStatusLine)
  scripts/               ← 補助スクリプト
```

**重要**: `plugin.json` は `.claude-plugin/` サブディレクトリ内に置く。プラグインルート直下は不可。

**現状との差分**:
- ✅ `commands/`, `agents/`, `hooks/hooks.json`, `scripts/`, `bin/`, `.claude-plugin/plugin.json` — 実装済み
- ❌ `skills/` ディレクトリが存在しない（`commands/` の旧形式のみ）
- ❌ `settings.json` がプラグインルートに存在しない
- ❌ `.mcp.json` が存在しない
- ❌ `schemas/` は非標準ディレクトリ（`harness.config.schema.json` は別の場所に移すべきか要検討）

Source: [plugins-reference](https://code.claude.com/docs/en/plugins-reference)

### 1.4 install 時のセマンティクス

- マーケットプレイス経由インストールは `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` にコピーされる
- 各バージョンが独立したキャッシュディレクトリを持つ
- 旧バージョンは 7 日間孤立 → 自動削除
- プラグインデータは `${CLAUDE_PLUGIN_DATA}` = `~/.claude/plugins/data/<id>/` に永続化
- アンインストール時は `--keep-data` なしで削除される

**.mcp.json 同梱時の挙動**:
- プラグイン有効化時に MCP サーバーが自動起動
- インストール後はキャッシュからの実行になるため、`.mcp.json` 内の相対パスは `../` でプラグインルート外を参照できない
- `${CLAUDE_PLUGIN_ROOT}` を使えばキャッシュパスを安全に参照できる

---

## 2. インストールモード比較

### 2.1 `install-project.sh` スタイル（コピー to `~/.claude/commands/`）

**現状の Harness install-project.sh の実際の動作**:
1. `claude plugin marketplace add <slug>` でマーケットプレイス登録
2. `claude plugin install harness@cc-triad-relay --scope project` でプラグイン登録
3. `harness.config.json` をテンプレートから生成

これは「コマンドをコピーする」方式ではなく「プラグインとして登録する」方式。スクリプト名が `install-project.sh` であっても、実際は marketplace インストールを実行する。

### 2.2 マーケットプレイス登録 vs 直接コピーの比較

| 観点 | マーケットプレイス登録（現状） | 直接コピー（`~/.claude/commands/*.md`） |
|---|---|---|
| バージョン管理 | `claude plugin update` で一括更新 | 手動 git pull + 再コピー |
| アップデート検知 | バージョン番号で自動判定 | なし |
| スコープ | global / project / managed | global のみ（ユーザーレベル） |
| フック | プラグインフック込みで配信 | フック別途設定が必要 |
| MCP サーバー | .mcp.json で一体化 | 別途 .mcp.json 設定が必要 |
| シンボリックリンク | 非対応（キャッシュコピー） | 可能（開発中は symlink 推奨） |
| 更新ワークフロー | git push → `claude plugin update` | git pull 後に手動コピー |
| 複数プロジェクト | 各プロジェクトで scope:project | `~/.claude/` に 1 回配置で全体有効 |

**開発中の推奨**: `claude --plugin-dir <path>` で 1 セッション限定読み込み（ファイル変更即時反映、ビルド後有効）

### 2.3 バージョン固定

`marketplace.json` での SHA 固定:

```json
{
  "source": "github",
  "repo": "ThomasEdwardYorke/cc-triad-relay",
  "ref": "v1.2.3",
  "sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"  // 40文字フルSHA
}
```

**重要**: `ref` と `sha` が同一バージョン番号の場合、Claude Code は同一と判定しアップデートをスキップ。Breaking Change は必ず semver major バンプが必要。

---

## 3. Global vs Local 優先順位

### 3.1 コマンド / スキル

プラグインスキルは **`/plugin-name:skill-name`** 形式でネームスペース化される。

- プラグイン: `/harness:harness-plan`
- プロジェクト: `.claude/commands/harness-plan.md` → `/harness-plan`（ベア）

**結論**: 通常は衝突しない（ネームスペースが異なるため）。ただし Harness が現在 `commands/` ディレクトリを使っている場合、`harness:harness-plan` ではなく `/harness-plan` として登録されている可能性があり、プロジェクト側との衝突が起きる。`skills/` ディレクトリへの移行が必要。

### 3.2 エージェント

公式優先順位（高 → 低）:

```
managed > --agents flag > project (.claude/agents/) > user (~/.claude/agents/) > plugin
```

**結論**: プロジェクトの `.claude/agents/worker.md` がプラグインの `agents/worker.md` に勝つ。これは意図通り（プロジェクトが上書き可能）。ただし **plugin が最下位** なので、プロジェクトがエージェントを定義しない場合のみ有効。

### 3.3 フック

フックは排他的ではなく **マージ**される。

- 重複判定: command フックはコマンド文字列でデデュープ、HTTP フックは URL でデデュープ
- 意思決定: `deny > defer > ask > allow`（PreToolUse の場合）
- 例外: managed `allowManagedHooksOnly` が有効な場合、プラグインフックも読まれなくなる（managed force-enable プラグインのみ例外）

**結論**: プラグインフックとプロジェクトフックは共存する。Harness のガードレールはプロジェクト側の hooks と競合しない。

### 3.4 MCP サーバー

公式優先順位（高 → 低）:

```
local > project (.mcp.json) > user (~/.mcp.json) > plugin > Claude.ai connectors
```

**結論**: プロジェクト `.mcp.json` がプラグイン `.mcp.json` に勝つ。Harness が将来 MCP サーバーを追加する場合、プロジェクト側で上書き可能。

### 3.5 パーミッション

- プラグイン `settings.json` は現在 `agent` と `subagentStatusLine` のみサポート
- パーミッション設定の権威は `project/.claude/settings.json`
- プラグインはパーミッション設定を実質的に上書きできない（安全設計）

**結論**: Harness のプラグイン設定でパーミッション変更はできない。プロジェクトの `settings.json` またはユーザーの `~/.claude/settings.json` を変更する必要がある。`install-project.sh` がこれを行うべきか検討が必要。

### 3.6 settings.json フィールドの挙動

`settings.json` の優先順位:

```
managed > CLI flags > local project > shared project > user > plugin
```

`enabledPlugins` キー（`plugin-name@marketplace-name: true|false`）がプラグイン有効化の主制御。

---

## 4. Claude Agent SDK (Python)

### 4.1 基本インターフェース

```bash
pip install claude-agent-sdk
```

主要 API:
- `query()`: 毎回新規セッション、ワンショット用
- `ClaudeSDKClient`: セッション永続化、マルチターン対応、interrupt サポート

Source: [agent-sdk/python](https://code.claude.com/docs/en/agent-sdk/python)

### 4.2 `claude -p` vs インタラクティブモード

| 観点 | `claude -p`（ヘッドレス） | インタラクティブ |
|---|---|---|
| プラグイン読み込み | 同じ（`--bare` なしの場合） | 同じ |
| フック | 実行される | 実行される |
| `CLAUDE.md` | 読み込まれる | 読み込まれる |
| MCP | 接続される | 接続される |
| `--bare` フラグ | スキップ（プラグイン/フック/MCP 全なし） | N/A |
| `--plugin-dir <path>` | 指定可能 | 指定可能 |

### 4.3 サブプロセスとして spawn する場合

```python
import subprocess
import json

result = subprocess.run(
    ["claude", "-p", "--output-format", "stream-json", "--plugin-dir", "/path/to/plugin"],
    capture_output=True, text=True
)

for line in result.stdout.splitlines():
    event = json.loads(line)
    if event.get("type") == "stream_event":
        if event.get("event", {}).get("delta", {}).get("type") == "text_delta":
            print(event["event"]["delta"]["text"], end="")
```

**Harness 向けポイント**:
- `--plugin-dir` を `claude -p` に渡すことで特定プラグインのみ使用可能
- `CLAUDE_PLUGIN_ROOT` 環境変数はロード後のランタイム変数（ロード制御には使えない）
- `--bare` を使えばプラグインなし素の claude として呼べる

### 4.4 `--resume <name>` の仕組み

- `--name` / `-n` でセッション名を設定
- `claude --resume <name>` で再開（カスタム名または session ID）
- インタラクティブセッションのみ picker に表示（`-p` セッションは非表示だが ID/名前で再開可）
- 同一 git repo / worktree のセッションが picker にまとめられる

### 4.5 `AGENTS.md` / `CLAUDE.md` コンテキスト注入

- Claude Code は `CLAUDE.md` を読む（`AGENTS.md` は直接読まれない）
- `AGENTS.md` を使う場合: `CLAUDE.md` 内で `@AGENTS.md` でインポート
- 読み込み順: CWD から上方向に走査、発見した `CLAUDE.md` + `CLAUDE.local.md` を連結
- サブディレクトリの `CLAUDE.md` は遅延読み込み（そのディレクトリのファイル参照時）
- HTML コメントはコンテキスト注入前に除去される

### 4.6 `--output-format stream-json`

```
# 改行区切り JSON ストリーム
{"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "..."}}}
{"type": "system", "event": {"type": "api_retry"}}  # retryable failure
```

追加フラグ:
- `--include-partial-messages`: ストリーミングトークンデルタを含める
- `--include-hook-events`: フックライフサイクルイベントを含める

---

## 5. Worktree 挙動

### 5.1 `--worktree` フラグの現状

**Issue #28041** (2026-02-24 オープン、2026-04-22 時点でまだオープン):
> `claude --worktree: .claude/ subdirectories (skills, agents, docs, rules) not copied to worktree`
> 生成された worktree `.claude/` には `settings.local.json` のみ存在し、`skills/`, `agents/`, `docs/`, `rules/`, `settings.json` がコピーされない

**公式の `--worktree` 動作**:
- `claude --worktree <name>` で `<repo>/.claude/worktrees/<name>` に作成
- ブランチ名は `worktree-<name>`
- `origin/HEAD` ベース
- `WorktreeCreate` フックでデフォルト git 動作を上書き可能
- `.worktreeinclude` で gitignore ファイルもコピー可能

**Harness の現在の対処**: `scripts/parallel-sessions.sh` でシブリング worktree を手動 `git worktree add` で作成。これは issue #28041 の影響を受けない（`--worktree` フラグを使わないため）。

### 5.2 業界アプローチ比較

| アプローチ | 分離 | 自動化 | 公式 | Harness との相性 |
|---|---|---|---|---|
| `claude --worktree` (official) | ✅ | ✅ | ✅ | ❌ issue #28041 で `.claude/` がコピーされない |
| `claude --worktree --tmux` | ✅ | ✅ | ✅ | ❌ 同上 |
| `git worktree add` + tmux (手動) | ✅ | 半自動 | 参考 | ✅ 現状の Harness アプローチ |
| `workmux` | ✅ | ✅ | ❌ | ✅ 代替として検討可 |
| `Codeman` | ✅ | ✅ | ❌ | ✅ 長期実行・モニタリング向き |

**workmux** (https://workmux.raine.dev/guide/):
- env コピー、symlink、merge/cleanup、ダッシュボードを自動化
- Harness の `parallel-sessions.sh` が解決しようとしている問題と同じ課題を扱う
- 統合コストは低い（外部ツールとして並列利用可能）

**Codeman** (https://github.com/Ark0N/Codeman):
- 永続 tmux/web セッション管理、通知、リカバリに強い
- 長期自律実行向き

**James Anglin ブログ** (https://jamesanglin.com/blog/claude-code-worktrees):
- 「worktree isolation 先行、その上に tmux」というパターンを推奨
- Anthropic の公式方向性と一致

**Harness `parallel-sessions.sh` の現状評価**:
- `--resume` / `-r` フラグ修正済み (commit 1c1b526)
- `--name` 明示対応済み
- issue #28041 の影響を受けないシブリング worktree アプローチは正しい
- workmux の機能（env コピー、ダッシュボード）は未実装 → Enhancement 候補

Source: [common-workflows](https://code.claude.com/docs/en/common-workflows), [issue #28041](https://github.com/anthropics/claude-code/issues/28041)

---

## 6. Windows 互換性

### 6.1 サポート状況

| 環境 | サポート状況 |
|---|---|
| Windows 10/Server 2019+ (ネイティブ) | ✅（Git for Windows 必須） |
| WSL 1 / WSL 2 | ✅ |
| PowerShell | オプトイン（デフォルトシェルバックエンドは Git Bash） |
| CMD | 限定的 |

### 6.2 プラグイン作者向けガイドライン

**パス区切り**:
- `plugin.json`, `hooks.json` 内は **フォワードスラッシュを使う**
- `${CLAUDE_PLUGIN_ROOT}/scripts/foo.sh` のような形式は Windows でも動作
- Windows 絶対パスを JSON に書く場合: `C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe`

**シェバング**:
- Windows での `#!/usr/bin/env bash` は Git Bash 経由なら動作するが、保証なし
- **推奨**: hooks.json で明示的インタープリタを指定する
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/foo.mjs"` ← 現状の Harness は正しい
  - `bash "${CLAUDE_PLUGIN_ROOT}/scripts/foo.sh"` ← bash スクリプトの場合
  - PowerShell: `{ "shell": "powershell", "command": "..." }`

**CRLF 問題**:
- プラグイン内の `.sh` ファイルは **LF で統一**する（`.gitattributes` で `* text=auto`, `*.sh text eol=lf`）
- 現状の Harness には `.gitattributes` が存在しない → 追加推奨

**既知の Windows 固有 Issue**:
- [#9758](https://github.com/anthropics/claude-code/issues/9758): Windows で `.sh` フックが直接実行不可
- [#14817](https://github.com/anthropics/claude-code/issues/14817): Windows `jq` / Git Bash プラグイン問題
- [#25558](https://github.com/anthropics/claude-code/issues/25558): `CLAUDE_CODE_SHELL` が Windows で無視される

**Harness の現状評価**:
- ✅ `hooks.json` の全フックが `node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-dispatcher.mjs"` を使用 → Windows でも動作
- ✅ `bin/harness` は Node.js → Windows 互換
- ❌ `.gitattributes` が存在しない → CRLF リスク
- ❌ `install-project.sh` が bash スクリプト → Windows では Git Bash 必須
- ⚠️ `scripts/parallel-sessions.sh` が bash → Windows 非対応（WSL 推奨と明記すべき）

---

## 7. ギャップマトリクス — 現状 vs 公式ベストプラクティス

| カテゴリ | 公式ベストプラクティス | Harness 現状 | ギャップ | 優先度 |
|---|---|---|---|---|
| **plugin.json** | `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `userConfig` フィールドを明示 | フィールドなし（ディレクトリ規約に依存） | 明示的マニフェスト宣言が欠落 | 🔴 高 |
| **スキルディレクトリ** | `skills/<name>/SKILL.md` 形式（推奨）| `commands/*.md`（レガシー形式） | 新形式への移行が必要 | 🔴 高 |
| **スキルネームスペース** | `/harness:harness-plan` 形式 | `/harness-plan`（ベア形式、衝突リスク） | プロジェクト側との衝突可能性 | 🔴 高 |
| **marketplace.json** | `allowCrossMarketplaceDependenciesOn` で他 MP 依存宣言 | 未宣言（openai-codex 依存が暗黙） | codex 依存の明示化が必要 | 🟡 中 |
| **SHA ピニング** | `source.sha` で 40 文字 SHA | 相対パス `"./plugins/harness"`（ローカル開発用に適切） | リリース用には SHA ピンが必要 | 🟡 中 |
| **settings.json** | `agent` / `subagentStatusLine` 設定 | 存在しない | デフォルトエージェント設定を追加検討 | 🟡 中 |
| **userConfig スキーマ** | `plugin.json` で `userConfig` 定義 | `harness.config.json` で代替（プロジェクト個別） | プラグイン標準の設定 UI が使えない | 🟡 中 |
| **WorktreeCreate フック** | `WorktreeCreate` / `WorktreeRemove` イベントでカスタム動作 | `hooks.json` に未登録 | worktree 操作の自動化が欠落 | 🟡 中 |
| **.gitattributes** | `*.sh text eol=lf` で LF 統一 | ファイルなし | Windows で CRLF 問題リスク | 🟡 中 |
| **UserPromptSubmit フック** | prompt-level ガードレール | `hooks.json` に未登録 | ユーザープロンプト横断チェックが未実装 | 🟡 中 |
| **agent `background` フィールド** | バックグラウンドエージェント宣言 | 未使用 | 非同期タスク向けエージェント設計の余地 | 🟢 低 |
| **agent `isolation: "worktree"` ** | worktree 分離エージェント | 未使用 | parallel-worktree との統合候補 | 🟢 低 |
| **`--bare` 対応** | ヘッドレス呼び出しでのプラグインスキップ | 考慮なし | SDK 呼び出し設計で検討が必要 | 🟢 低 |
| **Windows** | `.gitattributes`, powershell hooks, Git Bash 明記 | Node.js hooks（OK）、bash script（WSL 必須） | Windows サポートの明文化が欠落 | 🟢 低 |

---

## 8. Global vs Local Harness の共存設計

### 8.1 問題の整理

Harness は以下の 2 つのインストールモードをサポートする必要がある:

1. **Global（ユーザーレベル）**: `claude plugin install harness@cc-triad-relay --scope user`
   - `~/.claude/settings.json` の `enabledPlugins` で有効化
   - 全プロジェクトに自動適用

2. **Local（プロジェクトレベル）**: `claude plugin install harness@cc-triad-relay --scope project`
   - プロジェクト `.claude/settings.json` の `enabledPlugins` で有効化
   - そのプロジェクトのみに適用

### 8.2 共存時の優先順位

```
managed > CLI flags > local project > shared project > user > plugin
```

- **エージェント**: プロジェクト `.claude/agents/` > ユーザー `~/.claude/agents/` > プラグイン
- **コマンド/スキル**: ネームスペースが異なれば共存可（`/harness:skill` vs `/project-skill`）
- **フック**: マージされる（どちらも実行される）
- **MCP**: プロジェクト > ユーザー > プラグイン
- **設定**: 上位が下位を上書き

### 8.3 必要な変更（両モード共存のために）

#### 変更 1: `plugin.json` に明示的コンポーネント宣言を追加

```json
// .claude-plugin/plugin.json
{
  "name": "harness",
  "version": "0.2.0",
  "skills": ["./skills"],          // 新 skills/ ディレクトリ
  "commands": ["./commands"],      // 旧 commands/ も並存
  "agents": ["./agents"],
  "hooks": "./hooks/hooks.json",
  "userConfig": [
    {
      "key": "language",
      "type": "select",
      "label": "Response Language",
      "options": ["en", "ja"],
      "default": "en"
    }
  ]
}
```

#### 変更 2: `skills/` ディレクトリへの移行

既存 `commands/*.md` を `skills/<name>/SKILL.md` 形式に移行することで:
- スキルが `/harness:harness-plan` としてネームスペース化され衝突回避
- プロジェクト側の `.claude/commands/harness-plan.md` と共存可能

```
plugins/harness/
  skills/
    harness-plan/
      SKILL.md
    harness-work/
      SKILL.md
    ...
  commands/          # 後方互換のため維持（or 削除）
```

#### 変更 3: `install-project.sh` で project-level `settings.json` を scaffold

```bash
# プロジェクトの .claude/settings.json にハーネス用許可を追加
PROJECT_SETTINGS="${PROJECT_ROOT}/.claude/settings.json"
if [ ! -f "${PROJECT_SETTINGS}" ]; then
  mkdir -p "${PROJECT_ROOT}/.claude"
  echo '{
    "enabledPlugins": {
      "harness@cc-triad-relay": true
    }
  }' > "${PROJECT_SETTINGS}"
fi
```

#### 変更 4: Global インストール用の `harness global install` コマンド

```bash
# bin/harness グローバルインストールサブコマンドを追加
harness global install   # user scope でインストール
harness global uninstall # user scope からアンインストール
```

#### 変更 5: プロジェクト `.claude/` オーバーレイとの協調

`harness doctor` を拡張してオーバーレイを検出・報告:
```bash
harness doctor
# → "Project overlay detected: .claude/agents/worker.md (overrides plugin agent)"
# → "Recommendation: set isolation: worktree in agent frontmatter"
```

---

## 9. Top 10 推奨改善（ユーザー価値順）

### #1: `skills/` ディレクトリへの移行でコマンドをネームスペース化 🔴

**理由**: 現在の `commands/*.md` はベア `/harness-plan` として登録され、プロジェクト側の同名コマンドと衝突する。`skills/` に移行すると `/harness:harness-plan` になり安全に共存できる。

**実装**: `plugins/harness/skills/<name>/SKILL.md` を作成、`plugin.json` に `"skills": ["./skills"]` を追加。旧 `commands/` は後方互換のため維持。

**工数**: M（既存コマンドのコピー + frontmatter 調整）

---

### #2: `plugin.json` に明示的コンポーネント宣言を追加 🔴

**理由**: 現在はディレクトリ規約に依存しており、Claude Code のデフォルト探索ロジックが変わると壊れる。`skills`, `commands`, `agents`, `hooks`, `mcpServers` を明示することで将来性が確保される。

**実装**: `.claude-plugin/plugin.json` に上記フィールドを追加。

**工数**: S

---

### #3: `WorktreeCreate` / `WorktreeRemove` フックで worktree 自動セットアップ 🟡

**理由**: `claude --worktree` で `.claude/` がコピーされない issue #28041 が修正されるまでの暫定策として、`WorktreeCreate` フックで Harness が必要なファイルを自動コピーできる。

**実装**:
```json
// hooks.json に追加
"WorktreeCreate": [{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-dispatcher.mjs\" worktree-create"
}]
```

**工数**: M

---

### #4: `allowCrossMarketplaceDependenciesOn` で openai-codex 依存を宣言 🟡

**理由**: Harness の `harness:codex-sync` エージェントは Codex プラグインの `codex-companion.mjs` を呼ぶ。この依存が暗黙になっており、Codex プラグインなしで Harness を使うと実行時エラーになる。marketplace.json で明示することで、Claude Code が依存プラグインを一緒にインストール促進できる（将来機能）。

**実装**: `marketplace.json` に `"allowCrossMarketplaceDependenciesOn": ["openai-codex"]` を追加。

**工数**: S

---

### #5: `.gitattributes` 追加で Windows CRLF 問題を防止 🟡

**理由**: Windows + Git for Windows で clone すると `.sh` ファイルが CRLF になり、Git Bash での実行に失敗する可能性がある。

**実装**:
```gitattributes
* text=auto
*.sh text eol=lf
*.mjs text eol=lf
*.md text eol=lf
*.json text eol=lf
```

**工数**: XS

---

### #6: `UserPromptSubmit` フックでプロンプトレベルガードレール 🟡

**理由**: 現在のガードレール（R01-R13）はツール実行時（PreToolUse）にのみ発動する。`UserPromptSubmit` フックでプロンプト自体をチェックすることで、危険なコマンドをより早期にブロックできる。

**実装**: `hooks.json` に `UserPromptSubmit` エントリ追加 + `hook-dispatcher.mjs` でのルール照合。

**工数**: M

---

### #7: `userConfig` スキーマをプラグインマニフェストに追加 🟡

**理由**: 現在の設定は `harness.config.json`（プロジェクト固有）で管理されているが、プラグイン標準の `userConfig` を追加することで Claude Code の設定 UI から言語・ガードレールレベルを設定できるようになる（将来）。

**実装**: `plugin.json` に `"userConfig": [{"key": "language", "type": "select", ...}]` を追加。

**工数**: S

---

### #8: `settings.json` でデフォルトエージェントを設定 🟡

**理由**: `plugins/harness/settings.json` に `{ "agent": "worker" }` を設定すると、harness が有効なプロジェクトで自動的に worker エージェントがデフォルトになる（オプション機能として）。

**実装**: `plugins/harness/settings.json` を新規作成。`harness.config.json` の `defaultAgent` フィールドと連携。

**工数**: S

---

### #9: `harness global install` / `harness check --scope` コマンド追加 🟢

**理由**: グローバルインストール（`--scope user`）のワークフローが未ドキュメント。`bin/harness` に `global install` サブコマンドを追加することで、単一コマンドでグローバル有効化できる。

**実装**: `bin/harness` に `global` サブコマンドを追加。`harness check` に `--scope` オプションを追加してグローバル vs ローカルの状態を確認できるようにする。

**工数**: M

---

### #10: `agent isolation: "worktree"` を parallel-worktree フローに統合 🟢

**理由**: 公式の `isolation: "worktree"` フォームは、エージェントが独立した worktree で動くことを保証する。現在の `parallel-sessions.sh` による手動 worktree 管理の代替/補完として使える。

**実装**: `agents/worker.md` frontmatter に `isolation: "worktree"` を試験的に追加し、`--worktree` issue #28041 の修正後に本格統合。

**工数**: S（試験的追加のみ）

---

## 10. 情報源

| URL | 内容 |
|---|---|
| https://code.claude.com/docs/en/plugins | プラグイン作成ガイド |
| https://code.claude.com/docs/en/plugins-reference | プラグインリファレンス（全フィールド） |
| https://code.claude.com/docs/en/plugin-marketplaces | マーケットプレイス仕様 |
| https://code.claude.com/docs/en/discover-plugins | プラグインディスカバリ |
| https://code.claude.com/docs/en/settings | 設定リファレンス |
| https://code.claude.com/docs/en/hooks | フックリファレンス |
| https://code.claude.com/docs/en/sub-agents | サブエージェント仕様 |
| https://code.claude.com/docs/en/mcp | MCP 設定 |
| https://code.claude.com/docs/en/headless | ヘッドレス / -p モード |
| https://code.claude.com/docs/en/cli-usage | CLI リファレンス |
| https://code.claude.com/docs/en/agent-sdk/python | Python Agent SDK |
| https://code.claude.com/docs/en/agent-sdk/plugins | SDK プラグイン |
| https://code.claude.com/docs/en/common-workflows | よく使うワークフロー |
| https://code.claude.com/docs/en/memory | CLAUDE.md / メモリ |
| https://code.claude.com/docs/en/best-practices | ベストプラクティス |
| https://github.com/anthropics/claude-code/issues/28041 | `--worktree` .claude/ コピー問題 |
| https://github.com/anthropics/claude-code/issues/9758 | Windows .sh フック問題 |
| https://github.com/anthropics/claude-code/issues/14817 | Windows jq/Git Bash 問題 |
| https://workmux.raine.dev/guide/ | workmux ドキュメント |
| https://github.com/Ark0N/Codeman | Codeman |
| https://jamesanglin.com/blog/claude-code-worktrees | James Anglin worktree ブログ |

---

*このレポートは Codex Worker B が foreground モードで生成した。調査した公式ドキュメントと現在の実装を直接 inspect した結果に基づく。不確実な箇所は「推測」と明記している。*
