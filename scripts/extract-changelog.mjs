#!/usr/bin/env node
/**
 * extract-changelog.mjs
 *
 * CHANGELOG.md から指定した version の section を抽出して stdout に出力する。
 * `.github/workflows/release.yml` の Release body 供給に使う。
 *
 * Usage:
 *   node scripts/extract-changelog.mjs v0.2.0     # v prefix あり (release.yml 互換)
 *   node scripts/extract-changelog.mjs 0.2.0      # v prefix なし
 *
 * Exit codes:
 *   0 — 抽出成功、stdout に markdown section
 *   1 — 指定 version の section が CHANGELOG に存在しない
 *   2 — 引数不正 (missing / malformed)
 *
 * 抽出範囲:
 *   `## [X.Y.Z] - ...` 見出し行から、次の `## [` 見出しの直前まで。
 *   末尾の version 比較 link ブロック (`[Unreleased]: ...` 等) は含まれない。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, "..", "CHANGELOG.md");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: extract-changelog.mjs <version>");
  console.error("Examples:");
  console.error("  extract-changelog.mjs v0.2.0");
  console.error("  extract-changelog.mjs 0.2.0");
  process.exit(2);
}

const version = arg.replace(/^v/, "");
// release.yml の tag pattern `v[0-9]+.[0-9]+.[0-9]+` と整合させる。
// Pre-release (`-rc.1`) / build metadata (`+build.1`) は release.yml が trigger しないため
// このスクリプトでも受け付けない。手動 release (`gh release create v0.2.0-rc.1`) は
// このスクリプト経由ではなく --notes 直接指定を使う (docs/maintainer/release-process.md 参照)。
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `Version "${version}" is not a canonical SemVer X.Y.Z (pre-release / build metadata is not accepted)`,
  );
  process.exit(2);
}

// Local dry-run で plugin repo 外から実行した場合などに ENOENT が出るため、
// Node.js の default error ("ENOENT: no such file or directory, open ...") より
// 親切なメッセージを出力する (CodeRabbit nitpick 対応)。
// ENOENT 以外 (EACCES / EISDIR 等) は意図しない IO 障害なので原エラーを再 throw。
let raw;
try {
  raw = readFileSync(changelogPath, "utf-8");
} catch (err) {
  if (err && err.code === "ENOENT") {
    console.error(`CHANGELOG.md not found at: ${changelogPath}`);
    console.error(
      `Hint: run this script from the plugin repository root, or ensure CHANGELOG.md exists at the expected path.`,
    );
    process.exit(1);
  }
  throw err;
}

// ## [X.Y.Z] ... 見出しを literal 検索し、次の ## [ 見出しまでを切り出す
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startPattern = new RegExp(`^## \\[${escaped}\\][^\\n]*$`, "m");
const startMatch = startPattern.exec(raw);
if (!startMatch) {
  console.error(`No CHANGELOG section found for version: ${version}`);
  process.exit(1);
}

const startIdx = startMatch.index;
const afterHeader = raw.slice(startIdx + startMatch[0].length);
const nextHeaderMatch = /^## \[/m.exec(afterHeader);
const endIdx = nextHeaderMatch
  ? startIdx + startMatch[0].length + nextHeaderMatch.index
  : raw.length;

// trimEnd() で抽出範囲末尾の trailing blank lines (次 header 直前の空行など) を除去、
// 最後の改行 1 個だけを付与した状態で stdout に出力する。
// GitHub Release body として展開される時の視認性 (末尾に余計な空行を残さない) 優先。
const section = raw.slice(startIdx, endIdx).trimEnd();
process.stdout.write(section + "\n");
