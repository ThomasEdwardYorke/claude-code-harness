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

/**
 * Capture lines written to `process.stderr.write` during the supplied
 * callback. Restores the original write implementation in a `finally`
 * block so a thrown assertion does not leak the mock to subsequent
 * tests. The callback receives the live `stderrWrites` array so it can
 * assert on warnings produced by the function under test.
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

  describe("models section (harness model registry)", () => {
    it("DEFAULT_CONFIG leaves models undefined so resolver emits source=harness-default", () => {
      // The compile-time default lives in `src/models/resolver.ts` as
      // `HARNESS_DEFAULT_MODEL`. Deliberately leaving `DEFAULT_CONFIG.models`
      // undefined lets `harness model resolve` distinguish "shipped
      // behaviour" (source=harness-default) from "explicit project
      // pinning" (source=codex-default or agent-override).
      expect(DEFAULT_CONFIG.models).toBeUndefined();
    });

    it("loadConfig keeps models undefined when user does not declare models", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({ projectName: "skip-models" }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.models).toBeUndefined();
    });

    it("loadConfig accepts user override of codex.default without pinning sibling keys", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({ models: { codex: { default: "gpt-5.4" } } }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.models?.codex?.default).toBe("gpt-5.4");
      // No sibling defaults were merged — reasoningEffort stays undefined
      // so the resolver can fall through to its own fallback.
      expect(cfg.models?.codex?.reasoningEffort).toBeUndefined();
    });

    it("loadConfig deep-merges codex.aliases with base (empty base + user aliases)", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          models: {
            codex: { aliases: { strong: "gpt-5.5", fast: "gpt-5.4-mini" } },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.models?.codex?.aliases).toEqual({
        strong: "gpt-5.5",
        fast: "gpt-5.4-mini",
      });
    });

    it("loadConfig lifts per-agent overrides under agents.*.model", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          models: {
            agents: {
              "codex-sync": { model: "gpt-5.4" },
              "codex-team": { reasoningEffort: "high" },
            },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.models?.agents?.["codex-sync"]?.model).toBe("gpt-5.4");
      expect(cfg.models?.agents?.["codex-team"]?.reasoningEffort).toBe("high");
      // No codex section in the user config — so loadConfig does not
      // synthesize one (keeps the "harness-default source" signal alive).
      expect(cfg.models?.codex).toBeUndefined();
    });

    it("loadConfig preserves user-supplied codex + aliases + agents fields together", () => {
      // Regression guard for nested-merge shadowing. `mergeModelsConfig`
      // must keep each sub-key intact when the user supplies a partial
      // `codex` override + a per-agent entry + a new alias in one shot.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          models: {
            codex: {
              default: "strong",
              reasoningEffort: "xhigh",
              aliases: { strong: "gpt-5.5", fast: "gpt-5.4-mini" },
            },
            agents: {
              "codex-sync": { model: "strong", reasoningEffort: "low" },
            },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.models?.codex?.default).toBe("strong");
      expect(cfg.models?.codex?.reasoningEffort).toBe("xhigh");
      expect(cfg.models?.codex?.aliases?.strong).toBe("gpt-5.5");
      expect(cfg.models?.codex?.aliases?.fast).toBe("gpt-5.4-mini");
      expect(cfg.models?.agents?.["codex-sync"]?.model).toBe("strong");
      expect(cfg.models?.agents?.["codex-sync"]?.reasoningEffort).toBe("low");
    });
  });

  describe("codex.sync section (codex-sync truncate mitigation)", () => {
    // Context: Claude Code runtime defaults `TASK_MAX_OUTPUT_LENGTH` to
    // 32000 characters; subagent outputs exceeding that are middle-truncated
    // (full output auto-saved to disk, but the subagent response visible
    // to the caller loses the middle). codex-sync routinely returns
    // multi-KB Codex review output and hit this truncation cap multiple
    // times in development. Harness ships guidance to bump the env var
    // to Claude Code's documented maximum (160000) and lets `harness
    // doctor` warn when the effective limit is below the runtime default.
    it("DEFAULT_CONFIG.codex.sync exposes TASK_MAX_OUTPUT_LENGTH thresholds", () => {
      expect(DEFAULT_CONFIG.codex.sync).toBeDefined();
      expect(DEFAULT_CONFIG.codex.sync?.recommendedTaskMaxOutputLength).toBe(160000);
      expect(DEFAULT_CONFIG.codex.sync?.warnTaskMaxOutputLengthBelow).toBe(32000);
      expect(DEFAULT_CONFIG.codex.sync?.checkTaskMaxOutputLength).toBe(true);
    });

    it("merges partial codex.sync override without dropping sibling defaults", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          codex: {
            enabled: true,
            sync: { checkTaskMaxOutputLength: false },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.codex.enabled).toBe(true);
      expect(cfg.codex.sync?.checkTaskMaxOutputLength).toBe(false);
      // Sibling defaults still come from DEFAULT_CONFIG.codex.sync.
      expect(cfg.codex.sync?.recommendedTaskMaxOutputLength).toBe(160000);
      expect(cfg.codex.sync?.warnTaskMaxOutputLengthBelow).toBe(32000);
    });

    it("accepts project-level override of threshold values", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          codex: {
            sync: {
              recommendedTaskMaxOutputLength: 80000,
              warnTaskMaxOutputLengthBelow: 40000,
            },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.codex.sync?.recommendedTaskMaxOutputLength).toBe(80000);
      expect(cfg.codex.sync?.warnTaskMaxOutputLengthBelow).toBe(40000);
      // checkTaskMaxOutputLength still defaults to true when not overridden.
      expect(cfg.codex.sync?.checkTaskMaxOutputLength).toBe(true);
    });

    it("preserves codex.sync defaults when user supplies only codex.enabled", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({ codex: { enabled: true } }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.codex.enabled).toBe(true);
      expect(cfg.codex.sync?.recommendedTaskMaxOutputLength).toBe(160000);
      expect(cfg.codex.sync?.checkTaskMaxOutputLength).toBe(true);
    });
  });

  describe("imageGeneration section (run-ai-images / ai-image-edit skill registry)", () => {
    // Background: harness ships two skills that drive the OpenAI image_gen
    // tool through the Codex CLI — `run-ai-images` (engine) and
    // `ai-image-edit` (wrap). The `imageGeneration` config surface lets
    // projects pin the backend, default model, default aspect ratio, and
    // ref-image allowlist once instead of repeating these knobs across
    // every invocation. Defaults match the v0 codex-image-gen backend
    // (gpt-5.4 — image_gen tool dependency).
    it("DEFAULT_CONFIG.imageGeneration exposes the v0 codex-image-gen backend defaults", () => {
      expect(DEFAULT_CONFIG.imageGeneration).toBeDefined();
      expect(DEFAULT_CONFIG.imageGeneration.defaultBackend).toBe("codex-image-gen");
      expect(DEFAULT_CONFIG.imageGeneration.defaultModel).toBe("gpt-5.4");
      expect(DEFAULT_CONFIG.imageGeneration.defaultReasoning).toBe("medium");
      expect(DEFAULT_CONFIG.imageGeneration.defaultAspect).toBe("1:1");
      expect(DEFAULT_CONFIG.imageGeneration.defaultCount).toBe(4);
      expect(DEFAULT_CONFIG.imageGeneration.refImageAllowlistPrefixes).toEqual([]);
    });

    it("loadConfig deep-merges imageGeneration partial overrides without dropping siblings", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          imageGeneration: { defaultModel: "gpt-5.5" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.imageGeneration.defaultModel).toBe("gpt-5.5");
      // Sibling fields keep DEFAULT_CONFIG values.
      expect(cfg.imageGeneration.defaultBackend).toBe("codex-image-gen");
      expect(cfg.imageGeneration.defaultReasoning).toBe("medium");
      expect(cfg.imageGeneration.defaultAspect).toBe("1:1");
      expect(cfg.imageGeneration.defaultCount).toBe(4);
      expect(cfg.imageGeneration.refImageAllowlistPrefixes).toEqual([]);
    });

    it("loadConfig accepts user override of defaultCount within 1-16 range", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          imageGeneration: { defaultCount: 8, defaultAspect: "16:9" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.imageGeneration.defaultCount).toBe(8);
      expect(cfg.imageGeneration.defaultAspect).toBe("16:9");
    });

    it("loadConfig replaces refImageAllowlistPrefixes wholesale (array semantics)", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          imageGeneration: {
            refImageAllowlistPrefixes: [
              "/srv/projects/assets/",
              "/tmp/safe/",
            ],
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.imageGeneration.refImageAllowlistPrefixes).toEqual([
        "/srv/projects/assets/",
        "/tmp/safe/",
      ]);
    });

    it("loadConfig falls back to default defaultReasoning on non-enum value (with stderr warn)", () => {
      // Mirrors the validateRelease / validateTddEnforce pattern: invalid
      // enum values fall back to DEFAULT_CONFIG so consumers never need a
      // fifth `default:` branch in their switch statements.
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultReasoning: "ultra" }, // not in {medium, high}
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultReasoning).toBe("medium"); // default
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("imageGeneration.defaultReasoning");
        expect(warnings).toContain("ultra");
      });
    });

    it("loadConfig falls back to default defaultAspect on non-enum value (with stderr warn)", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultAspect: "21:9" }, // not in allowed enum
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultAspect).toBe("1:1"); // default
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("imageGeneration.defaultAspect");
        expect(warnings).toContain("21:9");
      });
    });

    it("valid enum values pass through without warning", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: {
              defaultReasoning: "high",
              defaultAspect: "9:16",
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultReasoning).toBe("high");
        expect(cfg.imageGeneration.defaultAspect).toBe("9:16");
        expect(stderrWrites.join("")).toBe("");
      });
    });

    // ─────────────────────────────────────────────────────────────────
    // Defensive coverage: range / allowlist / sanitisation / type-confusion
    // guards layered on top of the schema (loadConfig runs before schema
    // validation, so the runtime guards must mirror the static contract).
    // ─────────────────────────────────────────────────────────────────
    it("loadConfig falls back to default defaultCount on out-of-range value (with stderr warn)", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultCount: 100 }, // > 16
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultCount).toBe(4); // default
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("imageGeneration.defaultCount");
        expect(warnings).toContain("100");
      });
    });

    it("loadConfig falls back to default defaultCount on negative / zero value", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultCount: 0 },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultCount).toBe(4);
        expect(stderrWrites.join("")).toContain("imageGeneration.defaultCount");
      });
    });

    it("loadConfig falls back when defaultCount is non-integer", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultCount: 3.5 }, // non-integer
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultCount).toBe(4);
        expect(stderrWrites.join("")).toContain("imageGeneration.defaultCount");
      });
    });

    it("loadConfig drops refImageAllowlistPrefixes entries with .. / non-absolute paths", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: {
              refImageAllowlistPrefixes: [
                "/srv/safe/",
                "../../etc/", // path traversal
                "relative/path/", // non-absolute
                "/srv/other/",
              ],
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        // Only the two valid absolute paths survive.
        expect(cfg.imageGeneration.refImageAllowlistPrefixes).toEqual([
          "/srv/safe/",
          "/srv/other/",
        ]);
        expect(stderrWrites.join("")).toContain(
          "imageGeneration.refImageAllowlistPrefixes",
        );
      });
    });

    it("loadConfig drops refImageAllowlistPrefixes entries with control characters / NUL bytes", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: {
              refImageAllowlistPrefixes: [
                "/srv/clean/",
                "/srv/with-\x00null/", // NUL byte
                "/srv/with-\x1bansi/", // ESC
              ],
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.refImageAllowlistPrefixes).toEqual([
          "/srv/clean/",
        ]);
      });
    });

    it("loadConfig drops non-string refImageAllowlistPrefixes entries", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: {
              refImageAllowlistPrefixes: [
                "/srv/clean/",
                42, // wrong type
                null,
                "", // empty
              ],
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.refImageAllowlistPrefixes).toEqual([
          "/srv/clean/",
        ]);
      });
    });

    it("stderr warnings sanitize ANSI escape sequences in offending values", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: {
              defaultReasoning: "medium\x1b[31mEVIL", // ANSI escape sequence
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultReasoning).toBe("medium"); // fallback
        const warnings = stderrWrites.join("");
        // Control chars must be filtered out — no raw ESC byte (0x1b) leaks
        // through. The reported value is sanitised so log scrapers see a
        // stable surface.
        expect(warnings).not.toContain("\x1b");
        expect(warnings).not.toContain("");
      });
    });

    it("imageGeneration: <non-object> falls back to defaults with stderr warn", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: 123, // primitive, not an object
          }),
        );
        const cfg = loadConfig(projectRoot);
        // Falls back to DEFAULT_CONFIG.imageGeneration entirely.
        expect(cfg.imageGeneration).toEqual(DEFAULT_CONFIG.imageGeneration);
        expect(stderrWrites.join("")).toContain("imageGeneration");
      });
    });

    it("imageGeneration: null falls back to defaults", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          imageGeneration: null,
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.imageGeneration).toEqual(DEFAULT_CONFIG.imageGeneration);
    });

    it("imageGeneration: [] (array) falls back to defaults", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: ["/srv/whatever/"], // array, not object
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration).toEqual(DEFAULT_CONFIG.imageGeneration);
        expect(stderrWrites.join("")).toContain("imageGeneration");
      });
    });

    // ─────────────────────────────────────────────────────────────────
    // defaultBackend basename guard: backend script names resolve against
    // ${SKILL_DIR}/scripts/backends/<name>.sh — path separators / .. /
    // control characters could escape the backends directory or break
    // shell invocation. Reject malformed values at load time.
    // ─────────────────────────────────────────────────────────────────
    it("loadConfig rejects defaultBackend containing path separators", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultBackend: "../escape/script" },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultBackend).toBe(
          DEFAULT_CONFIG.imageGeneration.defaultBackend,
        );
        expect(stderrWrites.join("")).toContain(
          "imageGeneration.defaultBackend",
        );
      });
    });

    it("loadConfig rejects defaultBackend with control characters / NUL bytes", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultBackend: "evil\x00null" },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultBackend).toBe(
          DEFAULT_CONFIG.imageGeneration.defaultBackend,
        );
      });
    });

    it("loadConfig rejects empty / whitespace-only defaultBackend", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            imageGeneration: { defaultBackend: "" },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.imageGeneration.defaultBackend).toBe(
          DEFAULT_CONFIG.imageGeneration.defaultBackend,
        );
      });
    });

    it("loadConfig accepts a clean basename for defaultBackend", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          imageGeneration: { defaultBackend: "anthropic-claude-image" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.imageGeneration.defaultBackend).toBe(
        "anthropic-claude-image",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4-layer handoff integration — work.taskTrackerMode + handoffPaths.
  // Backward compatibility: existing Plans.md mode users see no
  // behaviour change. New "handoff" mode is opt-in and requires
  // handoffPaths to be fully populated; missing fields trigger a
  // stderr warning and silent fall-back to "plans" mode.
  // ─────────────────────────────────────────────────────────────────
  describe("work.taskTrackerMode + handoffPaths (4-layer handoff)", () => {
    it("DEFAULT_CONFIG.work.taskTrackerMode is 'plans' (backward compatible)", () => {
      expect(DEFAULT_CONFIG.work.taskTrackerMode).toBe("plans");
    });

    it("DEFAULT_CONFIG.work.handoffPaths is undefined (opt-in only)", () => {
      // The handoff layer is genuinely optional — no default scaffold so
      // a project without `handoffPaths` set is unambiguously a Plans.md
      // user. Detecting this absence is how downstream code (skills,
      // hooks) decides whether the handoff layer applies at all.
      expect(DEFAULT_CONFIG.work.handoffPaths).toBeUndefined();
    });

    it("loadConfig accepts taskTrackerMode='handoff' with full handoffPaths set", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
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
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.taskTrackerMode).toBe("handoff");
      expect(cfg.work.handoffPaths).toEqual({
        roadmap: ".docs/handoff/my-project-roadmap.md",
        backlog: ".docs/handoff/my-project-backlog.md",
        current: ".docs/handoff/my-project-current.md",
        decisions: ".docs/handoff/my-project-design-decisions.md",
      });
    });

    it("loadConfig keeps taskTrackerMode='plans' when explicitly set", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: { taskTrackerMode: "plans" },
        }),
      );
      const cfg = loadConfig(projectRoot);
      expect(cfg.work.taskTrackerMode).toBe("plans");
      expect(cfg.work.handoffPaths).toBeUndefined();
    });

    it("loadConfig replaces handoffPaths wholesale (no shallow merge)", () => {
      // handoffPaths follows the harness "arrays / required objects replace
      // wholesale" convention — partial overrides would create silently
      // incomplete configs. The merge replaces the user-provided object
      // verbatim.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: {
            taskTrackerMode: "handoff",
            handoffPaths: {
              roadmap: "custom/roadmap.md",
              backlog: "custom/backlog.md",
              current: "custom/current.md",
              decisions: "custom/decisions.md",
            },
          },
        }),
      );
      const cfg = loadConfig(projectRoot);
      // Exact match — no inherited defaults sneak in.
      expect(cfg.work.handoffPaths).toEqual({
        roadmap: "custom/roadmap.md",
        backlog: "custom/backlog.md",
        current: "custom/current.md",
        decisions: "custom/decisions.md",
      });
    });

    it("loadConfig falls back to 'plans' when taskTrackerMode='handoff' but handoffPaths is absent (with stderr warn)", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            work: { taskTrackerMode: "handoff" },
            // handoffPaths intentionally omitted
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.work.taskTrackerMode).toBe("plans");
        expect(cfg.work.handoffPaths).toBeUndefined();
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("taskTrackerMode");
        expect(warnings).toContain("handoff");
        expect(warnings).toContain("handoffPaths");
      });
    });

    it("loadConfig falls back to 'plans' when handoffPaths has missing required field", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            work: {
              taskTrackerMode: "handoff",
              handoffPaths: {
                roadmap: "r.md",
                backlog: "b.md",
                // current + decisions intentionally missing
              },
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.work.taskTrackerMode).toBe("plans");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("handoffPaths");
      });
    });

    it("loadConfig rejects handoffPaths fields with empty strings", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            work: {
              taskTrackerMode: "handoff",
              handoffPaths: {
                roadmap: "",
                backlog: "b.md",
                current: "c.md",
                decisions: "d.md",
              },
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.work.taskTrackerMode).toBe("plans");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("handoffPaths");
      });
    });

    it("loadConfig rejects handoffPaths fields containing path traversal segments", () => {
      // Mirrors the userPromptSubmit.contextFiles rule: `..` segments
      // are a path-traversal vector and would let a project escape its
      // own root. Validation drops the whole handoff override rather
      // than partially honouring a malformed path.
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            work: {
              taskTrackerMode: "handoff",
              handoffPaths: {
                roadmap: "../escape/roadmap.md",
                backlog: "b.md",
                current: "c.md",
                decisions: "d.md",
              },
            },
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.work.taskTrackerMode).toBe("plans");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("handoffPaths");
      });
    });

    it("loadConfig falls back when taskTrackerMode is an unknown enum value", () => {
      withCapturedStderr((stderrWrites) => {
        writeFileSync(
          join(projectRoot, "harness.config.json"),
          JSON.stringify({
            work: { taskTrackerMode: "github-issues" }, // not in allowed enum
          }),
        );
        const cfg = loadConfig(projectRoot);
        expect(cfg.work.taskTrackerMode).toBe("plans");
        const warnings = stderrWrites.join("");
        expect(warnings).toContain("taskTrackerMode");
      });
    });

    it("loadConfig keeps handoffPaths when mode is 'plans' (no validation tripwire)", () => {
      // An author who flips the mode to "handoff" later should not need
      // to re-add the paths each time. Storing handoffPaths while the
      // mode is "plans" is a benign forward-compat case.
      writeFileSync(
        join(projectRoot, "harness.config.json"),
        JSON.stringify({
          work: {
            taskTrackerMode: "plans",
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
      expect(cfg.work.taskTrackerMode).toBe("plans");
      // Paths are preserved for forward compatibility.
      expect(cfg.work.handoffPaths).toEqual({
        roadmap: "r.md",
        backlog: "b.md",
        current: "c.md",
        decisions: "d.md",
      });
    });

    it("loadConfig deep-merges work alongside taskTrackerMode without losing other defaults", () => {
      writeFileSync(
        join(projectRoot, "harness.config.json"),
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
      // qualityGates default object is preserved.
      expect(cfg.work.qualityGates.enforceTddImplement).toBe(true);
      // plansFile default still present (handoff mode does not erase it —
      // skills decide which one to use at dispatch time).
      expect(cfg.work.plansFile).toBe("Plans.md");
      // labelPriority / criticalLabels arrays still default to [].
      expect(cfg.work.labelPriority).toEqual([]);
      expect(cfg.work.criticalLabels).toEqual([]);
    });
  });
});
