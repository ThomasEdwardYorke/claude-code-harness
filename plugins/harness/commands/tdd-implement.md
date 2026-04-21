---
name: tdd-implement
description: "TDD + Codex チーム協業 + 疑似 CodeRabbit × 本物 CodeRabbit の完全レビューループによる最高品質の実装ワークフロー。実装指示を受けた時に使用する。「実装して」「修正して」「機能追加して」「バグ修正して」「リファクタリングして」などの実装タスク全般に適用。品質を妥協せず、チェックリスト管理・TDD・Codex レビューループ・CodeRabbit レビューループで完璧な実装を目指す。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task"]
argument-hint: "<task description> [--profile=chill|assertive|strict] [--no-commit]"
---

# TDD Implementation with Codex Team + CodeRabbit Loop

実装タスクを受けた時に、TDD（テスト駆動開発）+ Codex チーム協業 + 疑似 CodeRabbit × 本物 CodeRabbit の統合レビューループで最高品質の実装を行うワークフロー。

## 基本原則

- **絶対に諦めない。妥協しない。最高の実装にする**
- 既存のシステムを壊さない（最新の注意を払う）
- 曖昧なところは公式ドキュメントを Codex で読んで確認
- 全てのパイプライン入り口で同じ実装になっているか最後に確認
- **push 前に疑似 CodeRabbit 通過、本物 CodeRabbit クリアまで回す**（rate limit で止まらない）

## ワークフロー全体像

```
Phase 1  計画とチェックリスト作成
   ↓
Phase 2  RED（失敗テスト）
   ↓
Phase 3  GREEN（最小実装）
   ↓
Phase 4  Codex 並列検証
   ↓
Phase 5  Codex レビューループ（実装ロジック観点）
   ↓
Phase 5.5 疑似 CodeRabbit レビューループ（CodeRabbit 観点、push 前）  ← NEW
   ↓
Phase 6  PR 作成 + 本物 CodeRabbit レビューループ                    ← 強化
   ↓
Phase 7  Codex セカンドオピニオン（CodeRabbit clear 後）              ← 統一
   ↓
Phase 8  Merge + 最終確認
   ↓
Phase 9  ドキュメント更新
```

---

## Phase 1: 計画とチェックリスト作成

実装前にタスクを分解し、TaskCreate で管理する。

1. 変更対象ファイルと影響範囲を調査
2. 実装タスクを細分化してチェックリスト化（TaskCreate）
3. 各タスクに依存関係を設定
4. ユーザーに計画を提示して承認を得る（🔴 重要タスクのみ、🟢 軽量なら省略可）

**チェックリストには以下を必ず含める:**
- RED: テスト作成
- GREEN: 実装
- テスト全パス確認
- エントリポイント同一性確認
- **Phase 4 Codex 並列検証**
- **Phase 5 Codex レビューループ**
- **Phase 5.5 疑似 CodeRabbit レビューループ（`/pseudo-coderabbit-loop --local`）**
- **Phase 6 本物 CodeRabbit レビューループ（`/coderabbit-review <pr>`）**
- **Phase 7 Codex セカンドオピニオン**
- Phase 8 Merge + 最終確認
- Phase 9 ドキュメント更新

---

## Phase 2: RED（失敗するテストを先に書く）

**テストを書き換えてパスさせることは禁止。** 実装コードを修正してテストを通す。

1. 新しい振る舞いを検証するテストを作成
2. テスト実行 → 失敗を確認（RED）
3. 失敗が「正しい理由で失敗している」ことを確認

```bash
python -m pytest <test_file> -k "<test_name>" -v --tb=short
```

---

## Phase 3: GREEN（テストを通す最小限の実装）

1. テストが通る最小限のコードを実装
2. 既存テスト含め全テスト実行 → 全パス確認

```bash
python -m pytest <all_test_files> -q --tb=short
```

3. 全テスト通過を確認してから次に進む

---

## Phase 4: Codex チーム協業（並列検証）

**並列実行を最大活用する。** 独立したタスクは Agent で並列に処理。

### Codex をワーカーとして使う場合
- 調査タスク（公式ドキュメント精読、ベストプラクティス調査）
- 実装の独立検証（同じタスクを別解で実装させて突合）

### Codex をレビューに使う場合

推奨（Claude Code の harness 経由）:

```text
Agent({
  subagent_type: "harness:codex-sync",
  prompt: "レビュー観点を明示してコード差分をレビュー..."
})
```

直接 CLI 経由:
```bash
CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
node "$CODEX_COMPANION" task "<レビュー依頼>" --effort medium
```

**Codex 運用ルール:**
- **1 ジョブずつ実行**（同時実行でスタックする）
- スタックしたジョブは即キャンセル
- `--effort medium` を基本とする（high は長時間タスクのみ）
- **worktree 並列開発中は、各 worktree の Codex レビューをシリアル化**

---

## Phase 5: Codex レビューループ（実装ロジック観点）

**全観点 OK になるまで繰り返す。** 実装のバグ・ロジック・セキュリティ・性能に集中。

```text
Loop:
  1. Codex にレビュー依頼（観点を明示）
  2. 指摘を分類（重大/軽微/OK）
  3. 重大・軽微を修正
  4. テスト全パス確認
  5. 再レビュー → 全観点 OK なら次フェーズへ
```

レビュー観点の例:
- バグ・論理エラー
- 後方互換性
- テストカバレッジ
- セキュリティ脆弱性
- パフォーマンス
- リソースリーク

---

## Phase 5.5: 疑似 CodeRabbit レビューループ（NEW、push 前必須）

**Phase 5 とは観点が異なる** — Phase 5 は実装ロジック、Phase 5.5 は **CodeRabbit 公式 taxonomy 準拠のコード品質 + style + type-safety + outside-diff 検証**。

### なぜ必要か

本物 CodeRabbit には rate limit がある（Pro プランで **5 PR reviews/hour**、rolling bucket）。worktree 並列開発では 1 時間で簡単に上限到達。無駄な push → rate limit ヒット → 長時間待機、を避けるため **push 前に Codex で CodeRabbit 風 pre-review を実施**して critical/actionable を刈り取る。

### 実行方法

まず `$ARGUMENTS` から `--profile=` を抽出 (argv 単位 case 完全一致、未指定時は `chill`)。
上流 (`harness-work`) が materialize して渡した値、または直接コマンドライン指定のいずれかを受ける。

```bash
# 注: 本ブロックは bash 前提 (array 0-based indexing + `unset 'arr[idx]'` semantics)。
# zsh で実行される場合は冒頭の `emulate -L bash` guard が bash semantics に切替える。
#
# CLI --profile= 抽出 (末尾 token のみ option として扱う)。
# 全 token を scan すると task description 本文の `--profile=assertive` を誤認するため、
# ARGS_TOKENS[-1] に option があるかだけ判定し、option なら末尾から切り離して task description に回す。
#
# PROFILE 継承方針 (CodeRabbit PR #1 Major: tdd-implement.md:189 対応):
#   1. 既に環境 / 呼び出し元 (harness-work) が PROFILE を設定していればそれを尊重
#   2. CLI `--profile=...` が末尾 token にあれば最優先で上書き
#   3. どちらも無ければ最終 fallback `chill`
# これにより、/harness-work が解決した profile が /tdd-implement で無条件に "chill" にリセット
# されてレビュー強度が静かに下がる問題を防ぐ。
# Shell 互換: read -r -a / 配列 0-based / unset 'arr[idx]' は bash 拡張。
# zsh / dash / POSIX sh では silent degrade する可能性があるため、BASH_VERSION を明示確認して fail-fast。
# Claude Code の Bash tool は通常 /bin/bash で実行されるので本 guard は保険。
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: /tdd-implement argv parser requires bash (BASH_VERSION unset)." >&2
  echo "       手動実行時は 'bash -c \"/tdd-implement ...\"' で包んでください。" >&2
  exit 1
fi
read -r -a ARGS_TOKENS <<< "$ARGUMENTS"
# upstream が PROFILE を設定済ならそれを使う。未設定ならまず chill に初期化してから
# 末尾 token で上書き可能にする。
if [ -z "${PROFILE:-}" ]; then
  PROFILE="chill"
fi
LAST_IDX=$((${#ARGS_TOKENS[@]} - 1))
if [ "$LAST_IDX" -ge 0 ]; then
  LAST_TOK="${ARGS_TOKENS[$LAST_IDX]}"
  case "$LAST_TOK" in
    --profile=chill|--profile=assertive|--profile=strict)
      PROFILE="${LAST_TOK#--profile=}"
      unset 'ARGS_TOKENS[LAST_IDX]'
      ;;
  esac
fi

# --no-commit flag 抽出 (argv 全走査、unset で TASK_DESCRIPTION に紛れないようにする)。
# 順序重要: unset を TASK_DESCRIPTION 構築 **より前** に行う。
NO_COMMIT=""
for i in "${!ARGS_TOKENS[@]}"; do
  if [ "${ARGS_TOKENS[$i]}" = "--no-commit" ]; then
    NO_COMMIT="--no-commit"
    unset 'ARGS_TOKENS[i]'
  fi
done

# 残った ARGS_TOKENS を task description として使う (--profile= / --no-commit 除外済)
TASK_DESCRIPTION="${ARGS_TOKENS[*]}"
```

解決した `$PROFILE` を Phase 5.5 の呼出に直列化 (Skill handoff 規約と同じ、literal `${PROFILE}` のまま渡さない):

```text
# テンプレート表記
/pseudo-coderabbit-loop --local --profile=$PROFILE

# 実際の呼出例 (PROFILE=assertive の場合)
/pseudo-coderabbit-loop --local --profile=assertive
```

または worktree 指定:
```text
/pseudo-coderabbit-loop --local --profile=$PROFILE --worktree=/path/to/worktree
```

このコマンドは内部で:
1. `.coderabbit.yaml` を読み、`reviews.profile` / `path_instructions` を取得
2. `coderabbit-mimic` agent を起動し、Codex に以下を投げる:
   - 全 git diff
   - 静的解析出力 (ruff / eslint / semgrep / gitleaks 等、存在するもの)
   - プロジェクト規約（CLAUDE.md / AGENTS.md / `.claude/rules/*.md`）
   - profile 別コメント上限 (chill: 3 / assertive: 6 / strict: 10)
3. CodeRabbit 公式 taxonomy で findings 返却:
   - Review types: `potential_issue` / `refactor_suggestion` / `nitpick`
   - Severity: `critical` / `major` / `minor` / `trivial` / `info`
   - Scope: `in_diff` / `outside_diff`
4. actionable は全修正、nitpick は profile に応じて判断
5. clean になるまで最大 5 回反復

### 完了条件

- `actionable_count == 0`
- profile 別の nitpick 上限以内
- そのプロジェクトの test / lint / typecheck が clean (言語別):
  - Python: `pytest` / `ruff check` / `mypy`
  - TypeScript / JavaScript: `npm test` / `npm run lint` (もしくは `eslint`) / `npm run typecheck` (もしくは `npx tsc --noEmit`)
  - Rust: `cargo test` / `cargo clippy` (or `cargo check`)
  - Go: `go test ./...` / `golangci-lint run` / `go vet ./...`
  - その他言語は repo の慣用 command に合わせる

### push する

Phase 5.5 クリア後に `git push`。これで Phase 6 の本物 CodeRabbit が走る。

### `--no-commit` による commit/push skip (--no-commit 規約)

argv 中に `--no-commit` が含まれる場合、Phase 8 の自動 commit + push を **skip** する。`harness-work` / `parallel-worktree` から forward されたフラグをそのまま受け取り、手動でレビューしたい / CodeRabbit 反復で fast iteration したいケースで使う。

抽出は既に上記 Pre-flight で済み (`NO_COMMIT` 変数 + ARGS_TOKENS から unset 済)。Phase 8 commit step の冒頭で分岐:

```bash
# Phase 8 commit step
if [ -n "$NO_COMMIT" ]; then
  echo "NO_COMMIT: skip commit + push (手動運用、Phase 9 完了報告のみ実施)"
else
  git add -A
  # ... 通常 commit + push
fi
```

### Plans.md 更新責務 (coordinator 専任原則の明示)

**本スキル `/tdd-implement` は leaf worktree 内で呼ばれる設計**。Plans.md の担当表 / 完了セクションの更新は **coordinator 専任** (harness-work / harness-plan が実施)。leaf 内で Plans.md を touch すると worktree 間で衝突するため禁止。

- ✅ OK: code 実装 / test 実装 / commit
- ❌ NG: Plans.md の担当表書換 / 完了セクション追記

**例外**: `/tdd-implement` が単発 (Plans.md 外、`--profile` など引数のみ) で呼ばれたケースは Plans.md 自体が対象外なので無関係。

---

## Phase 6: PR 作成 + 本物 CodeRabbit レビューループ（強化）

push 後に PR を作成すると CodeRabbit が自動レビュー開始。これをクリアするまで反復。

### 6.1 PR 作成

```bash
gh pr create --repo <owner>/<repo> --base <base> --head <head> \
  --title "[label] タイトル" --body "$(cat <<'EOF' ... EOF)"
```

### 6.2 CodeRabbit レビュー監視

```text
/coderabbit-review <pr-number>
```

内部で以下を自動判定（Clear 3 段判定、`coderabbit-review.md` Step 7.1-7.4 準拠）:
- **最強**: `reviews[-1].state == "APPROVED"`
- **中**: unresolved CodeRabbit threads == 0
- **阻害なし**: `rate limited` / `Reviews paused` marker が最新 15 分に不在

### 6.3 Rate limit ヒット時の分岐（重要）

CodeRabbit が rate limit に当たったら、**Phase 5.5 で解決済みの `$PROFILE` を rate-limit 経路にも materialize** して伝播させる (literal `$PROFILE` のまま書くと受け手側で解釈されず、上流 override が失われる):

```text
# テンプレート表記
/pseudo-coderabbit-loop <pr-number> --profile=$PROFILE

# 実際の呼出例 (PROFILE=assertive の場合)
/pseudo-coderabbit-loop 42 --profile=assertive
```

に切替。Codex で疑似レビューを継続しつつ、cooldown (15 分) 経過後に本物 CodeRabbit を再起動。**待機で停滞しない。**

### 6.4 指摘対応ループ

CodeRabbit から指摘が来たら:

```text
Loop:
  1. Review body を parse (Actionable / Nitpick / Outside diff / Duplicate)
  2. Outside diff は PR スコープ外なら拒否コメント + thread resolve
  3. Actionable は全修正、Nitpick は profile 次第
  4. 修正 push → 疑似 CodeRabbit 再実行 → push
  5. 本物 CodeRabbit 再レビュー待機
  6. Clear 判定クリア → Phase 7 へ
```

---

## Phase 7: Codex セカンドオピニオン（CodeRabbit clear 後、必須）

CodeRabbit 通過後に Codex 敵対的レビューを実行:

```text
Agent({
  subagent_type: "harness:codex-sync",
  prompt: "PR #<pr> の全差分を adversarial review。CodeRabbit が見逃した critical を探す"
})
```

Codex が新たな critical を発見したら Phase 5 に戻って修正。approve なら Phase 8 へ。

---

## Phase 8: Merge + 最終確認

1. **全テスト通過**: `pytest` / `npm test` / `cargo test` 等で全テスト実行
2. **エントリポイント同一性**: パイプラインの全入り口が同じフローか確認
3. **型チェック**: `mypy` / `tsc --noEmit` / `rustc` で型エラーなし
4. **lint/format**: `ruff check` / `eslint` / `prettier` で全 pass
5. PR merge (coordinator が実施)
6. worktree cleanup + branch 削除 (該当時)

---

## Phase 9: ドキュメント更新

実装完了後、関連ドキュメントを全て更新:
- `Plans.md` — 完了タスク + 学び（プロジェクトで該当あれば）
- `.docs/` 内の関連ドキュメント
- `.claude/rules/*.md` — 新ルール発見あれば追記
- 運用状態の更新（プロジェクト固有の引き継ぎファイル等）

---

## 品質基準

- **テストカバレッジ**: 新機能は必ずテストを書く
- **Codex レビュー (Phase 5)**: 全観点 OK
- **疑似 CodeRabbit (Phase 5.5)**: `chill` 以上で actionable=0
- **本物 CodeRabbit (Phase 6)**: Clear 3 段判定クリア
- **既存テスト**: 全パス（1 つも壊さない）
- **エントリポイント**: 全て同一フロー
- **ドキュメント**: 最新状態

---

## タスク管理

TaskCreate/TaskUpdate を使い、各タスクの状態を常に最新に保つ:
- `pending` → `in_progress` → `completed`
- 完了したら即 `completed` に更新
- 新しい問題が見つかったら即 TaskCreate
- Phase 5.5 / Phase 6 のループは各反復を 1 タスクとして記録

---

## Codex スタック対策

Codex がスタックした場合:
1. `node .../codex-companion.mjs status` で確認
2. 古いジョブ（10 分以上）をキャンセル
3. 軽量な `--effort medium` で再実行

---

## CodeRabbit 運用メモ（Pro プラン）

| 項目 | 値 |
|---|---|
| PR reviews/hour | 5 件 |
| Files per review | 300 ファイル |
| Rolling bucket | 約 12 分ごとに 1 単位回復 |
| Manual trigger (`@coderabbitai review`) | 同じ bucket を消費する |
| Rate limit marker | `<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->` |
| Reviews paused marker | `<!-- This is an auto-generated comment: review paused by coderabbit.ai -->` |
| Clear signal (最強) | `reviews[-1].state == "APPROVED"` |
| Clear signal (中) | unresolved CodeRabbit threads == 0 |
| `gh pr checks` | 安定しない、依存しない |

---

## worktree 並列開発での運用

1. 各 worktree で **Phase 1-5.5 を独立実行**（並列可）
2. push は Phase 5.5 クリア後の順次（rate limit 回避のため、**1 時間 4 件程度まで**に抑える）
3. 各 PR の Phase 6 は並列監視可（`/coderabbit-review` をそれぞれ起動）
4. rate limit ヒットしたブランチは `/pseudo-coderabbit-loop <pr>` に切替、他ブランチは継続
5. merge 順序は依存関係（共通基盤 → CRUD → UI）で決定

---

## 参照スキル

| スキル | 用途 |
|---|---|
| `/pseudo-coderabbit-loop` | Phase 5.5 の核 / Phase 6 rate-limited 時の代替 |
| `harness:coderabbit-mimic` | `/pseudo-coderabbit-loop` から呼ばれる Codex-based reviewer agent |
| `/coderabbit-review` | Phase 6 の CodeRabbit 監視（Clear 3 段判定 + rate limit 検出） |
| `/codex-team` | Phase 4 / 5 / 6.5 の Codex 呼出 |
| `harness:codex-sync` | 並列 Codex 呼出用 agent |

---

## 本スキルの更新履歴

- **v2 (2026-04-19)**: Phase 5.5（疑似 CodeRabbit レビューループ）追加 + Phase 6（本物 CodeRabbit レビューループ）を明示化 + CodeRabbit rate limit 運用メモ追加 + worktree 並列開発セクション追加。背景: CodeRabbit Pro の 5 PR/hour rate limit で worktree 並列開発がスタックする問題を Codex 疑似 CodeRabbit で解消するため。
- **v1**: TDD + Codex チーム協業の基本ワークフロー。
