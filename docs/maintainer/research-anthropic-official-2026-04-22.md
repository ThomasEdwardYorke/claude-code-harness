# Anthropic 公式ドキュメント監査レポート — 2026-04-22

**監査対象**: Claude Code Harness Plugin (`~/.claude/plugins/marketplaces/cc-triad-relay/`)
**監査ブランチ**: `feature/model-b-evolution`
**監査日**: 2026-04-22
**調査者**: Codex Worker A (Automated background search)

## 0. 監査方法と前提

- ローカル実装は `~/.claude/plugins/marketplaces/cc-triad-relay/` を直接調査した。
- 公式仕様は Anthropic / Claude Code の公開ドキュメントを優先した。
- 主参照 URL:
  - Subagents: https://code.claude.com/docs/en/sub-agents
  - Skills: https://code.claude.com/docs/en/skills
  - Hooks: https://code.claude.com/docs/en/hooks
  - MCP: https://code.claude.com/docs/en/mcp
  - Settings: https://code.claude.com/docs/en/configuration
  - Memory: https://code.claude.com/docs/en/memory
  - Output styles: https://code.claude.com/docs/en/output-styles
  - Plugins reference: https://code.claude.com/docs/en/plugins-reference
  - Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces

---

## 1. サブエージェント (Subagents)

### 1.1 公式仕様

短い引用:

> "Only `name` and `description` are required."  
Source: https://code.claude.com/docs/en/sub-agents

> "plugin subagents do not support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields."  
Source: https://code.claude.com/docs/en/sub-agents

公式 docs で確認できた plugin agent frontmatter:

- `name`
- `description`
- `tools`
- `disallowedTools`
- `model`
- `permissionMode`
- `maxTurns`
- `skills`
- `mcpServers`
- `hooks`
- `memory`
- `background`
- `effort`
- `isolation`
- `color`
- `initialPrompt`

ただし plugin 同梱 agent では `hooks` / `mcpServers` / `permissionMode` は無視される。

### 1.2 現在の harness plugin 実装状況

実装済み frontmatter キー集計:

```text
agents
  color: 6
  description: 6
  disallowedTools: 5
  effort: 3
  maxTurns: 6
  memory: 1
  model: 6
  name: 6
  tools: 6
```

主要ファイル:

- `agents/coderabbit-mimic.md`: `tools`, `model`, `effort`, `memory`, `color`, `maxTurns`
- `agents/codex-sync.md`: `tools`, `disallowedTools`, `model`, `color`, `maxTurns`
- `agents/reviewer.md`: `tools`, `disallowedTools`, `model`, `color`, `maxTurns`
- `agents/scaffolder.md`: `tools`, `disallowedTools`, `model`, `color`, `maxTurns`
- `agents/security-auditor.md`: `tools`, `disallowedTools`, `model`, `effort`, `color`, `maxTurns`
- `agents/worker.md`: `tools`, `disallowedTools`, `model`, `effort`, `color`, `maxTurns`

未使用:

- `skills`
- `background`
- `isolation`
- `initialPrompt`

plugin agent では非対応なので未使用でも問題にならないもの:

- `hooks`
- `mcpServers`
- `permissionMode`

### 1.3 ギャップ分析

- `skills` 未使用。docs は「subagents don’t inherit skills from the parent conversation」と明記しているため、worker / reviewer / security-auditor が parent 側 skill を当然に使える前提は弱い。
- `isolation` 未使用。docs は `isolation: worktree` を正式サポートしている。harness は `parallel-worktree` を大きく押し出しているのに、agent frontmatter 側で isolation を活用していない。
- `background` 未使用。長時間レビュー系や外部 CLI 依存 agent で明示的 background 実行を設計できる余地がある。
- `memory` は `coderabbit-mimic` のみ `project`。reviewer / security-auditor / worker は cross-session learnings を保持していない。
- `initialPrompt` 未使用。`--agent` / `agent` setting で main session agent として使う場合の UX 最適化がない。

### 1.4 アクションアイテム

- [ ] `worker` と将来の Model B worker 候補に `isolation: worktree` を適用する設計を追加する
- [ ] `reviewer` / `security-auditor` / `worker` に preload すべき `skills` を再設計する
- [ ] `reviewer` / `security-auditor` の `memory` を `project` または `local` で使うか評価する
- [ ] `background` を `coderabbit-mimic` か長時間 CI agent に使うか検証する
- [ ] `initialPrompt` を main-session agent 利用シナリオ向けに整備する

---

## 2. スキル / スラッシュコマンド (Skills / Slash Commands)

### 2.1 公式仕様

短い引用:

> "Custom commands have been merged into skills."  
Source: https://code.claude.com/docs/en/skills

> "All fields are optional. Only `description` is recommended."  
Source: https://code.claude.com/docs/en/skills

docs で確認できた frontmatter:

- `name`
- `description`
- `when_to_use`
- `argument-hint`
- `arguments`
- `disable-model-invocation`
- `user-invocable`
- `allowed-tools`
- `model`
- `effort`
- `context`
- `agent`
- `hooks`
- `paths`

### 2.2 現在の harness plugin 実装状況

実装済み frontmatter キー集計:

```text
commands
  allowed-tools: 12
  argument-hint: 12
  context: 2
  description: 12
  description-ja: 4
  name: 12
```

所見:

- plugin は全面的に legacy `commands/*.md` 構成を使っている
- 全 command で `allowed-tools` と `argument-hint` は使っている
- `context: fork` は `harness-release.md` と `harness-review.md` のみ
- `description-ja` は 4 ファイルにあるが、監査した公式 docs では確認できなかった

### 2.3 ギャップ分析

- `when_to_use` 未使用。現在は長大な trigger 文を `description` に詰め込んでおり、自動起動条件が読みにくい。
- `disable-model-invocation` 未使用。`harness-release`、`branch-merge`、`new-feature-branch`、`harness-setup` のような破壊的 / 運用系 command は自動起動を禁止した方が安全。
- `user-invocable` 未使用。内部用 orchestration command を menu から隠せない。
- `arguments` 未使用。`$1`, `$2` 依存の代わりに named arguments にできる。
- `model` / `effort` 未使用。重い review / plan / audit command に model pinning を入れていない。
- `agent` 未使用。`context: fork` を使う command でも、どの subagent に委譲するかを frontmatter で固定していない。
- `hooks` 未使用。skill lifecycle に対して局所 hook を差し込めない。
- `paths` 未使用。path-aware auto activation がない。
- `description-ja` は docs に見当たらず、将来も評価対象外として silently ignored される可能性がある。
- 新規 plugin は `skills/` 推奨なのに、harness は flat `commands/` に留まっている。

### 2.4 アクションアイテム

- [ ] `description` を短くし、trigger 文を `when_to_use` に分離する
- [ ] `harness-release` / `branch-merge` / `new-feature-branch` / `harness-setup` に `disable-model-invocation: true` を付ける
- [ ] `context: fork` を使う command に `agent:` を明示する
- [ ] `description-ja` を削除するか、docs に存在する仕組みに移す
- [ ] `commands/` から `skills/` への段階移行計画を作る
- [ ] 高価値 command で `model`, `effort`, `hooks`, `paths` を活用する

---

## 3. フック (Hooks)

### 3.1 公式仕様

短い引用:

> "Hooks are user-defined shell commands, HTTP endpoints, or LLM prompts"  
Source: https://code.claude.com/docs/en/hooks

> "The JSON object supports three kinds of fields"  
Source: https://code.claude.com/docs/en/hooks

> `continue`, `stopReason`, `suppressOutput`, `systemMessage`  
Source: https://code.claude.com/docs/en/hooks

docs 上で確認できた hook event 全一覧は 27 個:

- `SessionStart`
- `InstructionsLoaded`
- `UserPromptSubmit`
- `UserPromptExpansion`
- `PreToolUse`
- `PermissionRequest`
- `PermissionDenied`
- `PostToolUse`
- `PostToolUseFailure`
- `Notification`
- `SubagentStart`
- `SubagentStop`
- `TaskCreated`
- `TaskCompleted`
- `Stop`
- `StopFailure`
- `TeammateIdle`
- `ConfigChange`
- `CwdChanged`
- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`
- `PreCompact`
- `PostCompact`
- `Elicitation`
- `ElicitationResult`
- `SessionEnd`

共通 input fields:

- `session_id`
- `transcript_path`
- `cwd`
- `permission_mode` (event により省略あり)
- `hook_event_name`
- `agent_id` / `agent_type` (subagent 内または `--agent` 時)

高価値 event-specific payload / output 例:

- `SessionStart` input: `source`, `model`, optional `agent_type`
- `UserPromptExpansion` input: `expansion_type`, `command_name`, `command_args`, `command_source`, `prompt`
- `PermissionRequest` input: `tool_name`, `tool_input`, optional `permission_suggestions`
- `PermissionRequest` output: `decision.behavior`, `updatedInput`, `updatedPermissions`, `message`, `interrupt`
- `PostToolUseFailure` input: `tool_name`, `tool_input`, `tool_use_id`, `error`, optional `is_interrupt`
- `PostToolUse` output: `decision`, `reason`, `additionalContext`, `updatedMCPToolOutput`
- `Notification` input: `message`, optional `title`, `notification_type`
- `SubagentStop` input: `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`
- `TaskCreated` input: `task_id`, `task_subject`, optional `task_description`, `teammate_name`, `team_name`
- `FileChanged` input: `file_path`, `event`
- `CwdChanged` output: `watchPaths`
- `WorktreeCreate` input: `name`
- `WorktreeCreate` output: absolute `worktreePath` または command stdout path
- `WorktreeRemove` input: `worktree_path`
- `PermissionDenied` output: `retry: true`
- `Elicitation` / `ElicitationResult` output: `action`, `content`

docs は command hook だけでなく `http`, `prompt`, `agent`, `async` hook も正式サポートする。

### 3.2 現在の harness plugin 実装状況

#### 3.2.a Snapshot (2026-04-22)

本節は 2026-04-22 時点の初期調査スナップショットを保全する。この時点では
`WorktreeCreate` / `WorktreeRemove` は hooks.json 未登録であり、`HookResult`
は `decision` / `reason` / `systemMessage` 3 field のみだった。

`hooks/hooks.json` 登録 event (2026-04-22 時点):

```text
PreToolUse
PostToolUse
PermissionRequest
SessionStart
SessionEnd
PreCompact
SubagentStop
TaskCreated
Stop
TaskCompleted
```

網羅率 (2026-04-22 時点):

```text
covered=10 / 27
missing=17 (WorktreeCreate / WorktreeRemove / InstructionsLoaded / UserPromptSubmit / UserPromptExpansion / PermissionDenied / PostToolUseFailure / Notification / SubagentStart / StopFailure / TeammateIdle / ConfigChange / CwdChanged / FileChanged / PostCompact / Elicitation / ElicitationResult)
```

実装の実態 (2026-04-22 時点):

- `hooks.json` は `SessionStart` / `SessionEnd` を登録しているが `core/src/index.ts` では no-op
- hook runtime は command hook のみ (http / prompt / agent / async 未対応)
- `scripts/hook-dispatcher.mjs` は fail-open で常に `{"decision":"approve"}` を返す
- internal `HookResult` 型は `decision`, `reason`, `systemMessage` のみ

#### 3.2.b Current status (2026-04-23)

2026-04-23 の Phase κ-2 完了後の現状。以下の項目が済:

- **WorktreeCreate**: blocking protocol production として hooks.json 登録
  (`command` type, timeout 120s)、実 `git worktree add` 実行 + `worktreePath`
  を HookResult に載せ index.ts main() が raw stdout に書き出し
- **WorktreeRemove**: non-blocking observability として hooks.json 登録
  (Phase η P0-κ で完了、timeout 10s)
- **HookResult universal fields** (`continue` / `stopReason` / `suppressOutput`)
  を optional として追加 (全 hook event 共通、後方互換)
- **HookResult event-specific field** `worktreePath` を optional top-level で
  追加 (WorktreeCreate 専用 bridge、command hook raw stdout に展開される)

`hooks/hooks.json` 登録 event (2026-04-23 現状):

```text
PreToolUse
PostToolUse
PermissionRequest
SessionStart
SessionEnd
PreCompact
SubagentStop
TaskCreated
Stop
TaskCompleted
WorktreeCreate
WorktreeRemove
```

網羅率 (2026-04-23 現状):

```text
covered=12 / 27
missing=15 (InstructionsLoaded / UserPromptSubmit / UserPromptExpansion / PermissionDenied / PostToolUseFailure / Notification / SubagentStart / StopFailure / TeammateIdle / ConfigChange / CwdChanged / FileChanged / PostCompact / Elicitation / ElicitationResult)
```

残実装の実態:

- `SessionStart` / `SessionEnd` の no-op 問題は未解消
- hook runtime は引き続き command hook のみ、http / prompt / agent / async 未対応
- event-specific outputs (`updatedPermissions`, `updatedInput`, `retry`,
  `watchPaths`, `updatedMCPToolOutput`, `action`, `content`) は未実装
  (HTTP hook サポート時の `hookSpecificOutput` nested pattern で追加予定)
- `PermissionRequest` は専用 JSON を `systemMessage` に文字列埋め込みする
  特殊実装のまま (汎用化は未着手)
- `PreToolUse` matcher は `Write|Edit|MultiEdit|Bash|Read` のみで `Glob` /
  `Grep` / `WebFetch` / `WebSearch` / `AskUserQuestion` / MCP tool 群は対象外

### 3.3 ギャップ分析

#### イベントカバレッジ

- 27 event 中 12 event を登録 (2026-04-23 現状)
- 残りで影響が大きいのは `UserPromptSubmit`, `UserPromptExpansion`, `PostToolUseFailure`, `InstructionsLoaded`, `SubagentStart`, `CwdChanged`, `FileChanged`
- 優先対応候補 (backlog 追跡): `PostToolUseFailure`, `UserPromptSubmit`

#### 実装 fidelity

- 公式 JSON output の `continue`, `stopReason`, `suppressOutput`, `systemMessage` は harness `HookResult` でサポート済
- event-specific outputs (`updatedPermissions`, `updatedInput`, `retry`, `watchPaths`, `updatedMCPToolOutput`, `action`, `content`) は未実装 (command hook raw stdout 運用に集中、HTTP hook サポート時に `hookSpecificOutput` nested pattern で追加予定)
- `worktreePath` は top-level optional として HookResult に載せ、`index.ts main()` の worktree-create 分岐で raw stdout に書き出し (公式 command hook protocol に整合)
- `PermissionRequest` は専用 JSON を `systemMessage` に文字列埋め込みする特殊実装で、汎用的ではない
- `SessionStart` / `SessionEnd` を登録しているのに no-op なのは under-utilization が明白
- `PreToolUse` matcher は `Write|Edit|MultiEdit|Bash|Read` のみ。docs が列挙する `Glob`, `Grep`, `WebFetch`, `WebSearch`, `AskUserQuestion`, MCP tool 群が guardrail 対象外
- `PostToolUse` に failure 系がなく、失敗したテスト・lint・CLI の補足ができない
- prompt/agent hooks を使っていないため、停止前の品質ゲートを shell glue に閉じ込めている

#### 価値が高い docs 機能

- `UserPromptSubmit`: destructive command や release intent の upfront validation
- `UserPromptExpansion`: `/harness-*` command 展開前の policy control
- `PostToolUseFailure`: テスト失敗や `gh` / `git` / `codex` failure の自動ガイダンス
- `InstructionsLoaded`: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/` の読込可視化
- `CwdChanged` + `FileChanged`: env / watch list / project-local state 同期
- `WorktreeCreate` + `WorktreeRemove`: isolation 運用の正式フック化
- `agent` hooks on `Stop` / `SubagentStop` / `TaskCompleted`: 実ファイルを見ながら verifier を走らせられる

### 3.4 アクションアイテム

- [ ] hook runtime の型を公式 JSON schema に合わせて拡張する
- [ ] `PostToolUseFailure` を追加し、失敗時の recovery context を返す
- [ ] `UserPromptSubmit` / `UserPromptExpansion` を追加し、release / destructive workflow を前段で制御する
- [ ] `WorktreeCreate` / `WorktreeRemove` を実装し、Model B / isolation 設計と整合させる
- [ ] `InstructionsLoaded`, `CwdChanged`, `FileChanged` を追加し、local project 依存の state と memory を同期する
- [ ] `SessionStart` / `SessionEnd` を no-op から実処理へ変更する
- [ ] `Stop` / `SubagentStop` / `TaskCompleted` で prompt hook または agent hook を試験導入する

---

## 4. MCP統合

### 4.1 公式仕様

短い引用:

> "MCP servers can be configured at three scopes."  
Source: https://code.claude.com/docs/en/mcp

> "Project-scoped servers ... stored in a `.mcp.json` file"  
Source: https://code.claude.com/docs/en/mcp

docs で確認できた scope:

- Local: `~/.claude.json`
- Project: project root `.mcp.json`
- User: `~/.claude.json`

plugin-provided MCP も正式サポートされる。plugin では `${CLAUDE_PLUGIN_ROOT}` と `${CLAUDE_PLUGIN_DATA}` を使える。

### 4.2 現在の harness plugin 実装状況

- plugin 内に `.mcp.json` は存在しない
- `plugin.json` に `mcpServers` もない
- project-shared MCP のテンプレートや同梱 server はない
- command 文面では `.mcp.json` に言及する箇所があるが、plugin 自体は MCP を bundle していない

### 4.3 ギャップ分析

- docs は project-scope `.mcp.json` を第一級に扱うが、harness は global/local 両対応の文脈で MCP 戦略を持っていない
- plugin-bundled MCP server がないため、harness が前提にしそうな外部 integration をチームへ一貫配布できない
- `CLAUDE_PLUGIN_DATA` を使う persistent plugin state 設計も未採用

### 4.4 アクションアイテム

- [ ] `.mcp.json` の project-scope 運用方針を docs に明記する
- [ ] 本当に共通化したい integration があるなら plugin `mcpServers` を追加する
- [ ] plugin state が必要な場合は `${CLAUDE_PLUGIN_DATA}` を使う

---

## 5. 設定・メモリ・出力スタイル (Settings/Memory/Output-Style)

### 5.1 公式仕様

短い引用:

> "Settings apply in order of precedence."  
Source: https://code.claude.com/docs/en/configuration

優先順位:

1. Managed settings
2. Command line arguments
3. `.claude/settings.local.json`
4. `.claude/settings.json`
5. `~/.claude/settings.json`

memory docs 要点:

- `CLAUDE.md` と auto memory は別物
- auto memory は project ごとに `~/.claude/projects/<project>/memory/`
- worktree 共有は repo 単位

output style docs 要点:

- plugin は `output-styles/` を同梱可能
- `keep-coding-instructions` frontmatter あり

### 5.2 現在の harness plugin 実装状況

- plugin root に `settings.json` は存在しない
- plugin root に `output-styles/` は存在しない
- agent `memory` は `coderabbit-mimic` のみ `project`
- command / agent の文面には `~/.claude/plugins/cache/openai-codex/...` への依存が多数ある

該当 grep:

```text
agents/worker.md
commands/tdd-implement.md
commands/parallel-worktree.md
agents/coderabbit-mimic.md
agents/codex-sync.md
commands/harness-setup.md
```

### 5.3 ギャップ分析

- 設定階層は公式に強いが、harness 自身はそれを積極活用していない
- project install / local install を強くしたいなら、`enabledPlugins`, `extraKnownMarketplaces`, `.claude/settings.json`, `.claude/settings.local.json` を使った導入パターンを整備すべき
- hardcoded `~/.claude/plugins/cache/...` 前提は portability を弱める。project-scope install でも plugin cache 自体は user-level だが、依存 plugin path を prose / workflow に埋め込む設計は brittle
- output styles を全く活用していない。authoritative audit / terse worker / explanatory onboarding など、harness に相性の良い style を plugin 同梱できる

### 5.4 アクションアイテム

- [ ] global / project / local の推奨インストール形態を docs と setup command に明文化する
- [ ] `~/.claude/plugins/cache/...` の prose 依存を `CLAUDE_PLUGIN_ROOT`, config, autodetection に寄せる
- [ ] reviewer / worker 系の `memory` 方針を設計する
- [ ] `output-styles/` の採用可否を評価する

---

## 6. プラグイン / マーケットプレイス (Plugin/Marketplace)

### 6.1 公式仕様

短い引用:

> "The manifest is optional."  
Source: https://code.claude.com/docs/en/plugins-reference

> "If you include a manifest, `name` is the only required field."  
Source: https://code.claude.com/docs/en/plugins-reference

docs で確認できた `plugin.json` schema 主項目:

- Metadata: `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`
- Component paths: `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `monitors`
- Other: `dependencies`, `userConfig`

marketplace docs 要点:

- marketplace file は `.claude-plugin/marketplace.json`
- plugin version は `plugin.json` または `marketplace.json` のどちらか一方推奨
- docs は「manifest version が marketplace version に優先し、両方設定は避ける」と案内している

### 6.2 現在の harness plugin 実装状況

`plugins/harness/.claude-plugin/plugin.json`:

- 使用中: `name`, `version`, `description`, `author.name`, `homepage`, `repository`, `license`, `keywords`
- 未使用: `userConfig`, `dependencies`, component path overrides, `mcpServers`, `outputStyles`, `lspServers`, `monitors`

repo root `.claude-plugin/marketplace.json`:

- `name`, `owner.name`, `metadata.description`, `metadata.version`, `strict`, `plugins[]`
- plugin entry でも `version: "0.1.0"` を持つ

### 6.3 ギャップ分析

- `plugin.json` と `marketplace.json` の両方で version を持っている。docs の推奨と逆行する。
- `userConfig` 未使用。将来的に Codex / external service の endpoint, token, mode を plugin enable 時に prompt 収集できる。
- `outputStyles`, `mcpServers`, `dependencies`, `monitors` が未使用で、plugin platform の活用余地が大きい。
- manifest は default path discovery に依存しており、これは問題ではないが、plugin の feature matrix が docs の full schema に対して薄い。

### 6.4 アクションアイテム

- [ ] plugin version の source of truth を `plugin.json` か `marketplace.json` のどちらか一方に寄せる
- [ ] `userConfig` が有効な設定を洗い出す
- [ ] `outputStyles`, `mcpServers`, `dependencies`, `monitors` を採用するか判断する
- [ ] marketplace 配布用 docs に `extraKnownMarketplaces` / `enabledPlugins` パターンを追加する

---

## Top 10 最高影響ギャップ一覧

| # | ギャップ | カテゴリ | ユーザー可視インパクト | リスク | 優先度 |
|---|---|---|---|---|---|
| 1 | Hooks が 27 event 中 10 event しかカバーしていない | Hooks | High | High | P0 |
| 2 | hook runtime が公式 JSON 出力 schema を表現できない | Hooks | High | High | P0 |
| 3 | `SessionStart` / `SessionEnd` を登録しているのに実装は no-op | Hooks | Med | Med | P1 |
| 4 | `WorktreeCreate` / `WorktreeRemove` がなく Model B / isolation に弱い | Hooks | High | High | P0 |
| 5 | command frontmatter が最小限で `when_to_use`, `disable-model-invocation`, `agent`, `hooks`, `paths` を使っていない | Skills | High | Med | P1 |
| 6 | `description-ja` が docs 上で確認できず schema 追従性が低い | Skills | Med | Low | P2 |
| 7 | subagent で `skills`, `isolation`, `background`, `initialPrompt` を未活用 | Subagents | Med | Med | P1 |
| 8 | `.mcp.json` / plugin `mcpServers` がなく project-shared MCP 戦略がない | MCP | Med | Med | P1 |
| 9 | `~/.claude/plugins/cache/...` 前提の文面が多く portability が弱い | Settings / Portability | High | Med | P0 |
| 10 | plugin.json と marketplace.json の両方で version を管理している | Plugin / Marketplace | Med | Low | P2 |

---

## 実装推奨順序

1. hook runtime を公式 JSON schema に合わせて再設計する
2. `PostToolUseFailure`, `UserPromptSubmit`, `UserPromptExpansion`, `WorktreeCreate`, `WorktreeRemove` を追加する
3. `SessionStart` / `SessionEnd` を実処理化し、`InstructionsLoaded` / `CwdChanged` / `FileChanged` を足す
4. command frontmatter を整理し、`when_to_use`, `disable-model-invocation`, `agent`, `hooks`, `paths` を導入する
5. subagent frontmatter に `skills`, `isolation`, `memory`, `background` を反映する
6. hardcoded `~/.claude/plugins/cache/...` 依存を削減する
7. MCP と project/local install の公式設定階層を前提にした docs / setup flow を整える
8. plugin manifest / marketplace version 管理を一本化する

---

## 付記: ローカル実装の確認ポイント

確認した主要ファイル:

- `plugins/harness/.claude-plugin/plugin.json`
- `plugins/harness/agents/*.md`
- `plugins/harness/commands/*.md`
- `plugins/harness/hooks/hooks.json`
- `plugins/harness/core/src/index.ts`
- `plugins/harness/core/src/types.ts`
- `plugins/harness/core/src/guardrails/permission.ts`
- repo root `.claude-plugin/marketplace.json`

本監査で確認したところ、plugin root には以下が存在しない:

- `.mcp.json`
- `settings.json`
- `output-styles/`
- `.lsp.json`
- `monitors.json`
