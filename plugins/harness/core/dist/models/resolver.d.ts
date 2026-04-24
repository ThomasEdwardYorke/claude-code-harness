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