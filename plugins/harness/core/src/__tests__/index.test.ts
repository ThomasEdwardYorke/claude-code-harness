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

import {
  route,
  errorToResult,
  sanitizeSafeFallbackReason,
  MAX_SAFE_FALLBACK_REASON_CHARS,
} from "../index.js";

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

  describe("subagent-start", () => {
    it("default config → additionalContext に SubagentStart diagnostic が入る (NOT reason)", async () => {
      // SubagentStart は modern hook: hookSpecificOutput.additionalContext を使う
      // (subagent-stop は legacy pattern で reason にマップされる)。
      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("SubagentStart");
      expect(result.additionalContext).toContain("agent_type=harness:worker");
      // block 非対応 → reason は undefined (decision block 時のみ populate)
      expect(result.reason).toBeUndefined();
    });

    it("enabled: false → additionalContext undefined、reason も undefined", async () => {
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify({ subagentStart: { enabled: false } }),
      );

      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("agentTypeNotes match → additionalContext に note 含む", async () => {
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify({
          subagentStart: {
            agentTypeNotes: {
              "harness:worker": "TDD first (red → green → refactor).",
            },
          },
        }),
      );

      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toContain(
        "TDD first (red → green → refactor).",
      );
    });

    it("非 string 入力 (agent_type = 42 等) も crash せず undefined 扱いで処理", async () => {
      // extractString() は non-string を drop → handler 側で "unknown" に fallback
      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: 42, // non-string — should be dropped by extractString
        agent_id: null, // non-string — should be dropped by extractString
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toContain("agent_type=unknown");
      expect(result.additionalContext).toContain("agent_id=unknown");
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

describe("main() safe-fallback diagnostic surfacing (Issue #3)", () => {
  // Guards against silent-exception serialization in the hookSpecificOutput
  // branch (user-prompt-submit / post-tool-use-failure / config-change /
  // subagent-start). Before the fix, a thrown handler + errorToResult() →
  // `decision: "approve"` produced an empty `{}` on stdout because the
  // reason string was only serialized under the `decision === "block"` path.
  // Critical diagnostics were hidden from the developer.
  //
  // Post-fix invariants (per Anthropic Claude Code hook spec,
  // https://code.claude.com/docs/en/hooks):
  //   1. exit code 0 (fail-open — the action must still proceed)
  //   2. stderr receives the reason (debug log + transcript first-line notice)
  //   3. stdout JSON carries `systemMessage` with the reason
  //      (top-level universal field — shown to user + delivered to Claude
  //       as context on the next conversation turn, per the spec)
  //   4. stdout JSON is NOT literally `{}`
  //
  // These tests intentionally spawn the built `dist/index.js` via child
  // process so the full readStdin → parse → route → serialize pipeline is
  // exercised end-to-end.
  const distPath = resolve(__dirname, "../../dist/index.js");
  const distExists = existsSync(distPath);

  // Malformed stdin forces `parseSessionInput()` → `JSON.parse()` to throw,
  // which is caught by main()'s catch block and routed through errorToResult().
  // This is the canonical way to exercise the fail-safe path from a child
  // process without monkey-patching imports.
  const MALFORMED_JSON = "{not valid json}";

  const MODERN_HOOK_TYPES = [
    "user-prompt-submit",
    "post-tool-use-failure",
    "config-change",
    "subagent-start",
  ] as const;

  for (const hookType of MODERN_HOOK_TYPES) {
    it.skipIf(!distExists)(
      `${hookType}: core engine error surfaces via stderr + systemMessage (no silent {} drop)`,
      () => {
        const result = spawnSync(process.execPath, [distPath, hookType], {
          input: MALFORMED_JSON,
          encoding: "utf-8",
          timeout: 5_000,
        });

        // 1. fail-open preserved — action proceeds
        expect(result.status).toBe(0);

        // 2. stderr carries the diagnostic (goes to debug log; non-zero exit
        //    would put first line in transcript — exit 0 + stderr is the
        //    Anthropic-recommended "keep stdout clean for JSON" pattern for
        //    fail-open surfaces)
        expect(result.stderr).toContain("Core engine error");

        // 3. stdout JSON is a non-empty object with systemMessage populated
        //    (NOT the pre-fix silent `{}`)
        const stdoutTrim = result.stdout.trim();
        expect(stdoutTrim).not.toBe("{}");
        const parsed = JSON.parse(stdoutTrim) as Record<string, unknown>;
        expect(typeof parsed["systemMessage"]).toBe("string");
        expect(parsed["systemMessage"] as string).toContain(
          "Core engine error",
        );
      },
    );
  }

  it.skipIf(!distExists)(
    "classic branch (pre-tool) regression: existing behaviour preserved — reason remains on stdout JSON",
    () => {
      // The classic output branch already includes reason via JSON.stringify(result).
      // The new safe-fallback stderr write must be additive, not disruptive.
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: MALFORMED_JSON,
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      expect(parsed["decision"]).toBe("approve");
      expect(parsed["reason"]).toContain("Core engine error");
      // Classic branch ALSO gets the new stderr surfacing for consistency.
      expect(result.stderr).toContain("Core engine error");
    },
  );

  it.skipIf(!distExists)(
    "safe-fallback reason sanitised: ANSI escape sequences + DEL + NUL stripped out of stderr / systemMessage",
    () => {
      // Claude Code hooks spec notes that `systemMessage` is delivered to
      // Claude as context on the next conversation turn — so a hostile or
      // accidentally noisy reason (ANSI colour codes, terminal-clear
      // escapes, raw NUL bytes) must be neutralised before it is surfaced
      // to the user OR to Claude. We stuff an embedded escape sequence +
      // NUL + DEL into stdin; `parseSessionInput` throws a SyntaxError
      // whose .message is echoed back into reason, but the sanitiser at
      // the boundary strips the bytes.
      //
      // Construct stdin with a literal escape (\x1B = ESC, 0x07 = BEL,
      // 0x00 = NUL, 0x7F = DEL). Node's JSON.parse will throw on the
      // binary bytes; the resulting error message from V8 incorporates
      // them into its diagnostic.
      const hostile = "\x1B[31m\x07\x00\x7F{";
      const result = spawnSync(
        process.execPath,
        [distPath, "user-prompt-submit"],
        {
          input: hostile,
          encoding: "utf-8",
          timeout: 5_000,
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      const systemMessage = parsed["systemMessage"] as string | undefined;
      expect(systemMessage).toBeDefined();
      // Neither stderr nor systemMessage may contain raw C0 / C1 / DEL
      // bytes. ESC (0x1B) / BEL (0x07) / NUL (0x00) / DEL (0x7F) must be
      // replaced with the safe placeholder `?`.
      expect(systemMessage!).not.toMatch(/[\x00\x07\x1B\x7F]/);
      expect(result.stderr).not.toMatch(/[\x00\x07\x1B\x7F]/);
      // But human-readable whitespace (LF / TAB) is preserved if present,
      // because stack traces need newlines to be readable. We assert that
      // the sanitiser did not clobber every byte — the diagnostic prefix
      // ("Core engine error") must remain.
      expect(systemMessage!).toContain("Core engine error");
    },
  );

  it.skipIf(!distExists)(
    "safe-fallback reason truncated when very long: systemMessage stays bounded to avoid context-window pressure",
    () => {
      // Unit-level guarantee: sanitizeSafeFallbackReason enforces the cap.
      // We exercise the in-process helper directly because constructing
      // a > 2000-char error message from malformed JSON is brittle across
      // Node versions.
      const huge = "x".repeat(MAX_SAFE_FALLBACK_REASON_CHARS + 500);
      const sanitised = sanitizeSafeFallbackReason(huge);
      expect(sanitised.length).toBeLessThanOrEqual(
        MAX_SAFE_FALLBACK_REASON_CHARS + "…[truncated]".length,
      );
      expect(sanitised).toContain("…[truncated]");
      // Short inputs must pass through unchanged (no false truncation).
      const short = "small diagnostic";
      expect(sanitizeSafeFallbackReason(short)).toBe(short);
    },
  );

  it("sanitizeSafeFallbackReason preserves human-readable whitespace (TAB / LF / CR)", () => {
    // Stack-trace style multi-line content must remain readable after
    // sanitisation. TAB / LF / CR are non-hostile formatting chars.
    const multiline = "line 1\n\tindented\r\nline 2";
    expect(sanitizeSafeFallbackReason(multiline)).toBe(multiline);
  });

  it("sanitizeSafeFallbackReason strips C1 control bytes (0x80-0x9F)", () => {
    // C1 controls are produced by 8-bit ANSI variants. Must be stripped
    // even though they are above 0x7F.
    const withC1 = "foo\x9Bbar\x9Fbaz";
    const sanitised = sanitizeSafeFallbackReason(withC1);
    expect(sanitised).toBe("foo?bar?baz");
  });

  it("sanitizeSafeFallbackReason truncates at Unicode code-point boundaries (no orphan surrogate)", () => {
    // Construct an input where a supplementary-plane char (😀 = U+1F600,
    // 2 UTF-16 code units) straddles the truncation cap. A naive
    // `stripped.slice(0, MAX)` would leave a lone high surrogate (\uD83D)
    // at the end — technically valid UTF-16 but invalid Unicode scalar
    // and rendered as garbage.
    //
    // Padding of exactly (MAX - 1) `x` followed by an emoji places the
    // emoji's high surrogate at index MAX - 1 and the low surrogate at
    // index MAX. `slice(0, MAX)` would therefore include the high
    // surrogate and drop the low one; the code-point-aware truncator
    // must drop the emoji entirely (keeping only the padding).
    const pad = "x".repeat(MAX_SAFE_FALLBACK_REASON_CHARS - 1);
    const withEmojiAtBoundary = pad + "😀" + "trailing";
    const sanitised = sanitizeSafeFallbackReason(withEmojiAtBoundary);

    // Must round-trip through JSON without producing invalid escapes.
    expect(() => JSON.parse(JSON.stringify(sanitised))).not.toThrow();
    // Must NOT end with a lone high surrogate (U+D800-U+DBFF).
    const lastChar = sanitised.slice(-"…[truncated]".length - 1).charCodeAt(0);
    expect(lastChar < 0xd800 || lastChar > 0xdbff).toBe(true);
    // The truncation marker must be present.
    expect(sanitised.endsWith("…[truncated]")).toBe(true);
  });

  it("sanitizeSafeFallbackReason preserves multi-byte content below the cap", () => {
    // Japanese / emoji input well under the cap must pass through
    // unmodified (no false truncation, no surrogate corruption).
    const mixed = "エラー: 😀 stack trace\n  at foo (a.ts:1:1)";
    expect(sanitizeSafeFallbackReason(mixed)).toBe(mixed);
  });

  it.skipIf(!distExists)(
    "handler-throws path (not JSON.parse) also routes through errorToResult + safe-fallback surfacing",
    () => {
      // Previously we only covered the stdin-JSON-parse exception path.
      // This test exercises the case where the handler itself throws
      // (e.g., a dynamic-import failure on a malformed hook). We trigger
      // this by feeding a session-hook-shaped JSON that lacks fields the
      // handler expects, then monkey-observes that the safe-fallback path
      // is still invoked end-to-end.
      //
      // Reality check: the modern handlers are defensive (they accept
      // unknown / missing fields gracefully), so a "pure" handler throw
      // is hard to force from stdin alone without monkey-patching. We
      // therefore use a different route: feed a hook type that ISN'T
      // recognised as a "session-shaped" hook (so it falls through to
      // the parseInput() branch) AND is on the modern list. Because
      // parseInput() requires `tool_name`, passing a minimal object
      // WITHOUT tool_name forces parseInput to throw — which is caught
      // by main() and routed through errorToResult. This is semantically
      // equivalent to a handler throw for our purposes: exception caught
      // by the outer try/catch → safeFallbackUsed=true → surfaced to
      // stderr + systemMessage.
      //
      // Note: we pick "pre-tool" here deliberately — for modern session
      // hooks, parseSessionInput does NOT require tool_name, so we can't
      // trigger the same failure mode. Classic-branch coverage is
      // sufficient to assert the contract, and the previous malformed-JSON
      // test already confirms the modern branch.
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: JSON.stringify({ no_tool_name_field: true }),
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      // parseInput throws ("Invalid hook input: missing required field
      // 'tool_name'"), which lands in errorToResult → safeFallback surface.
      expect(result.stderr).toContain("Core engine error");
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      // Classic branch: reason is on the top-level JSON.
      expect(parsed["reason"]).toContain("Invalid hook input");
    },
  );

  it.skipIf(!distExists)(
    "modern hook happy path: no safe-fallback → no systemMessage injection (no regression on normal flows)",
    () => {
      // Normal invocation of subagent-start with valid input returns
      // additionalContext via hookSpecificOutput. systemMessage must NOT
      // be injected on the happy path — the lift is strictly safe-fallback
      // gated to avoid polluting every subagent spawn with a bogus warning.
      const tmpRootHappy = mkTmp("harness-happy-path");
      try {
        const result = spawnSync(
          process.execPath,
          [distPath, "subagent-start"],
          {
            input: JSON.stringify({
              hook_event_name: "SubagentStart",
              cwd: tmpRootHappy,
              agent_type: "harness:worker",
              agent_id: "agent-happy",
            }),
            encoding: "utf-8",
            timeout: 5_000,
          },
        );
        expect(result.status).toBe(0);
        // No stderr on happy path (no diagnostic to surface).
        expect(result.stderr).toBe("");
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        // Happy path must NOT carry systemMessage (that would leak a false
        // warning to the user on every subagent spawn).
        expect(parsed["systemMessage"]).toBeUndefined();
        // Existing invariant: hookSpecificOutput with additionalContext.
        expect(parsed["hookSpecificOutput"]).toBeDefined();
        const hso = parsed["hookSpecificOutput"] as Record<string, unknown>;
        expect(hso["hookEventName"]).toBe("SubagentStart");
        expect(hso["additionalContext"]).toBeDefined();
      } finally {
        rmSync(tmpRootHappy, { recursive: true, force: true });
      }
    },
  );
});
