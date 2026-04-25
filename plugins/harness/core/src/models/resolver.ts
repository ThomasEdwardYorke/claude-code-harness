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
// Image generation resolver (run-ai-images / ai-image-edit)
// ============================================================

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
export const HARNESS_IMAGE_DEFAULT_MODEL = "gpt-5.4";
export const HARNESS_IMAGE_DEFAULT_REASONING_EFFORT: ImageReasoningEffort =
  "medium";
export const HARNESS_IMAGE_DEFAULT_BACKEND = "codex-image-gen";
export const HARNESS_IMAGE_DEFAULT_ASPECT: ImageAspectRatio = "1:1";
export const HARNESS_IMAGE_DEFAULT_COUNT = 4;

export const VALID_IMAGE_REASONING_EFFORTS: readonly ImageReasoningEffort[] = [
  "medium",
  "high",
] as const;

export const VALID_IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[] = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
] as const;

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

export type ImageResolutionSource =
  | "agent-override"
  | "image-default"
  | "harness-default";

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

function pickImageReasoningEffort(
  candidate: string | undefined,
): ImageReasoningEffort | undefined {
  if (
    candidate &&
    VALID_IMAGE_REASONING_EFFORTS.includes(candidate as ImageReasoningEffort)
  ) {
    return candidate as ImageReasoningEffort;
  }
  return undefined;
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
export function resolveImageModel(
  imageConfig: ImageGenerationConfig | undefined,
  modelsConfig: ModelsConfig | undefined,
  agentName: string,
): ImageModelResolution {
  const normalizedAgent = normalizeAgentName(agentName);
  const agentCfg = modelsConfig?.agents?.[normalizedAgent];

  // Resolve model + source.
  let model: string;
  let modelSource: ImageResolutionSource;
  let aliasName: string | undefined;

  if (agentCfg?.model) {
    const { concrete, alias } = resolveAlias(modelsConfig, agentCfg.model);
    model = concrete;
    modelSource = "agent-override";
    aliasName = alias;
  } else if (imageConfig?.defaultModel) {
    const { concrete, alias } = resolveAlias(
      modelsConfig,
      imageConfig.defaultModel,
    );
    model = concrete;
    modelSource = "image-default";
    aliasName = alias;
  } else {
    model = HARNESS_IMAGE_DEFAULT_MODEL;
    modelSource = "harness-default";
    aliasName = undefined;
  }

  // Resolve reasoningEffort. Agent override (if valid for image surface)
  // > image-default > harness-default. Invalid values are silently
  // dropped and the chain continues — matches resolveModel's behaviour
  // for bad effort values.
  const agentEffort = pickImageReasoningEffort(agentCfg?.reasoningEffort);
  const imageEffort = pickImageReasoningEffort(imageConfig?.defaultReasoning);
  const reasoningEffort: ImageReasoningEffort =
    agentEffort ?? imageEffort ?? HARNESS_IMAGE_DEFAULT_REASONING_EFFORT;

  // Source promotion: if the model came from the image-default / harness-
  // default chain BUT the agent supplied a valid reasoningEffort, lift
  // the source to "agent-override" so `harness model resolve image-gen`
  // surfaces the per-agent customisation. Mirrors resolveModel's
  // hasValidAgentEffort guard.
  const source: ImageResolutionSource =
    modelSource !== "agent-override" && agentEffort !== undefined
      ? "agent-override"
      : modelSource;

  // Backend resolution is independent — agent overrides do not (yet)
  // touch the backend. An empty string is rejected as well as undefined
  // (an empty backend would resolve to a non-existent script
  // `${SKILL_DIR}/scripts/backends/.sh`, which is worse than falling
  // back to the shipped default). Codex adversarial NITPICK 2026-04-25.
  const backend =
    typeof imageConfig?.defaultBackend === "string" &&
    imageConfig.defaultBackend.length > 0
      ? imageConfig.defaultBackend
      : HARNESS_IMAGE_DEFAULT_BACKEND;

  return {
    model,
    reasoningEffort,
    backend,
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
