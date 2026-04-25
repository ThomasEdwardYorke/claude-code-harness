/**
 * core/src/work/__tests__/backlog-parser.test.ts
 *
 * Unit tests for the 4-layer handoff backlog parser. The parser reads a
 * Markdown file whose entries follow the harness backlog grammar:
 *
 *   ### [Critical|High|Med|Low] <id> <title>
 *   ```yaml
 *   id: ...
 *   priority: ...
 *   status: ...
 *   roadmap_ref: ...
 *   worktree: ...
 *   pr: ...
 *   ```
 *
 * Heading values are defaults; YAML overrides them when present. Lines
 * outside a heading-anchored entry are ignored.
 *
 * TDD discipline: each test writes the file via writeFileSync into a
 * tmp dir, calls parseBacklog(), and asserts on the returned array.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseBacklog } from "../backlog-parser.js";

function mkTmp(): string {
  const dir = join(
    tmpdir(),
    `harness-backlog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBacklog(projectRoot: string, content: string): string {
  const path = join(projectRoot, "backlog.md");
  writeFileSync(path, content);
  return path;
}

/**
 * Capture lines written to `process.stderr.write` during the supplied
 * callback. Mirrors the helper used in config.test.ts so this file is
 * self-contained.
 */
function withCapturedStderr(run: (stderrWrites: string[]) => void): void {
  const stderrWrites: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr.write as unknown as (chunk: string) => boolean) = (
    chunk: string,
  ) => {
    stderrWrites.push(chunk);
    return true;
  };
  try {
    run(stderrWrites);
  } finally {
    (process.stderr.write as unknown as typeof originalWrite) = originalWrite;
  }
}

describe("parseBacklog", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkTmp();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  describe("file-existence guards", () => {
    it("returns [] for a missing file (no throw)", () => {
      // Missing files are a benign state — the handoff backlog may not
      // exist yet for a freshly-initialised project. The parser must
      // not throw; it simply reports zero entries.
      const path = join(projectRoot, "does-not-exist.md");
      expect(parseBacklog(path)).toEqual([]);
    });

    it("returns [] for an empty file", () => {
      const path = writeBacklog(projectRoot, "");
      expect(parseBacklog(path)).toEqual([]);
    });

    it("returns [] for a whitespace-only file", () => {
      const path = writeBacklog(projectRoot, "\n\n   \n\t\n");
      expect(parseBacklog(path)).toEqual([]);
    });

    it("returns [] when the file has no level-3 headings", () => {
      // Lines outside a heading-anchored entry are ignored — including
      // top-level prose, level-1 / level-2 / level-4 headings, code
      // blocks not associated with a heading, and stray lists.
      const path = writeBacklog(
        projectRoot,
        [
          "# Top-level title",
          "",
          "Some prose explaining the layout.",
          "",
          "## A subsection",
          "",
          "- bullet 1",
          "- bullet 2",
          "",
          "#### A level-4 heading we ignore",
          "",
          "```",
          "Code that is not under any level-3 heading.",
          "```",
          "",
        ].join("\n"),
      );
      expect(parseBacklog(path)).toEqual([]);
    });
  });

  describe("heading-only entries", () => {
    it("parses a heading without YAML, defaulting status to 'pending'", () => {
      const path = writeBacklog(
        projectRoot,
        "### [High] T-001 Add login screen\n",
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: "T-001",
        priority: "High",
        title: "Add login screen",
        status: "pending",
      });
      // Optional fields are absent on heading-only entries.
      expect(entries[0]?.roadmapRef).toBeUndefined();
      expect(entries[0]?.worktree).toBeUndefined();
      expect(entries[0]?.pr).toBeUndefined();
      expect(entries[0]?.lineNumber).toBe(1);
      expect(entries[0]?.rawHeading).toContain("[High]");
    });

    it("parses each of the four priority labels", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [Critical] T-001 First",
          "",
          "### [High] T-002 Second",
          "",
          "### [Med] T-003 Third",
          "",
          "### [Low] T-004 Fourth",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.priority)).toEqual([
        "Critical",
        "High",
        "Med",
        "Low",
      ]);
      expect(entries.map((e) => e.id)).toEqual([
        "T-001",
        "T-002",
        "T-003",
        "T-004",
      ]);
    });

    it("preserves entry order from the file (file-order semantics)", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [Low] T-300 Last in file",
          "",
          "### [Critical] T-100 First in file",
          "",
          "### [Med] T-200 Middle",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      // No re-ordering by priority — file-order is the contract so the
      // dispatcher can apply its own ordering policy without losing the
      // author's intent.
      expect(entries.map((e) => e.id)).toEqual(["T-300", "T-100", "T-200"]);
    });

    it("accepts ids with hyphens, dots, and digits", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Hyphen id",
          "",
          "### [High] phase-1.task-2 Mixed dot+hyphen",
          "",
          "### [High] MYPROJ-001 Uppercase prefix",
          "",
          "### [High] 2026.04.25 Numeric date-style id",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.id)).toEqual([
        "T-001",
        "phase-1.task-2",
        "MYPROJ-001",
        "2026.04.25",
      ]);
    });

    it("accepts a heading whose title contains spaces, punctuation, and unicode", () => {
      const path = writeBacklog(
        projectRoot,
        "### [High] T-001 日本語タイトル — with em-dash and (parens)\n",
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.title).toBe(
        "日本語タイトル — with em-dash and (parens)",
      );
    });

    it("ignores headings that do not match the backlog grammar", () => {
      // The grammar requires `### [Priority] <id> <title>` exactly.
      // Headings that almost-match (wrong priority, missing brackets,
      // out-of-spec depth) must be skipped silently — they belong to
      // the surrounding doc, not the backlog dispatch list.
      const path = writeBacklog(
        projectRoot,
        [
          "### [Urgent] T-001 Wrong priority",
          "",
          "### T-002 Missing brackets",
          "",
          "## [High] T-003 Wrong heading level",
          "",
          "### [High] T-004 Valid entry",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe("T-004");
    });
  });

  describe("YAML metadata blocks", () => {
    it("parses an entry with a YAML block immediately following the heading", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Add login screen",
          "",
          "```yaml",
          "id: T-001",
          "priority: High",
          "status: in_progress",
          "roadmap_ref: phase-1.week-2",
          "worktree: ../my-app-wt-login",
          "pr: '#42'",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: "T-001",
        priority: "High",
        status: "in_progress",
        title: "Add login screen",
        roadmapRef: "phase-1.week-2",
        worktree: "../my-app-wt-login",
        pr: "#42",
      });
    });

    it("YAML overrides heading defaults when both are present", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [Low] T-001 Heading title",
          "",
          "```yaml",
          "id: T-001-override",
          "priority: Critical",
          "status: review",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      // YAML keys win over heading-derived defaults.
      expect(entries[0]?.id).toBe("T-001-override");
      expect(entries[0]?.priority).toBe("Critical");
      expect(entries[0]?.status).toBe("review");
      // Title still comes from the heading (no `title` YAML key spec'd).
      expect(entries[0]?.title).toBe("Heading title");
    });

    it("falls back to heading-only when YAML body is malformed", () => {
      // Hand-rolled YAML parser: malformed input (missing colon, etc.)
      // is logged to stderr and the entry retains its heading defaults
      // — never hard-fails the whole file.
      withCapturedStderr((stderrWrites) => {
        const path = writeBacklog(
          projectRoot,
          [
            "### [High] T-001 Heading title",
            "",
            "```yaml",
            "this is not valid yaml: it has",
            "  no proper structure",
            "  also has a tab\there",
            "  : leading colon weird",
            "```",
            "",
          ].join("\n"),
        );
        const entries = parseBacklog(path);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.id).toBe("T-001");
        expect(entries[0]?.priority).toBe("High");
        // Status still defaults to pending because nothing parsed cleanly.
        expect(entries[0]?.status).toBe("pending");
        // A diagnostic must be emitted so authors notice the issue.
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("backlog");
      });
    });

    it("ignores YAML keys outside the documented set", () => {
      // Forward-compat: unknown keys do not crash but also do not leak
      // into the BacklogEntry shape.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Title",
          "",
          "```yaml",
          "id: T-001",
          "priority: High",
          "future_field: ignored",
          "anothere_unknown: also-ignored",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: "T-001",
        priority: "High",
      });
      const keys = Object.keys(entries[0] ?? {});
      expect(keys).not.toContain("future_field");
      expect(keys).not.toContain("anothere_unknown");
    });

    it("rejects status values outside the enum, falls back to 'pending'", () => {
      withCapturedStderr((stderrWrites) => {
        const path = writeBacklog(
          projectRoot,
          [
            "### [High] T-001 Title",
            "",
            "```yaml",
            "id: T-001",
            "priority: High",
            "status: shipping-soon",
            "```",
            "",
          ].join("\n"),
        );
        const entries = parseBacklog(path);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.status).toBe("pending");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("status");
      });
    });

    it("rejects priority values outside the enum, falls back to heading", () => {
      withCapturedStderr((stderrWrites) => {
        const path = writeBacklog(
          projectRoot,
          [
            "### [High] T-001 Title",
            "",
            "```yaml",
            "id: T-001",
            "priority: Urgent",
            "```",
            "",
          ].join("\n"),
        );
        const entries = parseBacklog(path);
        expect(entries).toHaveLength(1);
        // Falls back to the heading-derived priority rather than dropping.
        expect(entries[0]?.priority).toBe("High");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("priority");
      });
    });

    it("strips surrounding quotes from quoted string values", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Title",
          "",
          "```yaml",
          'id: "T-001"',
          "priority: 'High'",
          'roadmap_ref: "phase-1"',
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe("T-001");
      expect(entries[0]?.priority).toBe("High");
      expect(entries[0]?.roadmapRef).toBe("phase-1");
    });

    it("ignores YAML blocks not in a fenced code block (heading + bare key:value below)", () => {
      // The grammar requires the YAML block to be fenced. Bare key:value
      // text under the heading is treated as prose and ignored — the
      // entry retains heading-only defaults.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Title",
          "",
          "id: T-001",
          "status: in_progress",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe("T-001");
      expect(entries[0]?.status).toBe("pending");
    });

    it("only consumes the YAML block immediately following the heading", () => {
      // Bare prose between the heading and the fenced block disqualifies
      // it — the YAML must be the next non-blank construct after the
      // heading, otherwise it belongs to the next entry's prose.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Title",
          "",
          "Some prose paragraph that intervenes.",
          "",
          "```yaml",
          "id: T-001",
          "status: in_progress",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      // The YAML block was not consumed — entry is heading-only.
      expect(entries[0]?.status).toBe("pending");
    });

    it("matches non-yaml fence info-strings as raw blocks (not YAML)", () => {
      // A fenced block tagged ```ts / ```bash / no language is NOT YAML
      // and must be left alone.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Title",
          "",
          "```ts",
          "id: T-001",
          "status: in_progress",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      // No YAML applied — heading defaults retained.
      expect(entries[0]?.status).toBe("pending");
    });

    it("recovers from an unclosed YAML fence by stopping at the next heading", () => {
      // Edge case caught by adversarial review: an unterminated ```yaml
      // fence must not silently swallow every following entry until EOF.
      // The parser walks forward to the next entry heading and treats the
      // fence as unclosed (warn + partial body parse), then resumes from
      // the heading so subsequent entries are still dispatched.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Unclosed fence entry",
          "",
          "```yaml",
          "priority: Critical",
          "status: in_progress",
          "",
          "### [High] T-002 Recovered next entry",
          "",
          "```yaml",
          "status: review",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      // Both entries must be present — recovery worked.
      expect(entries).toHaveLength(2);
      expect(entries[0]?.id).toBe("T-001");
      // Partial YAML body was parsed before recovery: priority + status
      // applied to the first entry from the unclosed block.
      expect(entries[0]?.priority).toBe("Critical");
      expect(entries[0]?.status).toBe("in_progress");
      // Second entry's own YAML block was parsed independently.
      expect(entries[1]?.id).toBe("T-002");
      expect(entries[1]?.status).toBe("review");
    });

    it("recovers from an unclosed YAML fence at end of file", () => {
      // Same recovery, simpler shape: fence opens at end of file with no
      // closing fence and no following heading. Parser should consume the
      // remaining lines as YAML body, warn, and return the single entry.
      const path = writeBacklog(
        projectRoot,
        [
          "### [High] T-001 Last entry, unclosed fence",
          "",
          "```yaml",
          "status: in_progress",
          "priority: Critical",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe("T-001");
      // Partial body parsed despite missing closing fence.
      expect(entries[0]?.status).toBe("in_progress");
      expect(entries[0]?.priority).toBe("Critical");
    });
  });

  describe("mixed file (multiple entries with mixed YAML)", () => {
    it("parses a 3-entry file mixing heading-only and YAML entries", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "# Project Backlog",
          "",
          "Some prose.",
          "",
          "### [Critical] T-001 First with full YAML",
          "",
          "```yaml",
          "id: T-001",
          "priority: Critical",
          "status: in_progress",
          "roadmap_ref: phase-1.week-1",
          "worktree: ../proj-wt-1",
          "pr: '#10'",
          "```",
          "",
          "### [High] T-002 Second heading-only",
          "",
          "### [Med] T-003 Third with partial YAML",
          "",
          "```yaml",
          "status: review",
          "roadmap_ref: phase-1.week-2",
          "```",
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries).toHaveLength(3);

      // Entry 0: full YAML.
      expect(entries[0]).toMatchObject({
        id: "T-001",
        priority: "Critical",
        status: "in_progress",
        title: "First with full YAML",
        roadmapRef: "phase-1.week-1",
        worktree: "../proj-wt-1",
        pr: "#10",
      });

      // Entry 1: heading-only.
      expect(entries[1]).toMatchObject({
        id: "T-002",
        priority: "High",
        status: "pending",
        title: "Second heading-only",
      });
      expect(entries[1]?.roadmapRef).toBeUndefined();
      expect(entries[1]?.worktree).toBeUndefined();
      expect(entries[1]?.pr).toBeUndefined();

      // Entry 2: partial YAML inheriting heading defaults for priority/id/title.
      expect(entries[2]).toMatchObject({
        id: "T-003",
        priority: "Med",
        status: "review",
        title: "Third with partial YAML",
        roadmapRef: "phase-1.week-2",
      });
    });
  });

  describe("duplicate ids", () => {
    it("warns about duplicate ids and returns both entries", () => {
      // A duplicate is most likely an authoring mistake (or a recent
      // copy/paste). Returning both entries lets the dispatcher decide
      // how to surface the conflict; the warning gives the human a
      // breadcrumb to investigate.
      withCapturedStderr((stderrWrites) => {
        const path = writeBacklog(
          projectRoot,
          [
            "### [High] T-001 First instance",
            "",
            "### [High] T-001 Second instance",
            "",
          ].join("\n"),
        );
        const entries = parseBacklog(path);
        expect(entries).toHaveLength(2);
        const ids = entries.map((e) => e.id);
        expect(ids).toEqual(["T-001", "T-001"]);
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("T-001");
        expect(warnings).toContain("duplicate");
      });
    });
  });

  describe("line-number reporting", () => {
    it("records the heading line number (1-indexed)", () => {
      const path = writeBacklog(
        projectRoot,
        [
          "# Title",
          "",
          "Prose.",
          "",
          "### [High] T-001 First", // line 5
          "",
          "### [High] T-002 Second", // line 7
          "",
        ].join("\n"),
      );
      const entries = parseBacklog(path);
      expect(entries.map((e) => e.lineNumber)).toEqual([5, 7]);
    });
  });
});
