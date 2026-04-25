/**
 * core/src/models/resolver.ts
 *
 * Harness model registry (v0.4.0) — maps agent invocation context to an
 * effective (model, reasoningEffort) pair via the configured
 * `models.codex.default`, `models.codex.aliases`, and `models.agents[name]`
 * overrides. Defaults to `HARNESS_DEFAULT_MODEL` when nothing is configured.
 *
 * Rationale: plugin consumers want a single knob to pin the Codex model that
 * every harness-dispatched Codex invocation uses, without editing the agent
 * markdown or scattering `--model` flags. The resolver is pure (no IO), so
 * callers (bin/harness model resolve, agent Invocation Rules templates) can
 * safely depend on it in tests and CI.
 *
 * Precedence (highest → lowest):
 *   1. `models.agents[agentName].model`       — per-agent override
 *   2. `models.codex.default`                 — harness-level default
 *   3. `HARNESS_DEFAULT_MODEL`                — compile-time fallback (`gpt-5.5`)
 *
 * reasoningEffort precedence mirrors the model precedence.
 *
 * Alias resolution: either `models.codex.default` or per-agent `model` may
 * reference a logical alias declared in `models.codex.aliases`. Alias lookup
 * is performed once at resolve-time; circular aliases are not supported and
 * will be returned verbatim (let CI surface the typo rather than silently
 * ending up on an unexpected model).
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
/**
 * Compile-time default. `gpt-5.5` chosen because OpenAI released it on
 * 2026-04-24 (same day as this module's introduction) with broader coding
 * coverage than `gpt-5.4`. Changing this constant is a breaking change —
 * prefer per-project override via `harness.config.json`.
 */
export declare const HARNESS_DEFAULT_MODEL = "gpt-5.5";
export declare const HARNESS_DEFAULT_REASONING_EFFORT: ReasoningEffort;
export declare const VALID_REASONING_EFFORTS: readonly ReasoningEffort[];
export interface ModelsCodexConfig {
    /** Default model for all harness-dispatched Codex invocations. */
    default?: string;
    /** Default reasoningEffort; passes through `codex exec --effort`. */
    reasoningEffort?: ReasoningEffort;
    /**
     * Logical-name → concrete-model-slug map. Consumers may refer to the
     * logical name from `default` / `agents[*].model` for readability:
     * `aliases: { strong: "gpt-5.5" }` + `default: "strong"`.
     */
    aliases?: Record<string, string>;
}
export interface ModelsAgentConfig {
    model?: string;
    reasoningEffort?: ReasoningEffort;
}
export interface ModelsConfig {
    codex?: ModelsCodexConfig;
    agents?: Record<string, ModelsAgentConfig>;
}
export type ResolutionSource = "agent-override" | "codex-default" | "harness-default";
export interface ModelResolution {
    model: string;
    reasoningEffort: ReasoningEffort;
    source: ResolutionSource;
    /**
     * True when the resolved `model` was looked up via an alias. The original
     * alias name is preserved in `aliasName` for diagnostics.
     */
    aliasResolved: boolean;
    aliasName?: string;
}
/**
 * Normalise variations in agent names so that both
 * `resolveModel(config, "codex-sync")` and
 * `resolveModel(config, "harness:codex-sync.md")` agree on a single key.
 * Strips `harness:` prefix and `.md` suffix, leaves hyphens intact.
 */
export declare function normalizeAgentName(name: string): string;
export declare function resolveModel(config: ModelsConfig | undefined, agentName: string): ModelResolution;
/**
 * Reasoning effort allowed for image-generation backends. Subset of the
 * text-side `ReasoningEffort` — the OpenAI `image_gen` tool does not
 * benefit from `minimal` / `low` / `xhigh` in practice, so we keep the
 * surface narrow. Out-of-enum values fall back to
 * `HARNESS_IMAGE_DEFAULT_REASONING_EFFORT`.
 */
export type ImageReasoningEffort = "medium" | "high";
/**
 * Aspect ratio enum for the run-ai-images engine `--aspect` flag.
 * Backend honours these as native output (no resize); the 5 ratios cover
 * the most common UX targets. Out-of-enum values fall back to "1:1".
 */
export type ImageAspectRatio = "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
/**
 * Compile-time defaults for image generation. Diverges intentionally
 * from the text-side `HARNESS_DEFAULT_MODEL = "gpt-5.5"` because the
 * OpenAI `image_gen` tool is currently only available on `gpt-5.4`
 * (Codex CLI tool surface, 2026-04-25). Flipping this constant is a
 * breaking change — prefer per-project override via
 * `imageGeneration.defaultModel` in `harness.config.json`.
 */
export declare const HARNESS_IMAGE_DEFAULT_MODEL = "gpt-5.4";
export declare const HARNESS_IMAGE_DEFAULT_REASONING_EFFORT: ImageReasoningEffort;
export declare const HARNESS_IMAGE_DEFAULT_BACKEND = "codex-image-gen";
export declare const HARNESS_IMAGE_DEFAULT_ASPECT: ImageAspectRatio;
export declare const HARNESS_IMAGE_DEFAULT_COUNT = 4;
export declare const VALID_IMAGE_REASONING_EFFORTS: readonly ImageReasoningEffort[];
export declare const VALID_IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[];
/**
 * Image-generation config surface. Mirrors the schema's
 * `imageGeneration.*` keys 1:1 and is consumed by `resolveImageModel`.
 * Defined here rather than imported from `config.ts` to keep the
 * resolver pure (no `node:fs` / loader dependency) and re-usable in
 * tests / CLI / editors that don't load `harness.config.json`.
 */
export interface ImageGenerationConfig {
    defaultBackend: string;
    defaultModel: string;
    defaultReasoning: ImageReasoningEffort;
    defaultAspect: ImageAspectRatio;
    defaultCount: number;
    /**
     * Sanitised at config-load time (see `validateImageGeneration` in
     * `config.ts`) — entries are guaranteed to be non-empty absolute
     * paths free of `..` segments / control characters. **v0**: the
     * resolver carries this list through but does not itself enforce
     * it; the consuming skill script (run-ai-images / ai-image-edit
     * after P2 plugin migration) is responsible for rejecting
     * `--ref-image` paths that fall outside the allowlist before the
     * backend runs.
     */
    refImageAllowlistPrefixes: string[];
}
export type ImageResolutionSource = "agent-override" | "image-default" | "harness-default";
export interface ImageModelResolution {
    /** Resolved Codex / image-backend model slug (after alias lookup). */
    model: string;
    /** Resolved reasoning effort (validated against {medium, high}). */
    reasoningEffort: ImageReasoningEffort;
    /** Backend script name (e.g. `codex-image-gen`). */
    backend: string;
    /** Where the resolution drew the model slug from. */
    source: ImageResolutionSource;
    /** True when the resolved `model` was looked up via `models.codex.aliases`. */
    aliasResolved: boolean;
    aliasName?: string;
}
/**
 * Resolve the effective (model, reasoningEffort, backend) tuple for an
 * image-generation skill invocation.
 *
 * Precedence (highest → lowest):
 *   1. `models.agents[normalizeAgentName(agentName)].model`
 *      / `.reasoningEffort` — per-agent override (e.g. project pinned
 *      `image-gen` to a different model than `image-edit`).
 *   2. `imageConfig.defaultModel` / `defaultReasoning` — image-wide
 *      project default.
 *   3. `HARNESS_IMAGE_DEFAULT_*` — compile-time fallback.
 *
 * Backend precedence is independent: `imageConfig.defaultBackend` →
 * `HARNESS_IMAGE_DEFAULT_BACKEND`. Per-agent backend override is not
 * supported in v0 (would multiply the surface without a concrete use
 * case; revisit when a project pins different backends per skill).
 *
 * Alias resolution reuses `models.codex.aliases` so projects can
 * declare a single alias map (`{ "image-strong": "gpt-5.4-vision-pro" }`)
 * and reference it from both text and image surfaces.
 *
 * Pure function — callers (bin/harness model resolve image-gen, agent
 * Invocation Rules templates) can safely depend on it in tests.
 */
export declare function resolveImageModel(imageConfig: ImageGenerationConfig | undefined, modelsConfig: ModelsConfig | undefined, agentName: string): ImageModelResolution;
export interface ModelsCacheSnapshot {
    models?: Array<{
        slug?: string;
        display_name?: string;
    }>;
    upgrade?: {
        model?: string;
    };
    /**
     * Migration map from `~/.codex/config.toml`'s `[notice.model_migrations]`
     * section. Keys are slugs that will be rewritten to their values by the
     * Codex runtime.
     */
    migrations?: Record<string, string>;
}
export interface DeprecationHit {
    /** Slug that triggered the warning. */
    model: string;
    /**
     * Where the slug was referenced — useful for error messages and
     * `--strict` exit codes that highlight which config knob to update.
     */
    location: "codex.default" | "codex.aliases" | "agents" | "harness-default";
    /** Agent name when `location === "agents"`. */
    agent?: string;
    /** Recommended replacement, if known. */
    suggested?: string;
    reason: "upgrade" | "migration" | "unknown-slug";
}
export interface ModelCheckReport {
    hits: DeprecationHit[];
    /** Effective model slugs that the resolver might emit across all agents. */
    referencedModels: string[];
}
/**
 * Compare the resolved model slugs against a Codex models cache snapshot.
 * Emits deprecation hits when:
 *   - `upgrade.model` names a newer slug (`reason: "upgrade"`)
 *   - `migrations[slug]` maps to another slug (`reason: "migration"`)
 *   - `slug` is absent from `models[].slug` (`reason: "unknown-slug"`)
 *
 * Pure function — callers (bin/harness model check) handle IO.
 */
export declare function checkModels(config: ModelsConfig | undefined, cache: ModelsCacheSnapshot | null): ModelCheckReport;
//# sourceMappingURL=resolver.d.ts.map