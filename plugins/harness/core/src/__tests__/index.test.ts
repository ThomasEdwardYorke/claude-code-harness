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
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { route, errorToResult } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

    it("returns no reason when every qualityGate is explicitly disabled", async () => {
      // All four gates explicitly false — loadConfigSafe merges user values
      // over defaults, so setting the full set here is required to produce
      // an empty reminder list (unlike the earlier impl that read raw JSON
      // and counted missing keys as false).
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
            enforcePseudoCoderabbit: false,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: false,
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

    it("partial qualityGates override keeps default-enabled gates in the reminder (mergeConfig semantics)", async () => {
      // Flip enforceTddImplement to false; other three default to true.
      // Previously stop.ts read raw JSON and treated unset gates as false,
      // which silently disabled the three real defaults. The hook now
      // routes through loadConfigSafe() so default-true gates stay enabled
      // under partial user overrides.
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
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

      expect(result.reason).toBeDefined();
      expect(result.reason).not.toContain("TDD 必須");
      expect(result.reason).toContain("疑似 CodeRabbit 必須");
      expect(result.reason).toContain("本物 CodeRabbit 必須");
      expect(result.reason).toContain("Codex セカンドオピニオン必須");
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

  describe("worktree-remove (non-blocking observability)", () => {
    it("maps handler.additionalContext into HookResult.reason", async () => {
      const result = await route("worktree-remove", {
        hook_event_name: "WorktreeRemove",
        cwd: tmpRoot,
        worktree_path: "/tmp/sample-wt/slug",
      });
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("WorktreeRemove");
      expect(result.reason).toContain("/tmp/sample-wt/slug");
    });

    it("passes through agent_type / agent_id extraction from raw input", async () => {
      const result = await route("worktree-remove", {
        hook_event_name: "WorktreeRemove",
        cwd: tmpRoot,
        worktree_path: "/tmp/sample-wt/slug",
        agent_type: "harness:worker",
        agent_id: "agent-xyz123",
      });
      expect(result.reason).toContain("harness:worker");
      expect(result.reason).toContain("agent-xyz123");
    });
  });

  describe("worktree-create (blocking protocol)", () => {
    // production 実装: `git worktree add` を実行し worktreePath を返す。
    // tmpRoot は git repo ではないので handler は失敗を fail-open で返し
    // (decision=approve, worktreePath=undefined)、main() が exit 1 に変換する
    // (blocking semantics)。
    //
    // 実 git worktree add 経由の成功ケースは worktree-lifecycle.test.ts で
    // カバーされる。本テストは route() dispatcher が worktreePath を
    // HookResult 経由で適切に伝搬することの guard。
    it("tmpRoot (非 git) では fail-open: decision=approve, worktreePath=undefined", async () => {
      const result = await route("worktree-create", {
        hook_event_name: "WorktreeCreate",
        cwd: tmpRoot,
        name: "not-git-slug",
      });
      expect(result.decision).toBe("approve");
      // 失敗時は worktreePath 未設定 (index.ts main() で exit 1)
      expect(result.worktreePath).toBeUndefined();
      // reason に失敗理由 (git / worktree / not a ... のいずれかの文字列) を含む
      expect(result.reason ?? "").toMatch(/git|worktree|not a|name/i);
    });

    it("route() は handler の worktreePath を HookResult に伝搬する (blocking 成功経路)", async () => {
      // 成功経路の検証: tmpRoot を git init して initial commit を置く。
      // `-b main` は git >= 2.28 のみ対応のため、古い runner では `git init`
      // + `git branch -M main` に fallback する (try/catch で段階的 trial)。
      try {
        execFileSync("git", ["init", "-b", "main"], {
          cwd: tmpRoot,
          stdio: "pipe",
        });
      } catch {
        execFileSync("git", ["init"], { cwd: tmpRoot, stdio: "pipe" });
      }
      execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "user.name", "harness-test"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "commit.gpgsign", "false"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      writeFileSync(join(tmpRoot, "README.md"), "test\n", "utf-8");
      execFileSync("git", ["add", "README.md"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });

      const result = await route("worktree-create", {
        hook_event_name: "WorktreeCreate",
        cwd: tmpRoot,
        name: "route-slug",
      });
      expect(result.decision).toBe("approve");
      expect(result.worktreePath).toBeDefined();
      // isAbsolute で OS 中立判定 (Windows 互換)。
      expect(isAbsolute(result.worktreePath!)).toBe(true);

      // 後始末: 作成された worktree を除去 (tempDirs cleanup で broken worktree 扱いを防止)。
      // shell injection 排除のため execFileSync + args array を使う。
      try {
        execFileSync(
          "git",
          ["worktree", "remove", result.worktreePath!, "--force"],
          { cwd: tmpRoot, stdio: "pipe" },
        );
      } catch {
        // ignore — afterEach が tmpRoot 自体を rm する
      }
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

describe("errorToResult() — fail-safe contract", () => {
  // Guards the fail-open path that main() uses when route() or any
  // handler throws. A regression here would let an exception crash the
  // hook runner, which would in turn stall Claude Code sessions.

  it("returns decision=approve for any Error thrown by a handler", () => {
    const result = errorToResult(new Error("boom"));
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Core engine error (safe fallback)");
    expect(result.reason).toContain("boom");
  });

  it("stringifies non-Error throws (string / number / object) safely", () => {
    expect(errorToResult("string-throw").reason).toContain("string-throw");
    expect(errorToResult(42).reason).toContain("42");
    expect(errorToResult({ complex: "object" }).reason).toContain("[object Object]");
  });

  it("includes the class name of Error subclasses via their message", () => {
    class MyCustomError extends Error {
      constructor() {
        super("my custom message");
        this.name = "MyCustomError";
      }
    }
    const result = errorToResult(new MyCustomError());
    expect(result.reason).toContain("my custom message");
  });

  it("never returns a decision other than 'approve' (fail-open guarantee)", () => {
    // Simulate a variety of throwable shapes to confirm the invariant.
    const cases: unknown[] = [
      new Error(""),
      "",
      0,
      false,
      null,
      undefined,
      Symbol("x"),
    ];
    for (const err of cases) {
      const result = errorToResult(err);
      expect(result.decision).toBe("approve");
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });
});

describe("main() entrypoint fail-open (e2e child-process contract)", () => {
  // Exercise the real main() by spawning the built entrypoint as a child
  // process. This is the only way to cover the full readStdin -> parse
  // -> route -> JSON.stringify pipeline that shipped hook dispatchers
  // actually invoke; `route()` unit tests bypass all of that.
  const distPath = resolve(__dirname, "../../dist/index.js");
  const distExists = existsSync(distPath);
  const buildSkipReason = distExists
    ? null
    : "dist/index.js not built; skip e2e test (covered by CI `npm run build` step)";

  it.skipIf(!distExists)(
    "malformed stdin returns a JSON fallback (decision=approve) instead of crashing",
    () => {
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: "{not valid json}",
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBeTruthy();
      const parsed: unknown = JSON.parse(result.stdout.trim());
      expect(parsed).toMatchObject({ decision: "approve" });
      // Reason content is an internal detail, but it must be non-empty
      // and surface the failure class ("Core engine error").
      expect((parsed as { reason: string }).reason).toContain(
        "Core engine error",
      );
    },
  );

  it.skipIf(!distExists)(
    "valid stdin for an unknown hook type returns the 'Unknown hook type' diagnostic fallback",
    () => {
      // The dispatcher routes non-session hook types through `parseInput()`,
      // which requires `tool_name`. Provide a minimally valid hook input so
      // we exercise route()'s default branch rather than the parseInput
      // throw path.
      const result = spawnSync(
        process.execPath,
        [distPath, "never-registered"],
        {
          input: JSON.stringify({ tool_name: "Bash", tool_input: {} }),
          encoding: "utf-8",
          timeout: 5_000,
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as {
        decision: string;
        reason: string;
      };
      expect(parsed.decision).toBe("approve");
      expect(parsed.reason).toContain("Unknown hook type");
    },
  );

  it.skipIf(!distExists)(
    "session-start accepts empty stdin and returns a bare approve",
    () => {
      const result = spawnSync(process.execPath, [distPath, "session-start"], {
        input: "",
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as {
        decision: string;
      };
      expect(parsed.decision).toBe("approve");
    },
  );

  it.skipIf(!distExists)(
    "worktree-create: 成功時 stdout に raw absolute path、NOT JSON、exit 0",
    () => {
      // 公式仕様 (code.claude.com/docs/en/hooks):
      //   Command hook は worktreePath を raw stdout に書き出す (JSON ではなく生パス)
      //   exit 0 = 成功、worktree 作成成功
      // main() は worktree-create の HookResult.worktreePath を JSON 化せず
      // そのまま stdout に出す分岐を持つ必要がある。
      const gitRepo = mkTmp("harness-wtc-e2e");
      try {
        // git init -b main with fallback (git < 2.28 compatibility)
        try {
          execFileSync("git", ["init", "-b", "main"], {
            cwd: gitRepo,
            stdio: "pipe",
          });
        } catch {
          execFileSync("git", ["init"], { cwd: gitRepo, stdio: "pipe" });
        }
        execFileSync("git", ["config", "user.email", "e2e@example.com"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["config", "user.name", "e2e"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["config", "commit.gpgsign", "false"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        writeFileSync(join(gitRepo, "hello.txt"), "hi\n", "utf-8");
        execFileSync("git", ["add", "hello.txt"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["commit", "-m", "init"], {
          cwd: gitRepo,
          stdio: "pipe",
        });

        const result = spawnSync(
          process.execPath,
          [distPath, "worktree-create"],
          {
            input: JSON.stringify({
              hook_event_name: "WorktreeCreate",
              cwd: gitRepo,
              name: "e2e-slug",
            }),
            encoding: "utf-8",
            timeout: 15_000,
          },
        );
        expect(result.status).toBe(0);
        const stdout = result.stdout.trim();
        // Raw absolute path であり JSON ではない (isAbsolute で OS 中立判定)。
        expect(isAbsolute(stdout)).toBe(true);
        expect(stdout).not.toMatch(/^\{/);
        expect(existsSync(stdout)).toBe(true);

        // 生成 worktree の cleanup (shell injection 排除のため execFileSync + args array)
        try {
          execFileSync("git", ["worktree", "remove", stdout, "--force"], {
            cwd: gitRepo,
            stdio: "pipe",
          });
        } catch {
          // ignore
        }
      } finally {
        rmSync(gitRepo, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "worktree-create: 失敗時 exit 非 0 (blocking protocol — 公式: any non-zero exit causes creation to fail)",
    () => {
      // non-git dir → handler は worktreePath を返せない
      // → main() は exit 1 で blocking 失敗を通知
      const nonGit = mkTmp("harness-wtc-nogit-e2e");
      try {
        const result = spawnSync(
          process.execPath,
          [distPath, "worktree-create"],
          {
            input: JSON.stringify({
              hook_event_name: "WorktreeCreate",
              cwd: nonGit,
              name: "e2e-fail",
            }),
            encoding: "utf-8",
            timeout: 5_000,
          },
        );
        expect(result.status).not.toBe(0);
      } finally {
        rmSync(nonGit, { recursive: true, force: true });
      }
    },
  );

  if (buildSkipReason !== null) {
    // One marker test always runs so the reader of `vitest --reporter=verbose`
    // sees why the e2e suite is empty in local / dev runs.
    it("dist/index.js presence check", () => {
      // When this test passes with `distExists === false`, the actual
      // end-to-end tests above are skipped. Build once with `npm run build`
      // (or let CI do it) to see them.
      expect(buildSkipReason).toContain("not built");
    });
  }
});
