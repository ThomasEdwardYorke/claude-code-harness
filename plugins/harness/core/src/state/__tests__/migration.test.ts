/**
 * migration.test.ts
 * Unit tests for the legacy v2 → v3 migration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate, defaultStatePath } from "../migration.js";
import { HarnessStore } from "../store.js";

function createTmpProject(): string {
  const dir = join(
    tmpdir(),
    `harness-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".claude", "state"), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe("migrate()", () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(() => {
    projectRoot = createTmpProject();
    statePath = defaultStatePath(projectRoot);
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  describe("idempotency", () => {
    it("second run reports skipped: true", () => {
      const first = migrate(projectRoot, statePath);
      expect(first.skipped).toBe(false);

      const second = migrate(projectRoot, statePath);
      expect(second.skipped).toBe(true);
      expect(second.sessions).toBe(0);
    });
  });

  describe("session.json → sessions", () => {
    it("imports a single session file", () => {
      writeFileSync(
        join(projectRoot, ".claude", "state", "session.json"),
        JSON.stringify({
          session_id: "sess-legacy",
          mode: "work",
          project_root: projectRoot,
          started_at: "2026-01-01T00:00:00Z",
        }),
      );
      const result = migrate(projectRoot, statePath);
      expect(result.sessions).toBe(1);
      expect(result.errors).toEqual([]);

      const store = new HarnessStore(statePath);
      const s = store.getSession("sess-legacy");
      expect(s?.mode).toBe("work");
      store.close();
    });

    it("tolerates an unknown mode by falling back to `normal`", () => {
      writeFileSync(
        join(projectRoot, ".claude", "state", "session.json"),
        JSON.stringify({
          session_id: "sess-weird",
          mode: "unknown-future-mode",
          project_root: projectRoot,
          started_at: "2026-01-01T00:00:00Z",
        }),
      );
      migrate(projectRoot, statePath);
      const store = new HarnessStore(statePath);
      expect(store.getSession("sess-weird")?.mode).toBe("normal");
      store.close();
    });
  });

  describe("session.events.jsonl → signals", () => {
    it("imports JSONL events as signals", () => {
      writeFileSync(
        join(projectRoot, ".claude", "state", "session.events.jsonl"),
        [
          JSON.stringify({
            type: "task_completed",
            from_session_id: "sess-A",
            to_session_id: "sess-B",
            payload: { ok: true },
          }),
          JSON.stringify({
            event: "task_failed", // legacy field name
            session_id: "sess-A",
            data: { reason: "flaky" },
          }),
        ].join("\n"),
      );
      const result = migrate(projectRoot, statePath);
      expect(result.signals).toBe(2);
    });
  });

  describe("work-active.json → work_states", () => {
    it("imports a work-active file", () => {
      writeFileSync(
        join(projectRoot, ".claude", "work-active.json"),
        JSON.stringify({
          session_id: "sess-work",
          codex_mode: true,
          bypass_rm_rf: false,
          mode: "work",
        }),
      );
      const result = migrate(projectRoot, statePath);
      expect(result.workStates).toBe(1);

      const store = new HarnessStore(statePath);
      const w = store.getWorkState("sess-work");
      expect(w?.codexMode).toBe(true);
      store.close();
    });
  });

  describe("missing source files", () => {
    it("leaves the result empty when nothing is present", () => {
      const result = migrate(projectRoot, statePath);
      expect(result.sessions).toBe(0);
      expect(result.signals).toBe(0);
      expect(result.workStates).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe("defaultStatePath", () => {
    it("points at .claude/state/harness.json (OS native path separator)", () => {
      // defaultStatePath は `path.join` を使い OS native separator を返すため、
      // Windows では `D:\tmp\proj\.claude\state\harness.json` になる。
      // test 側も `path.join` で期待値を組み立てて OS 非依存に。
      expect(defaultStatePath("/tmp/proj")).toBe(
        join("/tmp/proj", ".claude", "state", "harness.json"),
      );
    });
  });
});
