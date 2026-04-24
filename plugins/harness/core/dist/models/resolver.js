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
/**
 * Compile-time default. `gpt-5.5` chosen because OpenAI released it on
 * 2026-04-24 (same day as this module's introduction) with broader coding
 * coverage than `gpt-5.4`. Changing this constant is a breaking change —
 * prefer per-project override via `harness.config.json`.
 */
export const HARNESS_DEFAULT_MODEL = "gpt-5.5";
export const HARNESS_DEFAULT_REASONING_EFFORT = "medium";
export const VALID_REASONING_EFFORTS = [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];
/**
 * Normalise variations in agent names so that both
 * `resolveModel(config, "codex-sync")` and
 * `resolveModel(config, "harness:codex-sync.md")` agree on a single key.
 * Strips `harness:` prefix and `.md` suffix, leaves hyphens intact.
 */
export function normalizeAgentName(name) {
    return String(name ?? "")
        .trim()
        .replace(/^harness:/i, "")
        .replace(/\.md$/i, "");
}
function resolveAlias(config, candidate) {
    const aliases = config?.codex?.aliases;
    if (aliases && Object.prototype.hasOwnProperty.call(aliases, candidate)) {
        return { concrete: aliases[candidate], alias: candidate };
    }
    return { concrete: candidate };
}
function pickReasoningEffort(overrides) {
    for (const candidate of overrides) {
        if (candidate && VALID_REASONING_EFFORTS.includes(candidate)) {
            return candidate;
        }
    }
    return HARNESS_DEFAULT_REASONING_EFFORT;
}
export function resolveModel(config, agentName) {
    const normalizedAgent = normalizeAgentName(agentName);
    const agentCfg = config?.agents?.[normalizedAgent];
    const codexCfg = config?.codex;
    // 1. Per-agent override
    if (agentCfg?.model) {
        const { concrete, alias } = resolveAlias(config, agentCfg.model);
        return {
            model: concrete,
            reasoningEffort: pickReasoningEffort([
                agentCfg.reasoningEffort,
                codexCfg?.reasoningEffort,
            ]),
            source: "agent-override",
            aliasResolved: alias !== undefined,
            ...(alias !== undefined ? { aliasName: alias } : {}),
        };
    }
    // 2. Harness-level codex default
    if (codexCfg?.default) {
        const { concrete, alias } = resolveAlias(config, codexCfg.default);
        return {
            model: concrete,
            reasoningEffort: pickReasoningEffort([codexCfg.reasoningEffort]),
            source: "codex-default",
            aliasResolved: alias !== undefined,
            ...(alias !== undefined ? { aliasName: alias } : {}),
        };
    }
    // 3. Compile-time fallback
    return {
        model: HARNESS_DEFAULT_MODEL,
        reasoningEffort: HARNESS_DEFAULT_REASONING_EFFORT,
        source: "harness-default",
        aliasResolved: false,
    };
}
function collectReferencedSlugs(config) {
    const out = new Set();
    const codexDefault = config?.codex?.default;
    if (codexDefault) {
        const { concrete } = resolveAlias(config, codexDefault);
        out.add(concrete);
    }
    const aliases = config?.codex?.aliases;
    if (aliases) {
        for (const target of Object.values(aliases)) {
            if (target)
                out.add(target);
        }
    }
    const agents = config?.agents;
    if (agents) {
        for (const [, agentCfg] of Object.entries(agents)) {
            if (agentCfg?.model) {
                const { concrete } = resolveAlias(config, agentCfg.model);
                out.add(concrete);
            }
        }
    }
    if (out.size === 0)
        out.add(HARNESS_DEFAULT_MODEL);
    return Array.from(out);
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
export function checkModels(config, cache) {
    const referencedModels = collectReferencedSlugs(config);
    const hits = [];
    if (!cache)
        return { hits, referencedModels };
    const knownSlugs = new Set((cache.models ?? [])
        .map((m) => m.slug)
        .filter((slug) => typeof slug === "string"));
    const migrations = cache.migrations ?? {};
    const upgradeSlug = cache.upgrade?.model;
    function locate(slug) {
        if (config?.codex?.default) {
            const { concrete } = resolveAlias(config, config.codex.default);
            if (concrete === slug)
                return { location: "codex.default" };
        }
        const aliases = config?.codex?.aliases;
        if (aliases) {
            for (const [, target] of Object.entries(aliases)) {
                if (target === slug)
                    return { location: "codex.aliases" };
            }
        }
        const agents = config?.agents;
        if (agents) {
            for (const [agentName, agentCfg] of Object.entries(agents)) {
                if (!agentCfg?.model)
                    continue;
                const { concrete } = resolveAlias(config, agentCfg.model);
                if (concrete === slug)
                    return { location: "agents", agent: agentName };
            }
        }
        return { location: "harness-default" };
    }
    for (const slug of referencedModels) {
        const { location, agent } = locate(slug);
        const agentTag = agent !== undefined ? { agent } : {};
        if (upgradeSlug &&
            slug !== upgradeSlug &&
            knownSlugs.has(upgradeSlug)) {
            hits.push({
                model: slug,
                location,
                ...agentTag,
                suggested: upgradeSlug,
                reason: "upgrade",
            });
        }
        const migrationTarget = migrations[slug];
        if (migrationTarget && migrationTarget !== slug) {
            hits.push({
                model: slug,
                location,
                ...agentTag,
                suggested: migrationTarget,
                reason: "migration",
            });
        }
        if (knownSlugs.size > 0 && !knownSlugs.has(slug)) {
            hits.push({
                model: slug,
                location,
                ...agentTag,
                reason: "unknown-slug",
            });
        }
    }
    return { hits, referencedModels };
}
//# sourceMappingURL=resolver.js.map