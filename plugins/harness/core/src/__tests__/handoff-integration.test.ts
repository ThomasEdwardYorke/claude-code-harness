/**
 * core/src/__tests__/handoff-integration.test.ts
 *
 * Integration coverage that wires `loadConfig` (4-layer config surface)
 * together with `parseBacklog` (dispatchable view parser) to verify the
 * end-to-end flow `/harness-work` will follow when a project opts into
 * handoff mode. The legacy Plans.md mode is also exercised here so that
 * the backward-compatibility contract has automated coverage rather
 * than only living in skill markdown.
 *
 * No skill / hook code is invoked; the goal is to assert that the two
 * primitives line up so a downstream dispatcher can chain them safely.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "../config.js";
import { parseBacklog, type BacklogEntry } from "../work/backlog-parser.js";

function mkTmp(): string {
  const dir = join(
    tmpdir(),
    `harness-handoff-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(projectRoot: string, relPath: string, content: string): void {
  const segments = relPath.split("/");
  const fileName = segments.pop() as string;
  const dir = join(projectRoot, ...segments);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content);
}

/** Minimal end-to-end harness that mirrors what `/harness-work` Step 0 does:
 * read taskTrackerMode, then dispatch on the appropriate task source. */
function pickDispatchSource(projectRoot: string): {
  mode: "plans" | "handoff";
  entries: BacklogEntry[];
  plansPath: string | undefined;
  backlogPath: string | undefined;
} {
  const cfg = loadConfig(projectRoot);
  if (cfg.work.taskTrackerMode === "handoff" && cfg.work.handoffPaths) {
    const backlogPath = join(projectRoot, cfg.work.handoffPaths.backlog);
    return {
      mode: "handoff",
      entries: parseBacklog(backlogPath),
      plansPath: undefined,
      backlogPath,
    };
  }
  return {
    mode: "plans",
    entries: [],
    plansPath: join(projectRoot, cfg.work.plansFile),
    backlogPath: undefined,
  };
}

describe("4-layer handoff integration", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkTmp();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  describe("Plans.md mode (legacy default — backward compatibility)", () => {
    it("with no harness.config.json, defaults to plans mode and points at Plans.md", () => {
      // The plain happy-path: a project that has not opted into the
      // 4-layer structure must continue to use Plans.md without any
      // diff in dispatch behaviour.
      const result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("plans");
      expect(result.entries).toEqual([]);
      expect(result.plansPath).toBe(join(projectRoot, "Plans.md"));
      expect(result.backlogPath).toBeUndefined();
    });

    it("with explicit taskTrackerMode='plans', stays in plans mode", () => {
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({ work: { taskTrackerMode: "plans" } }),
      );
      const result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("plans");
      expect(result.plansPath).toBe(join(projectRoot, "Plans.md"));
    });

    it("plans mode: custom plansFile value is honoured", () => {
      // Some projects use Tasks.md or another filename; the custom path
      // must flow through to the dispatch-source picker.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: { plansFile: "Tasks.md" },
        }),
      );
      const result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("plans");
      expect(result.plansPath).toBe(join(projectRoot, "Tasks.md"));
    });
  });

  describe("Handoff mode (opt-in)", () => {
    it("with taskTrackerMode='handoff' + valid handoffPaths, picks handoff mode", () => {
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: ".docs/handoff/my-project-roadmap.md",
              backlog: ".docs/handoff/my-project-backlog.md",
              current: ".docs/handoff/my-project-current.md",
              decisions: ".docs/handoff/my-project-design-decisions.md",
            },
          },
        }),
      );
      writeFile(
        projectRoot,
        ".docs/handoff/my-project-backlog.md",
        [
          "# Backlog — my-project",
          "",
          "### [Critical] entry-alpha Add login screen",
          "",
          "```yaml",
          "id: entry-alpha",
          "priority: Critical",
          "status: pending",
          "roadmap_ref: phase-1.week-1",
          "```",
          "",
          "### [High] entry-bravo Add session token issuer",
          "",
          "```yaml",
          "id: entry-bravo",
          "priority: High",
          "status: in_progress",
          "worktree: ../my-project-wt-session",
          "```",
          "",
          "### [Med] entry-charlie Documentation polish",
          "",
        ].join("\n"),
      );
      const result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("handoff");
      expect(result.plansPath).toBeUndefined();
      expect(result.backlogPath).toBe(
        join(projectRoot, ".docs/handoff/my-project-backlog.md"),
      );
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0]).toMatchObject({
        id: "entry-alpha",
        priority: "Critical",
        status: "pending",
        roadmapRef: "phase-1.week-1",
      });
      expect(result.entries[1]).toMatchObject({
        id: "entry-bravo",
        priority: "High",
        status: "in_progress",
        worktree: "../my-project-wt-session",
      });
      expect(result.entries[2]).toMatchObject({
        id: "entry-charlie",
        priority: "Med",
        status: "pending", // heading-only default
      });
    });

    it("dispatcher selects only pending entries (status filter)", () => {
      // The end-to-end flow needs to filter by status before priority
      // ordering — already-shipped or in-review entries should not be
      // re-dispatched.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: "r.md",
              backlog: "b.md",
              current: "c.md",
              decisions: "d.md",
            },
          },
        }),
      );
      writeFile(
        projectRoot,
        "b.md",
        [
          "### [Critical] entry-alpha Already shipped",
          "",
          "```yaml",
          "status: done",
          "```",
          "",
          "### [Critical] entry-bravo In review",
          "",
          "```yaml",
          "status: review",
          "```",
          "",
          "### [High] entry-charlie Currently being worked",
          "",
          "```yaml",
          "status: in_progress",
          "```",
          "",
          "### [Med] entry-delta Pending pickup",
          "",
        ].join("\n"),
      );
      const { entries } = pickDispatchSource(projectRoot);
      const pending = entries.filter((e) => e.status === "pending");
      expect(pending.map((e) => e.id)).toEqual(["entry-delta"]);
    });

    it("missing backlog file in handoff mode yields zero entries (no throw)", () => {
      // Initial-state scenario: the project opted into handoff mode but
      // has not authored backlog.md yet. The dispatcher should report
      // "no pending work" rather than crashing.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: "r.md",
              backlog: "b.md",
              current: "c.md",
              decisions: "d.md",
            },
          },
        }),
      );
      // Note: b.md intentionally not written.
      const result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("handoff");
      expect(result.entries).toEqual([]);
    });

    it("malformed handoffPaths silently downgrades to plans mode", () => {
      // The fall-back path is what protects existing users from a
      // half-typed handoff config. The dispatcher must still get a
      // usable plans-mode source instead of crashing.
      const originalWrite = process.stderr.write.bind(process.stderr);
      const stderrCaptured: string[] = [];
      (process.stderr.write as unknown as (chunk: string) => boolean) = (
        chunk: string,
      ) => {
        stderrCaptured.push(chunk);
        return true;
      };
      try {
        writeFile(
          projectRoot,
          "harness.config.json",
          JSON.stringify({
            work: {
              taskTrackerMode: "handoff",
              handoffPaths: {
                roadmap: "r.md",
                // backlog / current / decisions intentionally missing
              },
            },
          }),
        );
        const result = pickDispatchSource(projectRoot);
        expect(result.mode).toBe("plans");
        expect(result.plansPath).toBe(join(projectRoot, "Plans.md"));
        // The loader should have warned the author.
        expect(stderrCaptured.join("")).toContain("handoffPaths");
      } finally {
        (process.stderr.write as unknown as typeof originalWrite) =
          originalWrite;
      }
    });

    it("handoff mode preserves work.qualityGates defaults from DEFAULT_CONFIG", () => {
      // Sanity check that opting in to handoff mode does not erase the
      // surrounding quality-gate defaults consumed by stop.ts.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: "r.md",
              backlog: "b.md",
              current: "c.md",
              decisions: "d.md",
            },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.taskTrackerMode).toBe("handoff");
      expect(cfg.work.qualityGates).toEqual(
        DEFAULT_CONFIG.work.qualityGates,
      );
      expect(cfg.work.failFast).toBe(DEFAULT_CONFIG.work.failFast);
    });
  });

  describe("Migration scenario — Plans.md and handoff/ co-existing (S-16)", () => {
    it("when both layouts exist, dispatcher follows whichever taskTrackerMode says", () => {
      // S-16 (info) flag in session-handoff check is purely informational —
      // the dispatcher does not branch on file co-existence; it follows
      // the explicit configuration. This protects an author mid-migration:
      // if `taskTrackerMode = "plans"` they keep using Plans.md even with
      // partial handoff/ files lying around.
      writeFile(projectRoot, "Plans.md", "# Plans\n\n- task A\n");
      writeFile(
        projectRoot,
        ".docs/handoff/my-project-backlog.md",
        "### [High] entry-alpha New handoff entry\n",
      );

      // Author has not flipped the mode yet → stays on plans path.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({ work: { taskTrackerMode: "plans" } }),
      );
      let result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("plans");
      expect(result.plansPath).toBe(join(projectRoot, "Plans.md"));

      // Author flips the mode → handoff path is used.
      writeFile(
        projectRoot,
        "harness.config.json",
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: ".docs/handoff/my-project-roadmap.md",
              backlog: ".docs/handoff/my-project-backlog.md",
              current: ".docs/handoff/my-project-current.md",
              decisions: ".docs/handoff/my-project-design-decisions.md",
            },
          },
        }),
      );
      result = pickDispatchSource(projectRoot);
      expect(result.mode).toBe("handoff");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({ id: "entry-alpha" });
    });
  });
});
