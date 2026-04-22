---
name: session-handoff
description: "Session handoff document structuring skill for multi-session long-running project work. Provides init / update / archive for doc lifecycle, plus a read-only 3-gate check (structural integrity + content comprehension + rehydration synthesis) that comprehends the handoff and assesses next-session readiness at session start. Use when user mentions: handoff, bird's-eye index, session archive, compaction survival, context preservation, orient-phase, rehydration check, session-start readiness, /session-handoff, /handoff."
description-ja: "複数セッションにまたがる長期プロジェクト作業の引き継ぎドキュメントを構造化し、セッション開始時に 3-gate (構造整合性 + 内容把握 + rehydration 判定) で把握・理解・陳腐化判定まで行う skill。次セッション Claude が鳥瞰図ファイルだけ読めば即着手できる状態を維持する。以下のフレーズで起動: 引き継ぎを作る、鳥瞰図、セッションアーカイブ、把握、理解、開始前チェック、rehydration、圧縮耐性、コンテキスト保持、/session-handoff、/handoff。"
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"]
argument-hint: "[init|update|archive|check]"
---

# Session Handoff Skill

複数セッションにまたがるプロジェクトの引き継ぎ資料を
**鳥瞰図 (index) + detail files + per-session archive** の 3 層で構造化する skill。
単一ファイルに蓄積していく monolithic session-prompt が引き継ぎを破綻させる問題を
解決する。

---

## Why This Skill Exists (なぜ必要か)

長期プロジェクトで 1 ファイルに session log を蓄積すると以下が起きる:
**コンテキスト圧迫** (1000+ 行 prompt が context を食い潰す) / **設計判断の埋没**
(log の海に方針が沈む) / **陳腐化検出失敗** (古/新情報混在) / **次セッション
立ち上がり遅延** (どこから読むか不明)。本 skill は Anthropic 公式 2 パターン
([MEMORY.md + topic files][anthropic-memory] / [SKILL.md overview + supporting
files][anthropic-skills]) に倣い、**明示的な関心分離 (SoC)** を強制する。

[anthropic-memory]: https://code.claude.com/docs/en/memory
[anthropic-skills]: https://code.claude.com/docs/en/skills
[anthropic-context]: https://code.claude.com/docs/en/context-window
[anthropic-hooks]: https://code.claude.com/docs/en/hooks-guide

---

## Quick Reference

| サブコマンド | 用途 | いつ使うか |
|---|---|---|
| `init` | 新規プロジェクトで handoff ディレクトリ構造を作成 | プロジェクト開始時、1 回だけ |
| `update` | セッション終了時に current / backlog を最新化 | 毎セッション終了前 (必須) |
| `archive` | 現セッションの詳細ログを `archive/` に切り出し | セッションが完了した時点 |
| `check` | **3-gate 判定** (構造検証 + 内容把握 + rehydration 可否)、read-only | **セッション開始時**: `PASS/WARN/FAIL` または `INIT_REQUIRED` に応じて `update` / `archive` / `init` を案内 |

---

## Recommended Layout (推奨ファイルレイアウト — generic)

プロジェクト固有の slug を `<project>` と表記。実プロジェクトでは
例えば `<project>` → `my-app` / `new-feature` などに置換して使用する。

```text
.docs/handoff/
├── <project>-current.md          # 鳥瞰図 (< 120 行、次セッション起動専用)
├── <project>-backlog.md          # 優先度付き pending list
├── <project>-design-decisions.md # append-only 恒久方針
├── <project>-phases.md           # ロードマップ / Phase 定義 (optional)
├── <project>-setup.md            # branch 切替 / rollback 手順 (optional)
└── archive/
    ├── session-<YYYY-MM-DD>-<slug>.md
    └── ...
```

### Required Sections in `current.md` (この順番で)

1. **Latest state** — current branch / commit hash / last merged PR
2. **Top priority next task** — 5 行以内、即着手レベルの具体性
3. **Quick-start command block** — copy-paste 可能な bash block
4. **Pointers to detail files** — max 4 link (`<project>-backlog.md` etc.)

これら 4 つ以外は current.md から排除する。詳細はすべて detail file へ逃がす。

### Required Structure of `backlog.md` (必須構造)

```markdown
- [High|Med|Low] <Phase 識別子>: <1 行説明> (archive: session-YYYY-MM-DD-<slug>.md)
```

優先度ラベル (High/Med/Low) と Phase 識別子 (番号または名称、どちらも可) を必ず
付ける。archive への逆参照で「なぜこの申送が発生したか」を辿れるようにする。

### `design-decisions.md` is Append-Only (追記専用)

新しい恒久方針は末尾に追記。**既存エントリの編集・削除禁止**
(履歴を破壊するため)。古い方針を廃止する場合は
"Superseded by <date>: <理由>" を追記で示す。

### Archive File Naming Convention (archive/ の命名規約)

主規約:

```text
session-<YYYY-MM-DD>-<phase-slug>.md
```

例:
- `session-2026-03-14-phase-1-crud.md`
- `session-2026-04-22-hook-events.md`

1 セッション = 1 ファイルを原則とする。長時間セッションで Phase が跨がるなら
`session-<YYYY-MM-DD>-part-a.md` / `part-b.md` に分割。

**命名例外** (主規約の `session-` prefix に収まらないケース):

- `pre-<YYYY-MM-DD>-<slug>.md` — 既存 monolithic doc を分割する際の
  "ある日付以前の要約 archive" 用。単一セッションではなく複数セッションを
  まとめた historical summary を指し、通常の session ログとは扱いを変える
  ことを file 名で明示。`check` サブコマンドはこの prefix を許容する。
- `summary-<slug>.md` — Phase 完了時の Phase-level summary archive。
  個別セッションを跨いだ Phase 全体の結果を記録する用途。

### Recommended Archive File Structure (archive ファイルの推奨構造)

**最小テンプレート** (必須 — すべての archive に含める):

```markdown
# Archive: Session <YYYY-MM-DD> — <Phase 名 or 目的>

**生成日**: <YYYY-MM-DD>

## Session summary / 目的
(3-5 行で何を達成したセッションか)

## Design decisions / 設計判断
(このセッションで確定した恒久方針 — `design-decisions.md` への追記と対応)

## Open issues / 残件
(次セッションへの申送 — `backlog.md` への登録と対応)
```

**拡張テンプレート** (任意 — 該当する場合のみ追加):

```markdown
**元ファイル / 対象 PR**: <git commit range or PR URL>
  (PR-based workflow を使うプロジェクトで任意追加)

## Commits (任意)
(`git log --oneline <from>..<to>` の出力。git 基盤プロジェクトで任意追加)

## Review statistics / レビュー統計 (任意)
(使用したレビューツール毎の指摘件数サマリ。例: `<review-tool> X round で計 N 件、
<review-tool> Y round で Nitpick 1 件`。review 体制があるプロジェクトで任意追加。
ツール名は汎用 placeholder で記述)
```

**分離の意図**: PR を使わないチームや review tool を持たない小規模プロジェクト
でも最小テンプレートだけで運用可能にし、過剰な構造を強制しない (Codex review N-05 対応)。

この構造により、後から archive を読み返すときに "何が起きたか / なぜこう
決めたか / 次に何が必要か" が一貫して追跡できる。

---

## Update Triggers (更新タイミング)

| タイミング | 更新する file | 操作 |
|---|---|---|
| セッション開始前 | `current.md` + `check` 実行 | **まず `/session-handoff check` を実行**し、verdict に応じて案内: `PASS` → そのまま着手 / `WARN` → 内容確認し必要なら `update` / `FAIL` → `update` or `archive` を先に実行 / `INIT_REQUIRED` → `/session-handoff init` |
| **Phase 完了時** | `current.md` + `backlog.md` | 完了項目を backlog から削除、current に反映 |
| **重大な設計判断が固まった時** | `design-decisions.md` | append (不変、削除禁止) |
| **セッション終了時 (必須)** | `current.md` + `archive/session-<date>-<slug>.md` | 本セッションログを archive、current を最新化 |
| PR merge 完了時 | `backlog.md` | 対応済み項目を削除 or done マーク |
| 2 セッション間の長期空白 | `current.md` | 冒頭に "最終更新日" を追記、古すぎる情報に警告 |

---

## Anti-patterns (避けるべきパターン)

1. **current.md がセッションログを蓄積している**
   current は「今の状態」だけを持つ。ログは archive へ。
   毎セッション内容を積み重ねるのは monolithic の再発。

2. **セッション詳細と設計判断が同一ファイル**
   判断は `design-decisions.md`、ログは `archive/` に物理的に分離。
   混在すると判断が埋没する。

3. **backlog が無順序**
   優先度 + Phase ラベルなしの箇条書きは次セッションで無視される。
   `- [High] Phase X: ...` 形式を強制。

4. **archive を読まないと context が失われる構造**
   `current.md` だけで次タスクに着手できること。
   archive は "なぜそう決めたか" の調査用で、不要な前提にしない。

5. **1 archive ファイルに全セッション**
   セッションまたは Phase 単位で分割。1 ファイル 300 行超で強制分割。

6. **`@import` で detail を全 inline**
   Anthropic 公式仕様上、`@import` は **lazy loading ではなく展開**
   される (参照: [memory docs][anthropic-memory])。
   current.md から `@import` で全 detail を読み込ませると context 削減に
   ならない。link (markdown relative path) を使い、読み手が必要時だけ
   Read tool で開く方針を徹底。

7. **pointer リンクが 5 個以上**
   current.md は bird's-eye である。5 つ以上の detail file を挙げたら
   設計を見直す (detail file 同士で整理・統合を検討)。

8. **ephemeral session state を always-on memory (`CLAUDE.md`) に混ぜる**
   `CLAUDE.md` は 200 行未満の always-on facts 用。日々変動する
   current state は handoff file 側に分離する。

9. **`check` を受動的な構造 lint としか見なさない / セッション開始時にスキップする**
   `check` は orient-phase の補助機能であり、3-gate (構造 + 把握 + 再開可否判定)
   を実行する。セッション開始時に必ず走らせ、出力の verdict (`PASS` / `WARN` /
   `FAIL` / `INIT_REQUIRED`) に応じて次アクションを決める。また `check` を実行
   しても `current.md` / `backlog.md` の更新忘れは自動修正されない — `check` は
   報告役であり、人間 / Claude が `update` / `archive` で修正責務を負う。

10. **`check` 後に `current.md` / `backlog.md` を別途 Read する (冗長・redundant)**
    `check` Gate 2 で両 file の full content を Claude context に ingest 済。
    **check 後の再 Read (re-read) は冗長**、context 圧迫の原因。詳細が必要なら
    ingest 済 content を直接 query (新規 Read 不要)。例外: compaction 後は
    `/session-handoff check` 再走で再 ingest、個別 Read は避ける。

---

## Subcommand Details (サブコマンド詳細)

### `init`

新規プロジェクト用に handoff ディレクトリを作成:

```bash
mkdir -p .docs/handoff/archive
touch .docs/handoff/<project>-current.md
touch .docs/handoff/<project>-backlog.md
touch .docs/handoff/<project>-design-decisions.md
```

各 file に skeleton を書き込む。`<project>` placeholder を実名に置換。

### `update`

1. 現在の branch / commit を取得 (`git log --oneline -1`)
2. `current.md` の **Latest state** section を上書き
3. `backlog.md` の Top 3 を再検証 (完了済は削除 or 移動)
4. `current.md` の **Top priority** が backlog の最上位と一致することを確認

### `archive`

1. セッション成果を `archive/session-<YYYY-MM-DD>-<phase-slug>.md` に書き出し
2. 上記「archive ファイルの推奨構造」テンプレートに従って構造化:
   - **最小 (必須)**: Session summary / Design decisions / Open issues
   - **拡張 (任意)**: Commits / Review statistics / 対象 PR ref (PR-based workflow や review tool を持つプロジェクトでのみ追加、無ければ省略可)
3. `current.md` を backup (例: `<project>-current.prev.md`) した後、今セッションの
   成果を反映した最新状態で `current.md` を更新する (archive ファイルの内容を
   current.md に流し込むのではなく、current.md は「今の状態」の新しい snapshot に
   書き換える)

### `check`

**読み取り専用 (read-only)** の 3-gate 検証を実行する。セッション開始時や定期
健全性確認で使う。単なる構造検証 (v1) ではなく、handoff の **把握 (content
comprehension) と理解 (understanding synthesis)** まで一貫して確認する v2 仕様
(ユーザー要望「check は把握 / 理解も兼ねる」に応答)。

#### Gate 1 — Structural Integrity (構造検証、継続)

ファイルシステム上の構造が規約通りか確認 (存在 / 形式 / 命名 + 最低限のラベル
形式 regex チェックのみ。深い content 解析や意味抽出は Gate 2 に委ねる):

- `current.md` が 120 行を超えていないか
- 各 detail file (`backlog.md` / `design-decisions.md`) が存在するか
- `backlog.md` 各 entry に `[High|Med|Low]` priority ラベルがあるか
- `design-decisions.md` が append-only (前回コミットとの `git diff` で削除行検出 → FAIL)
- archive ファイル名が主規約 (`session-<YYYY-MM-DD>-<slug>.md`) または命名例外
  (`pre-<YYYY-MM-DD>-<slug>.md` / `summary-<slug>.md`) に従うか

#### Gate 2 — Content Comprehension (内容把握、v2 新設)

**full-context ingestion**: `Read` tool で `current.md` / `backlog.md` を
**全文** Claude context に取り込む。report は要約のみ出力するが、full content
は context に保持され直接 query 可能 → **check 後の個別 Read は冗長**
(Anti-pattern #10)。

実行手順:

1. `Read` で `current.md` **全文** 取込 → Latest state / Top priority / Quick-start /
   Pointers (max 4、各 `Glob` で実在確認) を抽出して report
2. `Read` で `backlog.md` **全文** 取込 → High priority top 3 を抽出
3. `Bash: git log --oneline -5` と Latest state 突合 (不一致 → Gate 3 で FAIL)
4. archive/ 最新 session archive (`session-<YYYY-MM-DD>-*.md` のみ、`summary-*` /
   `pre-*` は除外) と current.md を日付比較 (current が古ければ WARN)
5. **Context loaded 行数**を記録 (current + backlog の行数合計)、Summary で
   可視化 (再肥大化の即時検知)

#### Gate 3 — Understanding Synthesis (理解の総合判定、v2 新設)

把握した内容を元に **陳腐化シグナル (staleness signal)** を走査し、次セッション
即着手可否を 3 段階で判定:

| verdict | 条件 |
|---|---|
| **PASS (Ready)** | FAIL 0 / WARN 0 — そのまま次セッション開始可能 |
| **WARN (Partial)** | FAIL 0 / WARN 1+ — 着手は可能だが推奨対応あり |
| **FAIL (Stale)** | FAIL 1+ — update / archive を先に実行する必要あり |

**INFO severity の扱い**: INFO は verdict に影響しない。report の Staleness
signals に `ℹ️` アイコンで並記するが、PASS / WARN / FAIL 判定ロジックの
カウント対象外。補足情報として maintainer の気づきを促す役割のみ。

陳腐化 signal 一覧 (S-01 〜 S-13、severity 付き):

| ID | Signal | 検出方法 | Severity |
|---|---|---|---|
| S-01 | current.md 最終更新日が 3 日以上前 | `git log --follow -1` の日付 vs 今日 | WARN |
| S-02 | current.md 内の branch が存在しない | `git rev-parse --verify <branch>` | FAIL |
| S-03 | current.md 内の commit hash が存在しない | `git cat-file -e <hash>` | FAIL |
| S-04 | backlog `[High]` 項目が参照する PR が既に merged | `gh pr view <num> --json state` (gh 未導入なら skip) | WARN |
| S-05 | current.md Latest state が **current.md 記載 branch の** `git log -1 --oneline <branch>` と不一致 (S-02 が先行 FAIL なら SKIP) | 文字列突合 | FAIL |
| S-06 | current.md が参照する archive file が存在しない | `Glob` 確認 | FAIL |
| S-07 | 他 handoff-pointer docs (project memory / legacy pointer docs) 内の handoff path が無効 | `Glob` 解決 | WARN |
| S-08 | archive/ 最新 **セッション** archive (`session-<YYYY-MM-DD>-*.md` のみ、`summary-*.md` / `pre-*.md` は除外) より current.md が古い | 両 file の `git log --follow -1 --format='%aI' -- <file>` (commit date、ISO-8601) を比較 | WARN |
| S-09 | backlog の `archive:` 参照 file が存在しない | `Glob` 確認 | WARN |
| S-10 | current.md pointer link が 4 件超過 (anti-pattern #7) | link count | WARN |
| S-11 | design-decisions.md が 30 日以上 commit なし + backlog に設計項目あり | `git log -1` | INFO |
| S-12 | current.md が 90 行以上 (120 上限の warn threshold) | 行数 | WARN |
| S-13 | `backlog.md` が肥大化 — 150 行超で WARN / 200 行超で FAIL (**再肥大化 guard**、monolithic session-prompt 再発防止、Gate 1 Structural 由来) | 主経路: Gate 2 の Context loaded 行数 (`Read` 結果) を流用。**Gate 2 停止時 (Markdown 破損で Content Comprehension 停止等) のみ** fallback として `Bash: wc -l backlog.md` を使う (Gate 2 到達前に backlog Read 未完了なら N/A で reporting) | WARN (150+) / FAIL (200+) |

#### Output Template (実行結果の提示形式)

check 実行後の report 形式 (heading には bold を使い、`##` は避ける — consumer
document の regex-based scanner が誤検知しないため):

```markdown
**session-handoff check** — <YYYY-MM-DD HH:MM>

**Summary**
<PASS|WARN|FAIL|INIT_REQUIRED> — Structural: {P}/{W}/{F} | Content: {Extracted|Partial|Missing} | Synthesis: <Ready|Partial|Stale|N/A> | Context loaded: <N> lines (current: {X}, backlog: {Y})

**Context loaded**: Gate 2 で `Read` した `current + backlog` の行数合計。
300 行超は S-12 (current 90+) または S-13 (backlog 150+) のいずれかが既に
WARN 以上の状態を示唆 (分割検討)。report 要約外の詳細 (Quick-start bash 全文、
運用ルール、背景 docs 等) も **Claude context に ingest 済**なので、check 後の
再 Read は不要 (Anti-pattern #10)。

**INIT_REQUIRED**: `.docs/handoff/` が空/未作成時の独立 verdict。他 3 verdict と
orthogonal、Structural/Content/Synthesis 実行前に判定、`init` 案内を表示。

---

**Gate 1 — Structural Integrity**

| 項目 | 結果 | 詳細 |
| --- | --- | --- |
| current.md 行数 | ✅ N 行 / 120 上限 | — |
| detail files 存在 | ✅ 全 N 件 (必須 2 件 + optional M 件) | — |
| backlog ラベル | ⚠️ M 件ラベルなし | 行 X, Y |
| design-decisions append-only | ✅ | — |
| archive 命名規約 | ✅ 全 N 件 | — |

---

**Gate 2 — Content Comprehension**

- **Branch**: <branch>
- **Latest commit**: <hash> <msg> (<date>)
- **Top priority**: <extracted one-liner>
- **Quick-start command**: ✅ / ⚠️ missing
- **Pointers**: N 件 (全て実在確認済 / N 件 broken)
- **Backlog Top 3 [High]**: 1. ... / 2. ... / 3. ...

---

**Gate 3 — Understanding Synthesis**

- **Rehydration verdict**: <Ready|Partial|Stale>
- **Staleness signals**:
  - ⚠️ S-01: current.md が N 日更新なし (<date>)
  - ✅ S-02 / S-03 / S-05 (git 突合 OK)
  - (他 signals を列挙)

---

**Recommended Remediation**
<FAIL があれば具体的な次アクション、PASS なら「次タスクに着手可能」の一言>
```

#### Forbidden (check の禁止事項)

`check` は **read-only must**。絶対禁止:
- **write op 全般**: ファイル書き換え / 削除、`git commit`/`push`/`reset`、
  `design-decisions.md` 編集 (append-only 守護)、archive 削除 / 移動、
  上位 memory (project/user) 書き換え、PR/Issue 自動 close
- **ネットワーク書込**: 外部 POST (read-only `gh pr view` のみ許可)
- **推測 stale 断定**: git/Glob 実証不可なら「確認不可」で WARN 止まり

#### Edge Cases (劣化ケースのハンドリング)

- **First-time use (未初期化)**: `Glob` で `.docs/handoff/` が空なら `FAIL` では
  なく `INIT_REQUIRED` を返し、`/session-handoff init` の実行を案内
- **Git unavailable (CI / shallow clone)**: `Bash: git ...` が exit ≠ 0 なら
  以下全てを SKIP し、output に "git unavailable — skipped: S-02, S-03,
  S-05, S-08, S-11, design-decisions append-only 判定" と記載:
  - Gate 3 の git 依存 signal (S-02 / S-03 / S-05 / S-08 / S-11)
  - Gate 1 の `design-decisions.md` append-only 判定 (`git diff` 依存、
    git 不可環境では非決定的なため WARN `append_only_unverified` に格下げ)
  Structural (git 非依存分) と Content は継続実行 (hard fail しない)
- **Large archive (> 20 files)**: `Glob` 一覧取得後、主規約 (`session-<YYYY-MM-DD>-*.md`)
  のみ日付ソートで最新 10 件を命名規約チェック。命名例外 (`summary-*.md` /
  `pre-*.md`) は日付情報を持たないため日付ソート対象外、件数カウントのみ。
  output に「session archives: N 件中最新 10 件サンプリング、exception archives:
  M 件 (summary/pre prefix)」と明記
- **gh CLI 未導入**: S-04 を SKIP (他 signal は継続)
- **current.md の markdown 破損** (canonical behavior): Required section が
  regex で拾えないなら以下を統一的に実施:
  1. Gate 2 (Content Comprehension) を **即時停止** (部分抽出した情報は破棄)
  2. Gate 3 (Synthesis) を引き続き実行。ただし Gate 3 の staleness signal
     走査は Gate 2 抽出情報に依存する S-04 / S-05 を SKIP (`content_comprehension
     halted: signals skipped: S-04, S-05`)
  3. Output Template では `required_section_missing: FAIL` を Gate 1 Structural
     結果として carry-over 表示し、Gate 2 / Gate 3 は degraded status で報告
  4. Recommended Remediation で「current.md の required 4 sections を修復し
     再実行」を必ず提示
  (Gate 3 完全 skip ではなく「Gate 2 dependent signals だけ skip」とする理由:
  Structural (Gate 1) 由来のシグナル S-06 / S-07 / S-09 / S-10 / S-12 / S-13 は
  Gate 2 に依存しないため、引き続き有用な陳腐化診断を提供できる)

---

## Self-Validation Checklist (実装時の自己検証)

### 共通 (全 subcommand)

- [ ] プロジェクトルート (CLAUDE.md 所在ディレクトリ) を特定
- [ ] `.docs/handoff/` が存在するか (なければ `init` 提案)

### `init` / `update` / `archive` (mutating subcommand)

- [ ] 既存 file に壊さない変更を適用 (`backup → edit → verify` の順)
- [ ] `design-decisions.md` は append 以外の操作を拒否
- [ ] archive 書き出し時に元 session record を `grep -c "Session"` 等で
      検証し、情報欠損がないこと

### `check` (read-only 3-gate subcommand)

- [ ] **Gate 1-3 を全て実行**し、Structural → Content → Synthesis の順で
      accumulate する (途中 gate で内部 FAIL があっても、後段 gate は可能な
      限り情報取得を継続する)
- [ ] **read-only 制約を守る** — Read / Glob / Grep / 読み取り専用 Bash のみ
      使用、ファイル書き換え / commit / push / edit 一切禁止
- [ ] **required section (current.md 4 section) 未検出**なら `Content
      Comprehension` を停止し、Structural のみ報告 + `required_section_missing`
      FAIL を Gate 3 に持ち越し
- [ ] **git / gh unavailable** の場合は該当 signal を SKIP し、output に明示
      列挙 (`signals skipped: S-02, S-03, ...`)
- [ ] **verdict と Recommended Remediation が整合**している — FAIL があれば
      必ず具体的な remediation command を提示、PASS なら「次タスク着手可能」
      のみ
- [ ] **INFO signal は verdict に影響させない** (PASS/WARN/FAIL 判定の
      カウント対象外、report には ℹ️ で併記のみ)

---

## Alignment with Anthropic Official Docs (Anthropic 公式との整合性)

本 skill は Anthropic 公式の以下を踏襲:

- **[MEMORY.md pattern][anthropic-memory]**: concise index + topic files
- **[SKILL.md pattern][anthropic-skills]**: overview + supporting files
  (本 skill 自体も 500 行未満で記述)
- **[context window 推奨][anthropic-context]**: 変動する情報と always-on を分離

本 skill が追加する invariant:
- **handoff 専用 directory** (`.docs/handoff/`) を持つ (Anthropic 公式は
  directory 名を規定せず。pattern 自体は公式整合)
- **per-session archive** 運用 (公式は archive の自動化を skill or hook
  で実装することを許容している)
- **check が orient-phase 判定を兼ねる** (公式 [SessionStart hook][anthropic-hooks]
  は `startup` / `resume` / `clear` / `compact` source を区別する。本 skill
  の `check` は v2 で 3-gate 化しており、SessionStart hook 配線時の
  orient-phase 判定として wire できる。auto-invoke する場合は read-only
  契約 + 短時間実行を守り、`FAIL` でも hard block しない運用を推奨)

---

## Related Skills / Hooks (関連 skill / 機能)

- `/harness-plan` — Plans.md 管理 (本 skill と相補的、Plans.md は active
  task tracker、handoff は context 保全)
- `SessionStart` / `SessionEnd` hook — 自動 trigger に乗せる場合は plugin
  hooks.json で wire する (詳細は [anthropic-hooks][] 参照)
- `PreCompact` hook — compaction 直前に current.md を保護する用途に使える

---

## Notes (注意事項)

- 本 skill は **汎用テンプレート** である。特定プロジェクトの branch 名 /
  ファイル layout 前提はない。project-specific な拡張は consumer 側
  `.claude/skills/<project>-handoff/` で override する。
- 本 skill は破壊的操作を行わない。archive 書き出しは常に追加、
  既存 file の削除はユーザー明示承認を要求する。
- `update` / `archive` が自動 trigger される場合、
  Anthropic 公式では `SessionEnd` hook に wire することを推奨。

---

**本 skill**: v1.0 初版 / 最終更新 2026-04-22
