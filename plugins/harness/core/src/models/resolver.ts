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

export type ReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

/**
 * Compile-time default. `gpt-5.5` chosen because OpenAI released it on
 * 2026-04-24 (same day as this module's introduction) with broader coding
 * coverage than `gpt-5.4`. Changing this constant is a breaking change —
 * prefer per-project override via `harness.config.json`.
 */
export const HARNESS_DEFAULT_MODEL = "gpt-5.5";
export const HARNESS_DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export const VALID_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

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

export type ResolutionSource =
  | "agent-override"
  | "codex-default"
  | "harness-default";

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
export function normalizeAgentName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/^harness:/i, "")
    .replace(/\.md$/i, "");
}

function resolveAlias(
  config: ModelsConfig | undefined,
  candidate: string,
): { concrete: string; alias?: string } {
  const aliases = config?.codex?.aliases;
  if (aliases && Object.prototype.hasOwnProperty.call(aliases, candidate)) {
    return { concrete: aliases[candidate]!, alias: candidate };
  }
  return { concrete: candidate };
}

function pickReasoningEffort(
  overrides: Array<ReasoningEffort | undefined>,
): ReasoningEffort {
  for (const candidate of overrides) {
    if (candidate && VALID_REASONING_EFFORTS.includes(candidate)) {
      return candidate;
    }
  }
  return HARNESS_DEFAULT_REASONING_EFFORT;
}

export function resolveModel(
  config: ModelsConfig | undefined,
  agentName: string,
): ModelResolution {
  const normalizedAgent = normalizeAgentName(agentName);
  const agentCfg = config?.agents?.[normalizedAgent];
  const codexCfg = config?.codex;

  // Resolve the model tier independently of reasoningEffort so that an
  // agent override which only supplies `reasoningEffort` (no `model`) is
  // honoured rather than silently dropped at the `if (agentCfg?.model)`
  // branch. Effort precedence still runs agent > codex > harness-default.
  let model: string;
  let modelSource: ResolutionSource;
  let aliasName: string | undefined;

  if (agentCfg?.model) {
    const { concrete, alias } = resolveAlias(config, agentCfg.model);
    model = concrete;
    modelSource = "agent-override";
    aliasName = alias;
  } else if (codexCfg?.default) {
    const { concrete, alias } = resolveAlias(config, codexCfg.default);
    model = concrete;
    modelSource = "codex-default";
    aliasName = alias;
  } else {
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
  const hasValidAgentEffort =
    agentCfg?.reasoningEffort !== undefined &&
    VALID_REASONING_EFFORTS.includes(
      agentCfg.reasoningEffort as ReasoningEffort,
    );
  const source: ResolutionSource =
    modelSource !== "agent-override" && hasValidAgentEffort
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

// ============================================================
// Deprecation / migration check
// ============================================================

export interface ModelsCacheSnapshot {
  models?: Array<{ slug?: string; display_name?: string }>;
  upgrade?: { model?: string };
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
  location:
    | "codex.default"
    | "codex.aliases"
    | "agents"
    | "harness-default";
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

interface SlugReference {
  slug: string;
  location: DeprecationHit["location"];
  agent?: string;
}

/**
 * Emit every (slug, location) pair the resolver might hand out. Duplicates
 * are preserved — a slug referenced in both `codex.default` and an
 * `agents[*].model` override yields two references so consumers of
 * `checkModels` see where each usage lives (rather than collapsing them
 * into a single dedup hit).
 */
function collectReferences(config: ModelsConfig | undefined): SlugReference[] {
  const out: SlugReference[] = [];
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
export function checkModels(
  config: ModelsConfig | undefined,
  cache: ModelsCacheSnapshot | null,
): ModelCheckReport {
  const references = collectReferences(config);
  const referencedModels = Array.from(
    new Set(references.map((r) => r.slug)),
  );
  const hits: DeprecationHit[] = [];

  if (!cache) return { hits, referencedModels };

  const knownSlugs = new Set<string>(
    (cache.models ?? [])
      .map((m) => m.slug)
      .filter((slug): slug is string => typeof slug === "string"),
  );
  const migrations = cache.migrations ?? {};
  const upgradeSlug = cache.upgrade?.model;

  for (const ref of references) {
    const agentTag: Pick<DeprecationHit, "agent"> | object =
      ref.agent !== undefined ? { agent: ref.agent } : {};
    // `upgrade` hits only fire when the referenced slug is *known* to the
    // cache and distinct from the upgrade target. This avoids false
    // positives where a typo or unreleased slug would otherwise be
    // flagged as "older than upgrade target" instead of "unknown-slug".
    if (
      upgradeSlug &&
      ref.slug !== upgradeSlug &&
      knownSlugs.has(upgradeSlug) &&
      knownSlugs.has(ref.slug)
    ) {
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
