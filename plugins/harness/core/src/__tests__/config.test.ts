/**
 * config.test.ts
 * Unit tests for harness.config.json loader.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadConfigSafe,
} from "../config.js";

function mkTmp(): string {
  const dir = join(
    tmpdir(),
    `harness-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig / loadConfigSafe", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkTmp();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns defaults when no file exists", () => {
    expect(loadConfig(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("merges user values over defaults (scalar fields)", () => {
    writeFileSync(
      join(projectRoot, "harness.config.json"),
      JSON.stringify({
        projectName: "my-app",
        language: "ja",
        protectedDirectories: ["training-data"],
      }),
    );
    const cfg = loadConfig(projectRoot);
    expect(cfg.projectName).toBe("my-app");
    expect(cfg.language).toBe("ja");
    expect(cfg.protectedDirectories).toEqual(["training-data"]);
    // Fields the user didn't touch still come from DEFAULT_CONFIG.
    expect(cfg.protectedEnvVarNames).toEqual(DEFAULT_CONFIG.protectedEnvVarNames);
  });

  it("deep-merges nested objects (workMode, codex, tampering)", () => {
    writeFileSync(
      join(projectRoot, "harness.config.json"),
      JSON.stringify({
        workMode: { bypassRmRf: true },
        tampering: { severity: "deny" },
      }),
    );
    const cfg = loadConfig(projectRoot);
    expect(cfg.workMode.bypassRmRf).toBe(true);
    // bypassGitPush still inherits the default.
    expect(cfg.workMode.bypassGitPush).toBe(false);
    expect(cfg.tampering.severity).toBe("deny");
  });

  it("loadConfig throws on malformed JSON", () => {
    writeFileSync(join(projectRoot, "harness.config.json"), "{not-json}");
    expect(() => loadConfig(projectRoot)).toThrow();
  });

  it("loadConfigSafe returns defaults on malformed JSON", () => {
    writeFileSync(join(projectRoot, "harness.config.json"), "{not-json}");
    expect(loadConfigSafe(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("loadConfigSafe returns defaults when file is missing", () => {
    expect(loadConfigSafe(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("default config is safe: R10 / R11 / R13 all no-op or minimal", () => {
    expect(DEFAULT_CONFIG.protectedDirectories).toEqual([]);
    expect(DEFAULT_CONFIG.protectedFileSuffixes).toEqual([".env"]);
    // The default env-var name list is non-empty but only contains globally
    // known secret names, so it is safe to enable for any project.
    expect(DEFAULT_CONFIG.protectedEnvVarNames.length).toBeGreaterThan(0);
  });

  describe("schema-aligned sections (work expansion / worktree / tddEnforce / codeRabbit)", () => {
    it("work default surfaces the full expanded shape", () => {
      expect(DEFAULT_CONFIG.work.plansFile).toBe("Plans.md");
      expect(DEFAULT_CONFIG.work.maxParallel).toBe(4);
      expect(DEFAULT_CONFIG.work.labelPriority).toEqual([]);
      expect(DEFAULT_CONFIG.work.criticalLabels).toEqual([]);
      expect(DEFAULT_CONFIG.work.failFast).toBe(true);
      expect(DEFAULT_CONFIG.work.qualityGates).toEqual({
        enforceTddImplement: true,
        enforcePseudoCoderabbit: true,
        enforceRealCoderabbit: true,
        enforceCodexSecondOpinion: true,
      });
      // testCommand / changeLogFile remain optional-undefined.
      expect(DEFAULT_CONFIG.work.testCommand).toBeUndefined();
      expect(DEFAULT_CONFIG.work.changeLogFile).toBeUndefined();
    });

    it("worktree default matches schema default (enabled=\"auto\", maxParallel=4, parentDir=\"..\")", () => {
      expect(DEFAULT_CONFIG.worktree.enabled).toBe("auto");
      expect(DEFAULT_CONFIG.worktree.maxParallel).toBe(4);
      expect(DEFAULT_CONFIG.worktree.parentDir).toBe("..");
      expect(DEFAULT_CONFIG.worktree.prefix).toBeUndefined();
      expect(DEFAULT_CONFIG.worktree.defaultBaseBranch).toBeUndefined();
    });

    it("tddEnforce default matches schema default (chill profile, 3 retries)", () => {
      expect(DEFAULT_CONFIG.tddEnforce.alwaysRequireRedTest).toBe(true);
      expect(DEFAULT_CONFIG.tddEnforce.allowSkipOnDocsTasks).toBe(true);
      expect(DEFAULT_CONFIG.tddEnforce.pseudoCoderabbitProfile).toBe("chill");
      expect(DEFAULT_CONFIG.tddEnforce.maxCodexReviewRetries).toBe(3);
    });

    it("codeRabbit default matches schema (15-minute ratelimit, Pro bucket 5/60)", () => {
      expect(DEFAULT_CONFIG.codeRabbit.botLogin).toBe("coderabbitai");
      expect(DEFAULT_CONFIG.codeRabbit.ratelimitCheckWindowMinutes).toBe(15);
      expect(DEFAULT_CONFIG.codeRabbit.approvedStateAsClear).toBe(true);
      expect(DEFAULT_CONFIG.codeRabbit.maxPseudoLoopIterations).toBe(5);
      expect(DEFAULT_CONFIG.codeRabbit.proBucketSize).toBe(5);
      expect(DEFAULT_CONFIG.codeRabbit.proBucketWindowMinutes).toBe(60);
    });

    it("loadConfig deep-merges worktree and preserves default parentDir when user only overrides maxParallel", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          worktree: { maxParallel: 8 },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.worktree.maxParallel).toBe(8);
      expect(cfg.worktree.enabled).toBe("auto"); // unchanged
      expect(cfg.worktree.parentDir).toBe(".."); // unchanged
    });

    it("loadConfig deep-merges tddEnforce for profile overrides", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          tddEnforce: { pseudoCoderabbitProfile: "strict" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.tddEnforce.pseudoCoderabbitProfile).toBe("strict");
      expect(cfg.tddEnforce.alwaysRequireRedTest).toBe(true); // unchanged
      expect(cfg.tddEnforce.maxCodexReviewRetries).toBe(3); // unchanged
    });

    it("loadConfig deep-merges codeRabbit for botLogin / ratelimit overrides", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          codeRabbit: {
            botLogin: "my-custom-rabbit-bot",
            ratelimitCheckWindowMinutes: 30,
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.codeRabbit.botLogin).toBe("my-custom-rabbit-bot");
      expect(cfg.codeRabbit.ratelimitCheckWindowMinutes).toBe(30);
      // Other fields still come from defaults.
      expect(cfg.codeRabbit.proBucketSize).toBe(5);
      expect(cfg.codeRabbit.proBucketWindowMinutes).toBe(60);
      expect(cfg.codeRabbit.approvedStateAsClear).toBe(true);
    });

    it("loadConfig deep-merges work.qualityGates without clobbering other gates", () => {
      // Flip only enforceRealCoderabbit to false; other three must stay true.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: {
            qualityGates: { enforceRealCoderabbit: false },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.qualityGates.enforceRealCoderabbit).toBe(false);
      expect(cfg.work.qualityGates.enforceTddImplement).toBe(true);
      expect(cfg.work.qualityGates.enforcePseudoCoderabbit).toBe(true);
      expect(cfg.work.qualityGates.enforceCodexSecondOpinion).toBe(true);
    });

    it("loadConfig deep-merges work level fields without losing qualityGates defaults", () => {
      // Overriding maxParallel at the work level must not erase the
      // default qualityGates nested object.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: { maxParallel: 2 },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.maxParallel).toBe(2);
      expect(cfg.work.qualityGates).toEqual({
        enforceTddImplement: true,
        enforcePseudoCoderabbit: true,
        enforceRealCoderabbit: true,
        enforceCodexSecondOpinion: true,
      });
    });

    it("arrays inside work (labelPriority / criticalLabels) are replaced wholesale by user overrides", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: {
            labelPriority: ["security", "data"],
            criticalLabels: ["security"],
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.labelPriority).toEqual(["security", "data"]);
      expect(cfg.work.criticalLabels).toEqual(["security"]);
    });

    it("security.enabledChecks partial override is wholesale — baseline checks drop out", () => {
      // Safety-critical documented caveat: if a user adds one check, they
      // lose the four baseline checks unless they re-list them. The test
      // ensures this behavior is covered so that if a future change flips
      // to deep-merge, the test catches the silent semantics change.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          security: {
            enabledChecks: ["api-key-leak", "project-specific"],
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.security.enabledChecks).toEqual([
        "api-key-leak",
        "project-specific",
      ]);
      // Baseline checks NOT kept (documented wholesale-replace semantics).
      expect(cfg.security.enabledChecks).not.toContain("injection");
      expect(cfg.security.enabledChecks).not.toContain("file-permissions");
      expect(cfg.security.enabledChecks).not.toContain("dependencies");
    });
  });

  describe("runtime enum validation (pseudoCoderabbitProfile / release.strategy)", () => {
    let stderrWrites: string[];
    let originalWrite: typeof process.stderr.write;

    beforeEach(() => {
      stderrWrites = [];
      originalWrite = process.stderr.write.bind(process.stderr);
      // Capture stderr for warning assertions. vitest doesn't patch stderr
      // by default, so we swap the write implementation directly.
      (process.stderr.write as unknown as (chunk: string) => boolean) = (
        chunk: string,
      ) => {
        stderrWrites.push(chunk);
        return true;
      };
    });

    afterEach(() => {
      (process.stderr.write as unknown as typeof originalWrite) = originalWrite;
    });

    it("loadConfig falls back to default pseudoCoderabbitProfile and warns on a non-enum value", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          tddEnforce: { pseudoCoderabbitProfile: "strict1" }, // typo
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.tddEnforce.pseudoCoderabbitProfile).toBe("chill"); // default
      const warnings = stderrWrites.join("");
      expect(warnings).toContain("tddEnforce.pseudoCoderabbitProfile");
      expect(warnings).toContain("strict1");
      expect(warnings).toContain("chill");
    });

    it("loadConfig falls back to default release.strategy and warns on a non-enum value", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          release: { strategy: "single-branch" }, // not in union
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.release.strategy).toBe("three-branch"); // default
      const warnings = stderrWrites.join("");
      expect(warnings).toContain("release.strategy");
      expect(warnings).toContain("single-branch");
      expect(warnings).toContain("three-branch");
    });

    it("valid enum values pass through without warning", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          tddEnforce: { pseudoCoderabbitProfile: "assertive" },
          release: { strategy: "two-branch" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.tddEnforce.pseudoCoderabbitProfile).toBe("assertive");
      expect(cfg.release.strategy).toBe("two-branch");
      expect(stderrWrites.join("")).toBe("");
    });
  });

  describe("Phase δ sections (tooling / release)", () => {
    it("tooling default is stack-neutral ['src', 'app'] — backend/ is opt-in via override", () => {
      expect(DEFAULT_CONFIG.tooling.pythonCandidateDirs).toEqual(["src", "app"]);
      // Sanity check: backend/ is NOT in the default (plugin ships stack-neutral).
      expect(DEFAULT_CONFIG.tooling.pythonCandidateDirs).not.toContain("backend");
    });

    it("loadConfig tooling override replaces pythonCandidateDirs wholesale", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          tooling: { pythonCandidateDirs: ["backend", "api"] },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.tooling.pythonCandidateDirs).toEqual(["backend", "api"]);
    });

    it("release default is three-branch (feature → dev → main)", () => {
      expect(DEFAULT_CONFIG.release.strategy).toBe("three-branch");
      expect(DEFAULT_CONFIG.release.integrationBranch).toBe("dev");
      expect(DEFAULT_CONFIG.release.productionBranch).toBe("main");
      expect(DEFAULT_CONFIG.release.testCommand).toBeUndefined();
    });

    it("loadConfig release override supports two-branch trunk-style projects", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          release: {
            strategy: "two-branch",
            productionBranch: "trunk",
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.release.strategy).toBe("two-branch");
      expect(cfg.release.productionBranch).toBe("trunk");
      // Unchanged fields keep defaults.
      expect(cfg.release.integrationBranch).toBe("dev");
    });

    it("loadConfig release.testCommand override is preserved for /harness-release", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          release: { testCommand: "pytest -q && npm run build" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.release.testCommand).toBe("pytest -q && npm run build");
      // Strategy-level defaults still apply.
      expect(cfg.release.strategy).toBe("three-branch");
    });
  });
});
