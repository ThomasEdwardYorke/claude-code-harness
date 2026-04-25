import { describe, it, expect } from "vitest";
import {
  HARNESS_DEFAULT_MODEL,
  HARNESS_DEFAULT_REASONING_EFFORT,
  HARNESS_IMAGE_DEFAULT_BACKEND,
  HARNESS_IMAGE_DEFAULT_MODEL,
  HARNESS_IMAGE_DEFAULT_REASONING_EFFORT,
  VALID_IMAGE_REASONING_EFFORTS,
  VALID_REASONING_EFFORTS,
  checkModels,
  normalizeAgentName,
  resolveImageModel,
  resolveModel,
  type ImageGenerationConfig,
  type ModelsCacheSnapshot,
  type ModelsConfig,
} from "../models/resolver";

describe("models/resolver — resolveModel", () => {
  describe("precedence: agent > codex.default > harness-default", () => {
    it("returns harness-default when config is undefined", () => {
      const result = resolveModel(undefined, "codex-sync");
      expect(result.model).toBe(HARNESS_DEFAULT_MODEL);
      expect(result.reasoningEffort).toBe(HARNESS_DEFAULT_REASONING_EFFORT);
      expect(result.source).toBe("harness-default");
      expect(result.aliasResolved).toBe(false);
    });

    it("returns harness-default when config is empty object", () => {
      const result = resolveModel({}, "codex-sync");
      expect(result.model).toBe(HARNESS_DEFAULT_MODEL);
      expect(result.source).toBe("harness-default");
    });

    it("falls back to codex.default when no per-agent override", () => {
      const config: ModelsConfig = {
        codex: { default: "gpt-5.4", reasoningEffort: "high" },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("gpt-5.4");
      expect(result.reasoningEffort).toBe("high");
      expect(result.source).toBe("codex-default");
    });

    it("per-agent override wins over codex.default", () => {
      const config: ModelsConfig = {
        codex: { default: "gpt-5.4" },
        agents: {
          "codex-sync": { model: "gpt-5.5" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("gpt-5.5");
      expect(result.source).toBe("agent-override");
    });

    it("per-agent reasoningEffort overrides codex.reasoningEffort", () => {
      const config: ModelsConfig = {
        codex: { default: "gpt-5.5", reasoningEffort: "low" },
        agents: {
          "codex-sync": { model: "gpt-5.5", reasoningEffort: "xhigh" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.reasoningEffort).toBe("xhigh");
    });

    it("agent override without reasoningEffort inherits codex.reasoningEffort", () => {
      const config: ModelsConfig = {
        codex: { default: "gpt-5.4", reasoningEffort: "high" },
        agents: {
          "codex-sync": { model: "gpt-5.5" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("gpt-5.5");
      expect(result.reasoningEffort).toBe("high");
    });

    it("codex.default without reasoningEffort uses harness-default reasoning", () => {
      const config: ModelsConfig = {
        codex: { default: "gpt-5.4" },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.reasoningEffort).toBe(HARNESS_DEFAULT_REASONING_EFFORT);
    });

    it("agents.*.reasoningEffort override applies even when model is not overridden", () => {
      // Regression guard: previously the resolver only consulted
      // `agentCfg.reasoningEffort` inside the `if (agentCfg?.model)`
      // branch, so effort-only per-agent overrides were silently
      // dropped.
      const config: ModelsConfig = {
        codex: { default: "gpt-5.5", reasoningEffort: "low" },
        agents: {
          "codex-team": { reasoningEffort: "high" },
        },
      };
      const result = resolveModel(config, "codex-team");
      expect(result.model).toBe("gpt-5.5");
      expect(result.reasoningEffort).toBe("high");
      // effort-only override promotes source to agent-override so
      // `harness model resolve` surfaces the per-agent customisation.
      expect(result.source).toBe("agent-override");
    });

    it("agents.*.reasoningEffort without codex.default still overrides the compile-time effort", () => {
      const config: ModelsConfig = {
        agents: {
          "codex-team": { reasoningEffort: "xhigh" },
        },
      };
      const result = resolveModel(config, "codex-team");
      expect(result.model).toBe(HARNESS_DEFAULT_MODEL);
      expect(result.reasoningEffort).toBe("xhigh");
      expect(result.source).toBe("agent-override");
    });
  });

  describe("alias resolution", () => {
    it("resolves codex.default through aliases map", () => {
      const config: ModelsConfig = {
        codex: {
          default: "strong",
          aliases: { strong: "gpt-5.5", fast: "gpt-5.4-mini" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("gpt-5.5");
      expect(result.aliasResolved).toBe(true);
      expect(result.aliasName).toBe("strong");
    });

    it("resolves per-agent model through aliases map", () => {
      const config: ModelsConfig = {
        codex: {
          aliases: { strong: "gpt-5.5" },
        },
        agents: {
          "codex-sync": { model: "strong" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("gpt-5.5");
      expect(result.aliasResolved).toBe(true);
      expect(result.aliasName).toBe("strong");
    });

    it("returns model verbatim when alias lookup misses", () => {
      const config: ModelsConfig = {
        codex: {
          default: "custom-preview",
          aliases: { strong: "gpt-5.5" },
        },
      };
      const result = resolveModel(config, "codex-sync");
      expect(result.model).toBe("custom-preview");
      expect(result.aliasResolved).toBe(false);
      expect(result.aliasName).toBeUndefined();
    });
  });

  describe("agent name normalization", () => {
    it.each(["codex-sync", "harness:codex-sync", "codex-sync.md", "harness:codex-sync.md"])(
      "treats '%s' as codex-sync",
      (variant) => {
        const config: ModelsConfig = {
          agents: {
            "codex-sync": { model: "gpt-5.5" },
          },
        };
        const result = resolveModel(config, variant);
        expect(result.model).toBe("gpt-5.5");
        expect(result.source).toBe("agent-override");
      },
    );

    it("normalizeAgentName strips harness: prefix and .md suffix", () => {
      expect(normalizeAgentName("harness:codex-team.md")).toBe("codex-team");
      expect(normalizeAgentName("coderabbit-mimic")).toBe("coderabbit-mimic");
    });

    it("normalizeAgentName handles empty/whitespace gracefully", () => {
      expect(normalizeAgentName("")).toBe("");
      expect(normalizeAgentName("   ")).toBe("");
    });
  });

  describe("invalid reasoningEffort handling", () => {
    it("falls back to harness-default when agent reasoningEffort is invalid", () => {
      const config = {
        agents: {
          "codex-sync": {
            model: "gpt-5.5",
            reasoningEffort: "maximum" as unknown as "medium",
          },
        },
      } as ModelsConfig;
      const result = resolveModel(config, "codex-sync");
      expect(result.reasoningEffort).toBe(HARNESS_DEFAULT_REASONING_EFFORT);
    });

    it("falls back to harness-default when codex.reasoningEffort is invalid", () => {
      const config = {
        codex: {
          default: "gpt-5.5",
          reasoningEffort: "ultra" as unknown as "medium",
        },
      } as ModelsConfig;
      const result = resolveModel(config, "codex-sync");
      expect(result.reasoningEffort).toBe(HARNESS_DEFAULT_REASONING_EFFORT);
    });

    it("VALID_REASONING_EFFORTS lists the 5 Codex-documented levels", () => {
      expect([...VALID_REASONING_EFFORTS]).toEqual([
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
    });
  });

  describe("compile-time defaults", () => {
    it("HARNESS_DEFAULT_MODEL is gpt-5.5", () => {
      // gpt-5.5 is the 2026-04-24 release chosen as shipped default.
      // Flipping this value is a breaking change (see resolver.ts header).
      expect(HARNESS_DEFAULT_MODEL).toBe("gpt-5.5");
    });

    it("HARNESS_DEFAULT_REASONING_EFFORT is medium", () => {
      expect(HARNESS_DEFAULT_REASONING_EFFORT).toBe("medium");
    });
  });
});

describe("models/resolver — checkModels", () => {
  const cache: ModelsCacheSnapshot = {
    models: [
      { slug: "gpt-5.5" },
      { slug: "gpt-5.4" },
      { slug: "gpt-5.4-mini" },
      { slug: "gpt-5.3-codex" },
      { slug: "gpt-5.2" },
    ],
    upgrade: { model: "gpt-5.5" },
    migrations: { "gpt-5.2": "gpt-5.2-codex" },
  };

  it("emits upgrade hit when referenced model is older than cache.upgrade.model", () => {
    const config: ModelsConfig = { codex: { default: "gpt-5.4" } };
    const report = checkModels(config, cache);
    const upgradeHit = report.hits.find((h) => h.reason === "upgrade");
    expect(upgradeHit).toBeDefined();
    expect(upgradeHit?.model).toBe("gpt-5.4");
    expect(upgradeHit?.suggested).toBe("gpt-5.5");
    expect(upgradeHit?.location).toBe("codex.default");
  });

  it("emits migration hit when referenced model is in notice.model_migrations", () => {
    const config: ModelsConfig = { codex: { default: "gpt-5.2" } };
    const report = checkModels(config, cache);
    const migrationHit = report.hits.find((h) => h.reason === "migration");
    expect(migrationHit).toBeDefined();
    expect(migrationHit?.model).toBe("gpt-5.2");
    expect(migrationHit?.suggested).toBe("gpt-5.2-codex");
  });

  it("emits unknown-slug hit when referenced model is absent from cache.models", () => {
    const config: ModelsConfig = {
      codex: { default: "gpt-7" },
    };
    const report = checkModels(config, cache);
    const unknownHit = report.hits.find((h) => h.reason === "unknown-slug");
    expect(unknownHit).toBeDefined();
    expect(unknownHit?.model).toBe("gpt-7");
  });

  it("returns empty hits when all references are current (on gpt-5.5)", () => {
    const config: ModelsConfig = { codex: { default: "gpt-5.5" } };
    const report = checkModels(config, cache);
    expect(report.hits).toEqual([]);
    expect(report.referencedModels).toEqual(["gpt-5.5"]);
  });

  it("returns empty hits when cache is null (check pure-defensive, not blocking)", () => {
    const config: ModelsConfig = { codex: { default: "gpt-5.4" } };
    const report = checkModels(config, null);
    expect(report.hits).toEqual([]);
  });

  it("collects referenced models from codex.default + agents, dedup'd, aliases not orphan-emitted", () => {
    // Unused aliases (targets that neither codex.default nor any agent
    // actually resolves to) are NOT surfaced as referenced models — the
    // resolver would never hand them out, so `model check` should not
    // flag them as deprecated. When an alias IS used (e.g.
    // `default: "strong"` + `aliases.strong = "gpt-5.5"`), the concrete
    // slug flows in via the default/agent path.
    const config: ModelsConfig = {
      codex: {
        default: "gpt-5.5",
        aliases: { strong: "gpt-5.5", fast: "gpt-5.4-mini" },
      },
      agents: {
        "codex-sync": { model: "gpt-5.5" },
        "coderabbit-mimic": { model: "gpt-5.3-codex" },
      },
    };
    const report = checkModels(config, cache);
    // `fast → gpt-5.4-mini` is an unused alias — it should NOT appear
    // because nothing references it. `strong → gpt-5.5` is also unused
    // (codex.default points at the literal `gpt-5.5`), so its target is
    // not double-counted either.
    expect(report.referencedModels.sort()).toEqual(
      ["gpt-5.3-codex", "gpt-5.5"].sort(),
    );
  });

  it("alias USED by codex.default surfaces the concrete slug as referenced (still tracked)", () => {
    const config: ModelsConfig = {
      codex: {
        default: "strong",
        aliases: { strong: "gpt-5.5", fast: "gpt-5.4-mini" },
      },
    };
    const report = checkModels(config, cache);
    // `strong` is used by codex.default; its resolved slug (gpt-5.5) is
    // tracked. `fast` is orphan and not emitted.
    expect(report.referencedModels.sort()).toEqual(["gpt-5.5"].sort());
  });

  it("locates hit back to the agent config when agent overrides an old model", () => {
    const config: ModelsConfig = {
      codex: { default: "gpt-5.5" },
      agents: {
        "codex-sync": { model: "gpt-5.4" },
      },
    };
    const report = checkModels(config, cache);
    const agentHit = report.hits.find(
      (h) => h.location === "agents" && h.agent === "codex-sync",
    );
    expect(agentHit).toBeDefined();
    expect(agentHit?.suggested).toBe("gpt-5.5");
  });

  it("falls back to harness-default location when config is undefined and cache signals upgrade", () => {
    const upgradeOnlyCache: ModelsCacheSnapshot = {
      models: [{ slug: "gpt-5.5" }],
      upgrade: { model: "gpt-5.5" },
    };
    // Undefined config → referencedModels = [HARNESS_DEFAULT_MODEL=gpt-5.5]
    // Already matches upgrade target, so no hit.
    const report = checkModels(undefined, upgradeOnlyCache);
    expect(report.referencedModels).toEqual(["gpt-5.5"]);
    expect(report.hits).toEqual([]);
  });

  it("unknown slugs do NOT fire `upgrade` hits — only `unknown-slug`", () => {
    // Regression guard: previously `slug !== upgradeSlug` on its own let
    // typo / unreleased slugs pile up an `upgrade` hit as well as the
    // `unknown-slug` hit, which made `--strict` noisy.
    const config: ModelsConfig = { codex: { default: "gpt-7-fantasy" } };
    const report = checkModels(config, cache);
    expect(report.hits.filter((h) => h.reason === "upgrade")).toEqual([]);
    const unknownHit = report.hits.find((h) => h.reason === "unknown-slug");
    expect(unknownHit).toBeDefined();
    expect(unknownHit?.model).toBe("gpt-7-fantasy");
  });

  it("emits one hit per reference site when the same slug is wired in multiple places", () => {
    // `collectReferences` now keeps per-site tuples instead of dedup'ing
    // into a single slug, so `codex.default` + an agent-override that
    // share a deprecated slug both surface their own fix location.
    const config: ModelsConfig = {
      codex: { default: "gpt-5.4" },
      agents: {
        "codex-sync": { model: "gpt-5.4" },
      },
    };
    const report = checkModels(config, cache);
    const upgradeHits = report.hits.filter((h) => h.reason === "upgrade");
    expect(upgradeHits).toHaveLength(2);
    expect(upgradeHits.some((h) => h.location === "codex.default")).toBe(true);
    expect(
      upgradeHits.some(
        (h) => h.location === "agents" && h.agent === "codex-sync",
      ),
    ).toBe(true);
    // Dedup is still reflected in the summary list.
    expect(report.referencedModels).toEqual(["gpt-5.4"]);
  });
});

describe("models/resolver — resolveImageModel", () => {
  // Background: image_gen tool is currently only available on `gpt-5.4`
  // (via Codex CLI's `image_gen` tool surface, 2026-04-25), so the
  // image-side compile-time fallback intentionally diverges from the
  // text-side `HARNESS_DEFAULT_MODEL = "gpt-5.5"`. Keep this divergence
  // explicit — flipping the image default is a breaking change.
  describe("compile-time defaults", () => {
    it("HARNESS_IMAGE_DEFAULT_MODEL pins gpt-5.4 (image_gen tool dependency)", () => {
      expect(HARNESS_IMAGE_DEFAULT_MODEL).toBe("gpt-5.4");
    });

    it("HARNESS_IMAGE_DEFAULT_REASONING_EFFORT is medium", () => {
      expect(HARNESS_IMAGE_DEFAULT_REASONING_EFFORT).toBe("medium");
    });

    it("HARNESS_IMAGE_DEFAULT_BACKEND is codex-image-gen", () => {
      expect(HARNESS_IMAGE_DEFAULT_BACKEND).toBe("codex-image-gen");
    });

    it("VALID_IMAGE_REASONING_EFFORTS lists exactly {medium, high} (image_gen accepts only these)", () => {
      // Subset of the text-side VALID_REASONING_EFFORTS — image generation
      // does not benefit from minimal/low/xhigh in practice (image_gen tool
      // contract) so we keep the surface narrow and let `validateImageGen`
      // fall back if a user supplies anything else.
      expect([...VALID_IMAGE_REASONING_EFFORTS]).toEqual(["medium", "high"]);
    });
  });

  describe("precedence: agent-override > image-default > harness-default", () => {
    it("returns harness-default when imageConfig and modelsConfig are both undefined", () => {
      const result = resolveImageModel(undefined, undefined, "image-gen");
      expect(result.model).toBe(HARNESS_IMAGE_DEFAULT_MODEL);
      expect(result.reasoningEffort).toBe(HARNESS_IMAGE_DEFAULT_REASONING_EFFORT);
      expect(result.backend).toBe(HARNESS_IMAGE_DEFAULT_BACKEND);
      expect(result.source).toBe("harness-default");
      expect(result.aliasResolved).toBe(false);
    });

    it("uses imageConfig.defaultModel when set (image-default source)", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "gpt-5.5",
        defaultReasoning: "high",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const result = resolveImageModel(imageConfig, undefined, "image-gen");
      expect(result.model).toBe("gpt-5.5");
      expect(result.reasoningEffort).toBe("high");
      expect(result.backend).toBe("codex-image-gen");
      expect(result.source).toBe("image-default");
    });

    it("per-agent override (models.agents[agentName].model) wins over imageConfig.defaultModel", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "gpt-5.4",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        agents: {
          "image-gen": { model: "gpt-5.5" },
        },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.model).toBe("gpt-5.5");
      expect(result.source).toBe("agent-override");
    });

    it("normalizes agentName variants (harness:image-edit, image-edit.md)", () => {
      const modelsConfig: ModelsConfig = {
        agents: {
          "image-edit": { model: "gpt-5.5" },
        },
      };
      const result = resolveImageModel(
        undefined,
        modelsConfig,
        "harness:image-edit.md",
      );
      expect(result.model).toBe("gpt-5.5");
      expect(result.source).toBe("agent-override");
    });

    it("agent-override reasoningEffort wins over imageConfig.defaultReasoning", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "gpt-5.4",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        agents: {
          "image-gen": { model: "gpt-5.5", reasoningEffort: "high" },
        },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.reasoningEffort).toBe("high");
      expect(result.source).toBe("agent-override");
    });

    it("agent-only reasoningEffort (no model) still promotes source to agent-override", () => {
      // Regression guard mirroring resolveModel's same-shaped invariant —
      // an effort-only override on the agents.* side must not be silently
      // dropped because resolveImageModel branched on `agentCfg?.model`
      // first.
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "gpt-5.4",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        agents: {
          "image-gen": { reasoningEffort: "high" },
        },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.model).toBe("gpt-5.4"); // image-default
      expect(result.reasoningEffort).toBe("high");
      expect(result.source).toBe("agent-override");
    });

    it("invalid agent reasoningEffort (outside {medium, high}) falls back to image-default", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "gpt-5.4",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        agents: {
          // `low` is valid for text models but not for image models.
          "image-gen": { model: "gpt-5.5", reasoningEffort: "low" },
        },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.model).toBe("gpt-5.5"); // model override still applies
      expect(result.reasoningEffort).toBe("medium"); // falls back to image-default
    });
  });

  describe("alias resolution (shared with text models)", () => {
    it("resolves imageConfig.defaultModel through models.codex.aliases", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "image-strong",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        codex: {
          aliases: { "image-strong": "gpt-5.4-vision-pro" },
        },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.model).toBe("gpt-5.4-vision-pro");
      expect(result.aliasResolved).toBe(true);
      expect(result.aliasName).toBe("image-strong");
    });

    it("returns model verbatim when alias map misses", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "custom-image-preview",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const result = resolveImageModel(imageConfig, undefined, "image-gen");
      expect(result.model).toBe("custom-image-preview");
      expect(result.aliasResolved).toBe(false);
    });
  });

  describe("backend propagation", () => {
    it("uses imageConfig.defaultBackend when set", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "anthropic-claude-image",
        defaultModel: "claude-image-1",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const result = resolveImageModel(imageConfig, undefined, "image-gen");
      expect(result.backend).toBe("anthropic-claude-image");
    });

    it("falls back to HARNESS_IMAGE_DEFAULT_BACKEND when imageConfig is undefined", () => {
      const result = resolveImageModel(undefined, undefined, "image-edit");
      expect(result.backend).toBe(HARNESS_IMAGE_DEFAULT_BACKEND);
    });
  });

  describe("edge cases (Codex adversarial NITPICK-5)", () => {
    it("falls back to defaults when agentName is empty string", () => {
      const result = resolveImageModel(undefined, undefined, "");
      expect(result.model).toBe(HARNESS_IMAGE_DEFAULT_MODEL);
      expect(result.source).toBe("harness-default");
    });

    it("falls back to defaults when agentName is whitespace only", () => {
      const result = resolveImageModel(undefined, undefined, "   ");
      expect(result.source).toBe("harness-default");
    });

    it("treats null/undefined agentName gracefully (does not throw)", () => {
      // The TypeScript type signature requires a string, but `bin/harness`
      // could pass `String(undefined)` = "undefined" or arrays. The
      // resolver must coerce defensively rather than throw.
      const result = resolveImageModel(
        undefined,
        undefined,
        null as unknown as string,
      );
      expect(result.source).toBe("harness-default");
    });

    it("handles empty aliases map {} the same as absent aliases", () => {
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "codex-image-gen",
        defaultModel: "no-such-alias",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const modelsConfig: ModelsConfig = {
        codex: { aliases: {} },
      };
      const result = resolveImageModel(imageConfig, modelsConfig, "image-gen");
      expect(result.model).toBe("no-such-alias"); // verbatim
      expect(result.aliasResolved).toBe(false);
    });

    it("handles empty-string defaultBackend by falling back to harness default", () => {
      // Defensive: an empty string should not silently propagate as the
      // backend identifier (would resolve to a non-existent script
      // `${SKILL_DIR}/scripts/backends/.sh`).
      const imageConfig: ImageGenerationConfig = {
        defaultBackend: "",
        defaultModel: "gpt-5.4",
        defaultReasoning: "medium",
        defaultAspect: "1:1",
        defaultCount: 4,
        refImageAllowlistPrefixes: [],
      };
      const result = resolveImageModel(imageConfig, undefined, "image-gen");
      expect(result.backend).toBe(HARNESS_IMAGE_DEFAULT_BACKEND);
    });
  });
});
