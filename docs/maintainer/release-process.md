# Release Process

harness plugin の release 手順 + rollback 戦略 + release PR checklist。

**対象**: maintainer のみ。plugin ユーザーは `CHANGELOG.md` / GitHub Releases を参照。

---

## 通常 release フロー

前提: `feature/release-v{NEW_VERSION}` branch が main に merge 済み、CI green、
Codex / CodeRabbit レビュー全件対応済。

1. **annotated tag 作成** (GPG 署名があれば `-s` 付与):
   ```bash
   cd ~/.claude/plugins/marketplaces/claude-code-harness
   git checkout main && git pull --ff-only
   git tag -a v{NEW_VERSION} -m "release: v{NEW_VERSION}"
   ```

2. **単体 tag push** (`--tags` を使わず、意図しない tag の一括 push を防止):
   ```bash
   git push origin v{NEW_VERSION}
   ```

3. **自動 Release 発行** — `.github/workflows/release.yml` が
   `v[0-9]+.[0-9]+.[0-9]+` pattern に trigger し以下を実行:
   - `npm ci` + `npm run build` + `npm test` + `npm run smoke`
   - `node scripts/extract-changelog.mjs v{NEW_VERSION}` で CHANGELOG 当該 section を抽出
   - `softprops/action-gh-release@v2` で GitHub Release 発行 (body = CHANGELOG section、asset = `CHANGELOG.md` / `LICENSE` / `NOTICE`)

4. **検証**:
   ```bash
   gh release view v{NEW_VERSION}
   ```
   Release body に CHANGELOG の Added / Changed / Removed section が展開されていること。

---

## Same-day double release の扱い

複数の minor / patch release を同日に発行する運用は、以下を満たす限り許容:

1. **`CHANGELOG.md` で各 version を独立 section** として記録 (`[X.Y.Z] - YYYY-MM-DD`
   の date が重複してよい、SemVer は date ではなく version 番号で順序が決まる)
2. **`content-integrity.test.ts` の `EXPECTED_RELEASE_DATE` は current release 専用**、
   前 release との date 同一は許容 (Phase μ guard は current のみ検証)
3. **tag push 順序を守る**: 前 release の tag push 完了を確認してから次 release branch
   を main にマージ (Release workflow の順次起動、cache race 回避)
4. **user cache 反映**: 同日に 2 release した場合、user 側で `/plugin marketplace update`
   → `/plugin update harness` → `/reload-plugins` を最新 version 側のみで 1 回実施すれば足りる
   (plugin.json.version が primary cache key のため最新値に到達)

**実例** (2026-04-23):
- v0.2.0 — cache 再生成問題の緊急 fix (CHANGELOG [0.2.0] - 2026-04-23)
- v0.3.0 — WorktreeCreate blocking protocol + .coderabbit.yaml (CHANGELOG [0.3.0] - 2026-04-23、
  v0.2.0 merge 後に feature branch で準備、同日 tag 発行)

**避けるべきケース**:
- 同じ date かつ同じ `[X.Y.Z]` section を複数作ってしまう (SemVer 違反)
- tag push を同時実行 (release.yml の並列起動 → CHANGELOG extract の race は理論上なし
  だが cache UI に複数 "Latest" 表示が出る可能性あり)

---

## Pre-release / RC / backport tag の扱い

> **注**: GitHub Actions の `tags:` は fnmatch (glob) であり、正規表現ではない。
> `v[0-9]+.[0-9]+.[0-9]+` の `.` は厳密には any-character にマッチする (例:
> `v0X2X0` も理論上は trigger 可能)。実用上は悪意のある / 偶発的な誤 tag が
> この形式に合致するリスクは極めて低いため "strict SemVer" と近似表記している。
> 正規表現による厳密 anchor が必要になった場合は release.yml 側に
> `actions/github-script` 等で規制を追加する余地あり。

`release.yml` は **SemVer 形式 (`v[0-9]+.[0-9]+.[0-9]+`) のみ** を自動 trigger
するため、以下のような tag は自動 release されない:

- `v0.2.0-rc.1`
- `v0.2.0-backport`
- `v0.2.0+build.1`

Pre-release を発行する場合は手動実施:

```bash
# tag 作成
git tag -a v0.2.0-rc.1 -m "release candidate"
git push origin v0.2.0-rc.1

# GitHub Release 発行 (prerelease フラグ付き)
gh release create v0.2.0-rc.1 \
  --prerelease \
  --title "v0.2.0-rc.1 — preview" \
  --notes "..."
```

---

## Rollback 手順 (重大 bug 発覚時)

> **warning**: 一度 publish した Release を削除すると、既にインストールしたユーザーの cache には古い version が残る。Rollback は「即座に patch release (v0.2.1) を発行する覚悟がある場合のみ」推奨。

```bash
# 1. local tag 削除
git tag -d v0.2.0

# 2. remote tag 削除 (GitHub 側の tag も消す)
git push origin :refs/tags/v0.2.0

# 3. GitHub Release 削除
gh release delete v0.2.0 --yes

# 4. revert commit + push (必要に応じて)
git revert <release-commit-sha>
git push origin main

# 5. v0.2.1 を速やかに発行 (必要に応じて)
#    通常 release フローに戻る
```

**利用者側の cache 対処** (plugin cache に古い version が残っている場合):
- `/plugin uninstall harness@claude-code-harness`
- `/plugin install harness@claude-code-harness`
- それでも解消しない場合: `rm -rf ~/.claude/plugins/cache/claude-code-harness/` (最終手段、公式 docs には明記なし)

---

## Release PR Checklist

PR マージ前に以下を確認:

### バージョン整合性 (Phase μ test が自動検証)
- [ ] `plugins/harness/.claude-plugin/plugin.json` の `version` = NEW_VERSION
- [ ] `.claude-plugin/marketplace.json` の `metadata.version` + `plugins[0].version` = NEW_VERSION
- [ ] `package.json` (root) + `plugins/harness/core/package.json` の `version` = NEW_VERSION
- [ ] `content-integrity.test.ts` Phase μ の `EXPECTED_VERSION` / `EXPECTED_PREV_VERSION` / `EXPECTED_RELEASE_DATE` 更新済

### CHANGELOG (Phase μ test が自動検証)
- [ ] `## [Unreleased]` header は残す (空でよい)
- [ ] `## [{NEW_VERSION}] - YYYY-MM-DD` entry に移行済
- [ ] Breaking change あれば `## [{NEW_VERSION}]` header 直後に `> **⚠️ Breaking change**: ...` blockquote を配置
- [ ] 比較 link `[Unreleased]: .../compare/v{NEW}...HEAD` に rewrite 済
- [ ] `[{NEW_VERSION}]: .../compare/v{PREV}...v{NEW}` link 追加済
- [ ] `[{PREV_VERSION}]: .../releases/tag/v{PREV}` link 残存確認

### docs 整合性
- [ ] `docs/maintainer/test-bed-usage.md` の `(unreleased)` マーカーを NEW_VERSION (YYYY-MM-DD) に更新
- [ ] `README.md` に "planned for v{X}" 等の未達 commitment が残っていない (約束した feature は実装する or 次 release に shift 改定)
- [ ] `docs/maintainer/english-migration.md` の cutoff version が最新 (未達なら次 release に shift)
- [ ] `docs/en/installation.md` / `docs/ja/installation.md` の version 記述を version-agnostic に保つ

### CI / build
- [ ] feature branch で CI green (ci.yml / build.yml / smoke.yml)
- [ ] `npm run typecheck` / `npm run build` / `npm test` / `npm run smoke` 全 pass
- [ ] pseudo-CodeRabbit actionable=0 (`/pseudo-coderabbit-loop --local`)
- [ ] 本物 CodeRabbit clean (`/coderabbit-review <pr>` で APPROVED or unresolved=0 + no rate-limit marker)
- [ ] Codex セカンドオピニオン approve (`/codex-team`)

### Release 発行前 dry-run
```bash
# CHANGELOG section 抽出の事前確認
node scripts/extract-changelog.mjs v{NEW_VERSION}
# 期待: stdout に `## [NEW_VERSION] - YYYY-MM-DD` から次の ## 見出しの直前まで
```

---

## References

- Keep a Changelog 1.1.0: <https://keepachangelog.com/en/1.1.0/>
- SemVer 2.0.0: <https://semver.org/spec/v2.0.0.html>
- Claude Code plugin reference: <https://code.claude.com/docs/en/plugins-reference>
- softprops/action-gh-release@v2: <https://github.com/softprops/action-gh-release>
