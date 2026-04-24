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
    // Resolve the model tier independently of reasoningEffort so that an
    // agent override which only supplies `reasoningEffort` (no `model`) is
    // honoured rather than silently dropped at the `if (agentCfg?.model)`
    // branch. Effort precedence still runs agent > codex > harness-default.
    let model;
    let modelSource;
    let aliasName;
    if (agentCfg?.model) {
        const { concrete, alias } = resolveAlias(config, agentCfg.model);
        model = concrete;
        modelSource = "agent-override";
        aliasName = alias;
    }
    else if (codexCfg?.default) {
        const { concrete, alias } = resolveAlias(config, codexCfg.default);
        model = concrete;
        modelSource = "codex-default";
        aliasName = alias;
    }
    else {
        model = HARNESS_DEFAULT_MODEL;
        modelSource = "harness-default";
        aliasName = undefined;
    }
    const reasoningEffort = pickReasoningEffort([
        agentCfg?.reasoningEffort,
        codexCfg?.reasoningEffort,
    ]);
    // When the only agent-side override is a *valid* `reasoningEffort`,
    // promote `source` to `agent-override` so `harness model resolve`
    // reflects the per-agent customisation. Unknown / malformed effort
    // values fall back to the chain default, so they must not inflate
    // the source either.
    const hasValidAgentEffort = agentCfg?.reasoningEffort !== undefined &&
        VALID_REASONING_EFFORTS.includes(agentCfg.reasoningEffort);
    const source = modelSource !== "agent-override" && hasValidAgentEffort
        ? "agent-override"
        : modelSource;
    return {
        model,
        reasoningEffort,
        source,
        aliasResolved: aliasName !== undefined,
        ...(aliasName !== undefined ? { aliasName } : {}),
    };
}
/**
 * Emit every (slug, location) pair the resolver might hand out. Duplicates
 * are preserved — a slug referenced in both `codex.default` and an
 * `agents[*].model` override yields two references so consumers of
 * `checkModels` see where each usage lives (rather than collapsing them
 * into a single dedup hit).
 */
function collectReferences(config) {
    const out = [];
    const codexDefault = config?.codex?.default;
    if (codexDefault) {
        const { concrete } = resolveAlias(config, codexDefault);
        out.push({ slug: concrete, location: "codex.default" });
    }
    const agents = config?.agents;
    if (agents) {
        for (const [agentName, agentCfg] of Object.entries(agents)) {
            if (agentCfg?.model) {
                const { concrete } = resolveAlias(config, agentCfg.model);
                out.push({
                    slug: concrete,
                    location: "agents",
                    agent: agentName,
                });
            }
        }
    }
    // `codex.aliases` is intentionally NOT iterated here. An alias that is
    // not referenced by `codex.default` or any `agents[*].model` is an
    // unused tier declaration — surfacing its target as a "referenced
    // model" would make `harness model check` flag slugs that the
    // resolver will never actually hand out. When an alias IS used, the
    // alias target flows into `out` via `resolveAlias()` on the
    // `codex.default` / agent-model path above, so it is still tracked
    // without double-counting orphan entries.
    if (out.length === 0) {
        out.push({ slug: HARNESS_DEFAULT_MODEL, location: "harness-default" });
    }
    return out;
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
    const references = collectReferences(config);
    const referencedModels = Array.from(new Set(references.map((r) => r.slug)));
    const hits = [];
    if (!cache)
        return { hits, referencedModels };
    const knownSlugs = new Set((cache.models ?? [])
        .map((m) => m.slug)
        .filter((slug) => typeof slug === "string"));
    const migrations = cache.migrations ?? {};
    const upgradeSlug = cache.upgrade?.model;
    for (const ref of references) {
        const agentTag = ref.agent !== undefined ? { agent: ref.agent } : {};
        // `upgrade` hits only fire when the referenced slug is *known* to the
        // cache and distinct from the upgrade target. This avoids false
        // positives where a typo or unreleased slug would otherwise be
        // flagged as "older than upgrade target" instead of "unknown-slug".
        if (upgradeSlug &&
            ref.slug !== upgradeSlug &&
            knownSlugs.has(upgradeSlug) &&
            knownSlugs.has(ref.slug)) {
            hits.push({
                model: ref.slug,
                location: ref.location,
                ...agentTag,
                suggested: upgradeSlug,
                reason: "upgrade",
            });
        }
        const migrationTarget = migrations[ref.slug];
        if (migrationTarget && migrationTarget !== ref.slug) {
            hits.push({
                model: ref.slug,
                location: ref.location,
                ...agentTag,
                suggested: migrationTarget,
                reason: "migration",
            });
        }
        if (knownSlugs.size > 0 && !knownSlugs.has(ref.slug)) {
            hits.push({
                model: ref.slug,
                location: ref.location,
                ...agentTag,
                reason: "unknown-slug",
            });
        }
    }
    return { hits, referencedModels };
}
//# sourceMappingURL=resolver.js.map