/**
 * index.test.ts
 * Integration tests for the `route()` dispatcher in `index.ts`.
 *
 * The dispatcher connects every hook handler to the public hook-result
 * protocol. Handlers produce a typed result with `additionalContext`, which
 * the dispatcher must translate into the public `reason` field so that
 * Claude Code receives it through the hook output contract.
 *
 * These tests exercise the end-to-end flow per hook type, guarding against
 * regression of the `additionalContext → reason` conversion.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { route } from "../index.js";

function mkTmp(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("route() dispatcher — hook integration", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkTmp("harness-route-test");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("pre-compact", () => {
    it("maps handler.additionalContext into HookResult.reason", async () => {
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        cwd: tmpRoot,
        trigger: "auto",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("=== Harness PreCompact");
      expect(result.reason).toContain("[trigger] auto");
    });

    it("preserves `custom_instructions` at the highest-priority position", async () => {
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        cwd: tmpRoot,
        trigger: "manual",
        custom_instructions: "keep the assignment table verbatim",
      });

      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[custom_instructions]");
      expect(result.reason).toContain("keep the assignment table verbatim");

      // `custom_instructions` must appear BEFORE the `[trigger]` footer so
      // that compaction sees the user's retention instructions first.
      const customIdx = (result.reason ?? "").indexOf("[custom_instructions]");
      const triggerIdx = (result.reason ?? "").indexOf("[trigger]");
      expect(customIdx).toBeGreaterThan(-1);
      expect(triggerIdx).toBeGreaterThan(customIdx);
    });

    it("passes through session_id / cwd extraction from raw input without throwing", async () => {
      // Strings for session_id + cwd plus a non-string trigger should still
      // route cleanly; `extractString()` drops the bad field and the handler
      // falls back to "unknown".
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        session_id: "sess-123",
        cwd: tmpRoot,
        trigger: 42, // non-string — should be ignored by extractString()
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toContain("[trigger] unknown");
    });
  });

  describe("subagent-stop", () => {
    it("non-worker agents: no reason (handler returns no additionalContext)", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "reviewer",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });

    it("worker agent with no detectable stack: maps 'no CI targets' message to reason", async () => {
      // Empty tmp dir has no pyproject.toml / package.json, so
      // detectAvailableChecks() returns [].
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "worker",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("CI チェック対象なし");
    });

    it("plugin-namespaced agent type 'harness:worker' is treated as worker", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "harness:worker",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("CI チェック対象なし");
    });
  });

  describe("task-created", () => {
    it("maps '[TaskCreated]' additionalContext into reason", async () => {
      const result = await route("task-created", {
        hook_event_name: "TaskCreated",
        cwd: tmpRoot,
        task_id: "T42",
        task_subject: "demo task",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCreated]");
      expect(result.reason).toContain("demo task");
    });

    it("falls back to task_id when task_subject is missing", async () => {
      const result = await route("task-created", {
        hook_event_name: "TaskCreated",
        cwd: tmpRoot,
        task_id: "T99",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCreated]");
      expect(result.reason).toContain("T99");
    });
  });

  describe("task-completed", () => {
    it("maps '[TaskCompleted]' additionalContext into reason", async () => {
      const result = await route("task-completed", {
        hook_event_name: "TaskCompleted",
        cwd: tmpRoot,
        task_id: "T42",
        task_subject: "demo task",
        task_status: "completed",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCompleted]");
      expect(result.reason).toContain("demo task");
    });
  });

  describe("stop", () => {
    it("returns approve with no reason when no harness.config.json exists", async () => {
      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });

    it("maps qualityGates reminders into reason when config enables them", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
            enforcePseudoCoderabbit: true,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("品質ゲート");
      expect(result.reason).toContain("TDD 必須");
      expect(result.reason).toContain("疑似 CodeRabbit 必須");
      expect(result.reason).toContain("Codex セカンドオピニオン必須");
      // enforceRealCoderabbit=false → no "本物 CodeRabbit" entry.
      expect(result.reason).not.toContain("本物 CodeRabbit 必須");
    });

    it("returns no reason when qualityGates config is present but all flags are false", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
            enforcePseudoCoderabbit: false,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });
  });

  describe("session lifecycle", () => {
    it("session-start returns approve with no reason", async () => {
      const result = await route("session-start", {});
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });

    it("session-end returns approve with no reason", async () => {
      const result = await route("session-end", {});
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });
  });

  describe("unknown hook type (safety net)", () => {
    it("returns approve with diagnostic reason for unrecognised hookType", async () => {
      // Force-cast through `unknown` because the signature of `route()`
      // intentionally only accepts known HookType values, but the runtime
      // default branch is part of the public contract.
      const result = await route(
        "mystery-hook" as unknown as Parameters<typeof route>[0],
        {},
      );
      expect(result.decision).toBe("approve");
      expect(result.reason).toContain("Unknown hook type");
    });
  });
});
