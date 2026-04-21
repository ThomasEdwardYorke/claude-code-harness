<!-- generality-exemption: all, PR template references leak patterns it guards against -->
<!--
  Thank you for contributing to claude-code-harness!
  Please fill in all sections below. PR without this template will be held for review.
-->

## 変更概要 / Summary

<!-- 何を変更したか。なぜ必要か。関連 issue があれば #123 でリンク。 -->

## 動機 / Motivation

<!-- この変更がなぜ必要なのか。既存挙動の問題点、追加価値を明記。 -->

## 変更種別 / Type of Change

- [ ] Bug fix (既存機能の修正、挙動変更なし)
- [ ] Feature (新機能、後方互換)
- [ ] Breaking change (既存 config / API に破壊的変更あり — CHANGELOG に明記)
- [ ] Refactor (挙動変更なしの内部整理)
- [ ] Docs (docs/ のみの変更)
- [ ] CI/build (GitHub Actions / build 設定)

---

## Plugin Generality Check (shipped spec を変更した場合は全件確認)

harness plugin は「どのプロジェクトでも install できる汎用拡張」として配布されます。
shipped spec (`plugins/harness/agents/*.md` / `plugins/harness/commands/*.md` / `plugins/harness/core/src/hooks/*.ts`) を変更した場合、**以下 6 項目を全て ✅ にしてから PR を出してください**。

詳細規約: [CONTRIBUTING.md](../CONTRIBUTING.md)

### 1. Blocklist チェック (`generality.test.ts` が自動検出)

- [ ] 特定ブランチ名 (`feature/new-partslist` 等) が含まれていない
- [ ] 前身プロジェクト業務用語 (`upper_script` / `create_script_from_*` / `protected-data/` / `全9ジャンル` / `script_generate`) が含まれていない
- [ ] 内部タスクトラッカー ID (`Phase N 申送` / `Round N` / `A-\d+ r\d+`) が含まれていない
- [ ] project-local ファイル必須参照 (`CLAUDE.local.md` / `next-session-prompt.md`) が含まれていない
- [ ] 特定 web stack (`psycopg` / `defusedxml` / `WeasyPrint` / `openpyxl` / `Y.js` / `Tabulator`) が **必須チェック項目として固定** されていない

### 2. 例示値チェック

- [ ] JSON 例 / コード例の branch 名は generic (`feature/my-feature` / `main` / `<your-branch>`)
- [ ] ディレクトリ例は generic (`src/` / `backend/` / `app/` / `tests/`)
- [ ] プロジェクト名は generic (`my-project` / `your-repo`)

### 3. 言語依存チェック

- [ ] 日本語 UI キーワードが core hooks に hardcode されていない
  (`担当表` → `work.assignmentSectionMarkers` 設定値を参照)
- [ ] 英語圏ユーザーが使えないような日本語専用ロジックなし

### 4. 依存 plugin チェック

- [ ] Codex plugin 依存が optional (`codex.enabled` フラグ分岐あり)
- [ ] Codex 不在時に graceful degrade するコードパスあり

### 5. 設定可能性チェック

- [ ] 新規追加した project-specific な値が `harness.config.json.schema` のフィールドで受けられるか検討した
- [ ] default 値が汎用的で、ほとんどのプロジェクトで動く

### 6. Test / Docs チェック

- [ ] `generality.test.ts` に対応 assertion を追加 (新規 blocklist pattern の場合)
- [ ] `content-integrity.test.ts` の既存 assertion が全件 pass
- [ ] shipped spec に内部 PR 番号 / maintainer 申送 ID が残っていない
- [ ] maintainer 内部資料は `docs/maintainer/` に配置した

---

## テスト計画 / Test Plan

- [ ] `npm test --workspace=plugins/harness/core` が全件 pass
- [ ] `npm run typecheck` が clean
- [ ] `npm run build` が OK
- [ ] `node plugins/harness/bin/harness check` が OK
- [ ] CI (ubuntu / macos / windows) 全 green

## 破壊的変更の通知 / Breaking Change Notice

<!-- Breaking change がある場合、影響範囲 / 移行手順を明記。CHANGELOG.md にも反映。 -->

## Related

<!-- 関連 PR / issue / docs / 事前検証 case study (docs/maintainer/test-bed-usage.md 等) -->

---

<!--
  shipped spec を触らない PR (docs/maintainer/ / CI / tests のみ) の場合、
  Plugin Generality Check の 1-5 は不要です (6 の一部のみ確認)。
-->
