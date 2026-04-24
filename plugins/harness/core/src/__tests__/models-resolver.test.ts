import { describe, it, expect } from "vitest";
import {
  HARNESS_DEFAULT_MODEL,
  HARNESS_DEFAULT_REASONING_EFFORT,
  VALID_REASONING_EFFORTS,
  checkModels,
  normalizeAgentName,
  resolveModel,
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

  it("collects referenced models from codex.default + aliases + agents (dedup)", () => {
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
    expect(report.referencedModels.sort()).toEqual(
      ["gpt-5.3-codex", "gpt-5.4-mini", "gpt-5.5"].sort(),
    );
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
