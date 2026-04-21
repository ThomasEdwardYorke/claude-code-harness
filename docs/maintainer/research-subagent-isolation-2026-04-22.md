# Subagent `isolation` フィールド 深掘り調査レポート — 2026-04-22

**調査日**: 2026-04-22
**調査者**: Codex Worker C (Claude Sonnet 4.6 via codex-sync agent)
**前提リサーチ**: `research-anthropic-official-2026-04-22.md` (Codex Worker A) の「isolation 未使用 P1」指摘を深掘り
**関連 doc**: `research-plugin-best-practice-2026-04-22.md` (Codex Worker B) / `leak-audit-2026-04-22.md` (Phase κ 項目) / `test-bed-usage.md` (Phase κ Resolved 項目)
**調査 URL**:
- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.anthropic.com/en/docs/claude-code/plugins-reference

---

## 調査対象 1: Subagent frontmatter `isolation` フィールド

### 1. 正式な型と取りうる値

**公式ドキュメント引用** (https://docs.anthropic.com/en/docs/claude-code/sub-agents, "Supported frontmatter fields" 表):

> Set to `worktree` to run the subagent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the subagent makes no changes.

**結論**:
- 型: 文字列 (string)
- 取りうる値: `"worktree"` のみ (公式ドキュメントに明記されている唯一の値)
- plugins-reference からの補足: 「The only valid `isolation` value is `"worktree"`」と明示されている
- `none` という値は公式ドキュメントに存在しない
- フィールド自体を省略した場合の明示的な値 (`none` 等) は定義されていない

### 2. `isolation: worktree` を指定した場合の挙動

**公式ドキュメント引用**:

> Set to `worktree` to run the subagent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the subagent makes no changes.

**また plugins-reference の hook 説明より**:

> WorktreeCreate: When a worktree is being created via `--worktree` or `isolation: "worktree"`. Replaces default git behavior.
> WorktreeRemove: When a worktree is being removed, either at session exit or when a subagent finishes.

**まとめ**:
- 自動 worktree 作成: **YES** — 一時的な git worktree が自動作成される
- cleanup タイミング: **変更なし → 自動 cleanup**。サブエージェントが変更を加えた場合の cleanup タイミングは明示されていない (公式 docs で明確でない)
- branch 命名規則: **公式 docs で明確でない** — sub-agents ページには命名規則の記述なし
- WorktreeCreate hook でデフォルト git 挙動を差し替えられる: YES

### 3. `isolation: none` または省略時のデフォルト挙動

**公式ドキュメント引用**:

> A subagent starts in the main conversation's current working directory. Within a subagent, `cd` commands do not persist between Bash or PowerShell tool calls and do not affect the main conversation's working directory. To give the subagent an isolated copy of the repository instead, set `isolation: worktree`.

**結論**:
- `isolation` を省略した場合のデフォルト: メイン会話のカレントワーキングディレクトリで動作する
- `cd` コマンドは Bash ツール呼び出し間で持続しない
- `cd` はメイン会話の working directory に影響しない
- **リポジトリの共有状態に書き込む可能性がある** (ファイルを Write/Edit する agent の場合)
- `none` という値は公式 docs に存在しない。省略 = デフォルト = 共有ディレクトリ動作

### 4. Plugin 同梱 subagent でのサポート状況

**公式ドキュメント引用** (sub-agents, plugin subagents section):

> For security reasons, plugin subagents do not support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a plugin.

**plugins-reference 引用**:

> Plugin agents support `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, and `isolation` frontmatter fields. The only valid `isolation` value is `"worktree"`. For security reasons, `hooks`, `mcpServers`, and `permissionMode` are not supported for plugin-shipped agents.

**結論**:
- **`isolation` は plugin 同梱 subagent でサポートされる** (明示的にリストに含まれている)
- 無視される (ignored) フィールドは `hooks` / `mcpServers` / `permissionMode` の 3 つのみ
- `isolation: worktree` を plugin の agent frontmatter に追加することは公式にサポートされている

### 5. `isolation` と `Task` tool 経由のネスト subagent 起動との関係

**公式 docs で明確でない** — 公式 sub-agents ドキュメントには Task tool 経由の呼び出しと `isolation` の相互作用についての記述が見当たらなかった。

推定可能な点 (推測であり断定ではない):
- `isolation: worktree` は frontmatter で宣言するため、その agent が Task tool 経由で呼ばれた場合でも frontmatter 定義に従って worktree が作成されると考えられる
- ただし Task tool がどのように subagent の frontmatter を解釈するかは公式 docs で明記されていない

**要追加調査**: Task tool 経由の呼び出しで isolation が適用されるかどうかは、Claude Code のソースコードまたは追加の公式ドキュメントを参照する必要がある。

### 6. どういう種類の agent に `isolation: worktree` を適用するのが適切か

**公式 guidance の明示的な記述は限定的**。公式 docs は挙動の説明のみで、どういう agent に適切かの推奨は記述されていない。

文脈から読み取れる意図:
- `cd` コマンドが通常は持続しない問題の解決策として提示されている
- 「isolated copy of the repository」が必要な場合 = リポジトリ全体を操作する必要がある agent
- 実験的な変更、並列作業、干渉を避けたい作業に適している

公式 common-workflows より:
> You need each Claude session to have its own copy of the codebase so changes don't collide. Git worktrees solve this by creating separate working directories that each have their own files and branch, while sharing the same repository history and remote connections.

**適切な適用ケース** (公式 docs の文脈から導出、推測を含む):
- 実装 agent (Write/Edit でファイルを変更する) かつ並列実行される場合
- 実験的な変更を main worktree に影響させずに行う場合
- Read-only な agent には isolation は不要 (dry-run の恩恵なし)

---

## 調査対象 2: 既存 harness plugin 6 agent の `isolation` 付与判断

### 前提: 各 agent の基本属性

| agent | tools | 書き込み | 実行時間 | 呼び出し元 |
|---|---|---|---|---|
| `worker.md` | Read, Write, Edit, Bash, Grep, Glob | **あり** | 長い (maxTurns: 40) | `/harness-work`, `/parallel-worktree` |
| `reviewer.md` | Read, Grep, Glob | **なし** | 中程度 (maxTurns: 20) | `/harness-review` |
| `scaffolder.md` | Read, Write, Edit, Bash, Grep, Glob | **あり** | 中程度 (maxTurns: 30) | `/harness-review`, `/harness-plan`, `/harness-setup` |
| `security-auditor.md` | Read, Grep, Glob, Bash | **なし** (監査レポートのみ) | 長い (maxTurns: 30) | `/security-review` |
| `codex-sync.md` | Bash, Read | **なし** (Codex 呼び出しのみ) | 短い (maxTurns: 10) | 親 agent からの直接呼び出し |
| `coderabbit-mimic.md` | Bash, Read, Grep, Glob | **なし** (findings のみ返す) | 中程度 (maxTurns: 20) | `/pseudo-coderabbit-loop` |

### worker.md — 推奨: **条件付き (将来的に YES)**

**現状の呼び出しフロー**:
- `/parallel-worktree` が 手動 `git worktree add` で worktree を事前作成し、その中で worker を起動する設計
- 各 worktree は coordinator が `git worktree add ../parts-management-wt-<slug>` で作成している
- **現在の運用では `isolation: worktree` なしで worktree は既に分離されている**

**判断**:
- 現状の `/parallel-worktree` 経由の呼び出しでは不要 (coordinator が手動 worktree 管理)
- 将来的に worker を単独 agent として直接呼び出す場合 (Solo モードで `isolation: worktree` 付き) には有益
- **ただし既存の coordinator worktree 管理フローと干渉する可能性がある** — 二重 worktree になるリスクがある

**追加調査が必要な点**: `/parallel-worktree` が手動 worktree に入った状態で agent が `isolation: worktree` を持つ場合、 nested worktree が作られるのか、またはそれが git でサポートされるかを確認する必要がある。

### reviewer.md — 推奨: **付けない**

**理由**:
- Read-only (Write/Edit なし) のため、main worktree と状態が共有されても副作用がない
- `isolation: worktree` を付けると worktree が作成されるオーバーヘッドがあり、read-only な review に対してコストに見合わない
- 公式ドキュメントの意図 (isolated copy が必要なケース) に合致しない

### scaffolder.md — 推奨: **付けない (現状)**

**理由**:
- `/harness-setup` / `/harness-plan` / `/harness-review` から呼ばれ、Plans.md や `.claude/rules/` など **main repo の特定ファイルを直接編集することが目的**
- isolation: worktree で隔離されると変更が main worktree に反映されず、目的を達成できない
- scaffolder は main worktree の直接変更を前提とした設計であり、isolation は設計と矛盾する

### security-auditor.md — 推奨: **付けない**

**理由**:
- Bash を使うが Write/Edit はなく監査レポートのみを出力する
- main worktree の現状を正確に読み取ることが目的であり、isolated copy が必要ではない
- Bash で外部コマンド (ruff, mypy, semgrep 等) を実行するが、これらは main worktree の状態を読んで動作する
- isolation: worktree でコピーを作ると監査対象と実際の状態の乖離が発生しうる

### codex-sync.md — 推奨: **付けない**

**理由**:
- Bash (Codex CLI 呼び出し) と Read のみ。Write/Edit なし
- ファイルシステムへの書き込みは行わない
- worktree isolation のオーバーヘッドがタスクに対して過大
- 短時間で完了する設計 (maxTurns: 10) と isolation の worktree 作成コストのバランスが悪い

### coderabbit-mimic.md — 推奨: **付けない**

**理由**:
- Read-only + Bash (静的解析実行) のみ。Write/Edit なし
- CodeRabbit 風レビューを実施するが、変更はしない設計
- `memory: project` を使っているが、これは isolation とは無関係
- reviewer.md と同様の理由で isolation のコストに見合わない

---

## サマリー表

| agent | isolation: worktree 推奨 | 理由の要点 |
|---|---|---|
| `worker.md` | 条件付き (将来) | Write/Edit あり、並列実行で有益だが現行 coordinator 管理フローと干渉リスクあり |
| `reviewer.md` | 付けない | Read-only、副作用なし、コスト不釣り合い |
| `scaffolder.md` | 付けない | main repo 直接編集が目的、isolation と矛盾 |
| `security-auditor.md` | 付けない | 監査のみ、Write/Edit なし |
| `codex-sync.md` | 付けない | Codex 外部呼び出しのみ、Write/Edit なし |
| `coderabbit-mimic.md` | 付けない | Read-only レビュー、Write/Edit なし |

---

## 不明点・要追加調査

1. **branch 命名規則**: `isolation: worktree` で作成される worktree の branch 名が何になるかは公式 docs で明示されていない。`--worktree` フラグ使用時の命名規則 (`.claude/worktrees/<name>/`) が適用されるかは不明。

2. **変更ありの場合の cleanup**: 「subagent makes no changes の場合は自動 cleanup」と記述があるが、変更がある場合のライフサイクルは記述なし。`WorktreeRemove` hook の「session exit または subagent 終了時」という記述から、終了時には常に cleanup 試行されると推定されるが、changes が残った worktree がどう扱われるかは不明。

3. **Task tool 経由の挙動**: Task tool 経由でネスト呼び出しされた subagent の `isolation` frontmatter が有効になるかどうかは公式 docs で明確でない。

4. **coordinator 管理 worktree と二重 isolation**: `/parallel-worktree` が手動で worktree を作成した状態で `isolation: worktree` の agent が起動する場合、nested worktree になるのか、またはその挙動は公式 docs で確認できない。

---

## Phase κ (subagent isolation 追加) への推奨

この調査に基づく推奨:

1. **即時適用対象なし**: 現状の 6 agent は全て `isolation: worktree` を付けない方が整合的
2. **worker.md の将来設計**: Model B の worker agent を solo/parallel の 2 variant に分離する場合、solo variant に `isolation: worktree` を付与することを検討する価値がある
3. **`isolation` は plugin agent でサポート済み** — 技術的障壁はない。設計上の適切なタイミングで適用する
4. **不明点 1-4 を解消してから worker への適用を決定**することを推奨 (特に coordinator 管理 worktree との干渉問題)
