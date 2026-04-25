/**
 * core/src/config.ts
 * Harness configuration loader.
 *
 * Reads `harness.config.json` from the project root and merges with defaults.
 * Every guardrail that depends on project-specific values (R10/R11 etc.)
 * reads from the `HarnessConfig` on `RuleContext.config`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { HARNESS_IMAGE_DEFAULT_ASPECT, HARNESS_IMAGE_DEFAULT_BACKEND, HARNESS_IMAGE_DEFAULT_COUNT, HARNESS_IMAGE_DEFAULT_MODEL, HARNESS_IMAGE_DEFAULT_REASONING_EFFORT, VALID_IMAGE_ASPECT_RATIOS, VALID_IMAGE_REASONING_EFFORTS, } from "./models/resolver.js";
// ============================================================
// Defaults
// ============================================================
export const DEFAULT_CONFIG = {
    projectName: "my-project",
    language: "en",
    protectedDirectories: [],
    protectedEnvVarNames: [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "GITHUB_TOKEN",
        "GOOGLE_API_KEY",
    ],
    protectedFileSuffixes: [".env"],
    codex: {
        enabled: false,
        sync: {
            recommendedTaskMaxOutputLength: 160000,
            warnTaskMaxOutputLengthBelow: 32000,
            checkTaskMaxOutputLength: true,
        },
    },
    workMode: { bypassRmRf: false, bypassGitPush: false },
    tampering: { severity: "approve" },
    work: {
        plansFile: "Plans.md",
        // Default markers support ja / en projects. Override via harness.config.json.
        assignmentSectionMarkers: ["担当表", "Assignment", "In Progress"],
        handoffFiles: [],
        maxParallel: 4,
        labelPriority: [],
        criticalLabels: [],
        qualityGates: {
            enforceTddImplement: true,
            enforcePseudoCoderabbit: true,
            enforceRealCoderabbit: true,
            enforceCodexSecondOpinion: true,
        },
        failFast: true,
    },
    security: {
        enabledChecks: [
            "api-key-leak",
            "injection",
            "file-permissions",
            "dependencies",
        ],
    },
    worktree: {
        enabled: "auto",
        maxParallel: 4,
        parentDir: "..",
    },
    tddEnforce: {
        alwaysRequireRedTest: true,
        allowSkipOnDocsTasks: true,
        pseudoCoderabbitProfile: "chill",
        maxCodexReviewRetries: 3,
    },
    codeRabbit: {
        botLogin: "coderabbitai",
        ratelimitCheckWindowMinutes: 15,
        approvedStateAsClear: true,
        maxPseudoLoopIterations: 5,
        proBucketSize: 5,
        proBucketWindowMinutes: 60,
    },
    tooling: {
        // Deliberately excludes `backend/` — plugin ships stack-neutral,
        // projects add their own layout via override.
        pythonCandidateDirs: ["src", "app"],
    },
    release: {
        strategy: "three-branch",
        integrationBranch: "dev",
        productionBranch: "main",
    },
    userPromptSubmit: {
        contextFiles: [],
        maxTotalBytes: 16 * 1024,
        fenceContext: true,
    },
    postToolUseFailure: {
        enabled: true,
        maxErrorLength: 1024,
        correctiveHints: true,
    },
    configChange: {
        enabled: true,
        maxFilePathLength: 256,
        detectSensitivePaths: true,
        blockOnSources: [],
    },
    subagentStart: {
        enabled: true,
        maxIdentifierLength: 128,
        fenceContext: true,
        agentTypeNotes: {},
        maxTotalBytes: 4096,
    },
    imageGeneration: {
        // v0 codex-image-gen backend defaults — image_gen tool dependency
        // on the resolver's `HARNESS_IMAGE_DEFAULT_MODEL` constant (Codex
        // CLI). Future Anthropic or OpenAI SDK backends will
        // add sibling keys; new knobs require schema + resolver coupling
        // so DEFAULT_CONFIG is never the only source of truth.
        defaultBackend: HARNESS_IMAGE_DEFAULT_BACKEND,
        defaultModel: HARNESS_IMAGE_DEFAULT_MODEL,
        defaultReasoning: HARNESS_IMAGE_DEFAULT_REASONING_EFFORT,
        defaultAspect: HARNESS_IMAGE_DEFAULT_ASPECT,
        defaultCount: HARNESS_IMAGE_DEFAULT_COUNT,
        refImageAllowlistPrefixes: [],
    },
    // `models` is intentionally absent from DEFAULT_CONFIG. The compile-time
    // fallback lives in `src/models/resolver.ts` as `HARNESS_DEFAULT_MODEL`
    // so that an unconfigured project surfaces as `source: "harness-default"`
    // in `harness model resolve` output (not `"codex-default"`). Populating
    // `DEFAULT_CONFIG.models` would conflate shipped behaviour with explicit
    // user intent and make `harness model check` unable to flag missing
    // overrides.
};
// ============================================================
// Loader
// ============================================================
/**
 * Deep-merge user config over defaults.
 *
 * Nested objects are merged one level deep (so that unspecified child keys
 * inherit defaults). `work.qualityGates` is merged an extra level deep
 * because flipping one gate should not require re-declaring the others.
 * Arrays are **not** merged — a user-provided array replaces the default
 * wholesale, matching the intuition that config authors own the list.
 *
 * **Security-relevant consequence of the array-wholesale rule**:
 * Overriding `security.enabledChecks` (or any array field) drops the
 * default entries. A config like `{"security": {"enabledChecks": ["api-key-leak"]}}`
 * silently disables the `injection`, `file-permissions`, and `dependencies`
 * baseline checks. Projects customising the list should include every
 * baseline entry they want to keep, not just their additions. The schema's
 * `default` field documents the baseline set.
 *
 * Runtime enum validation for `release.strategy` and
 * `tddEnforce.pseudoCoderabbitProfile` falls back to the DEFAULT_CONFIG
 * value (plus a `stderr` warning) when a non-enum string is supplied —
 * this keeps consumer code (`/harness-release`, `/pseudo-coderabbit-loop`)
 * from having to defensively handle an unexpected fifth case in their
 * switch statements.
 */
function mergeConfig(partial) {
    const partialWork = partial.work ?? {};
    const mergedWork = {
        ...DEFAULT_CONFIG.work,
        ...partialWork,
        qualityGates: {
            ...DEFAULT_CONFIG.work.qualityGates,
            ...(partialWork.qualityGates ?? {}),
        },
    };
    return {
        ...DEFAULT_CONFIG,
        ...partial,
        codex: {
            ...DEFAULT_CONFIG.codex,
            ...(partial.codex ?? {}),
            // codex.sync is nested — merge one level deeper so a partial
            // `{ sync: { checkTaskMaxOutputLength: false } }` override keeps
            // the other two threshold defaults instead of wiping them.
            sync: {
                ...DEFAULT_CONFIG.codex.sync,
                ...(partial.codex?.sync ?? {}),
            },
        },
        workMode: { ...DEFAULT_CONFIG.workMode, ...(partial.workMode ?? {}) },
        tampering: { ...DEFAULT_CONFIG.tampering, ...(partial.tampering ?? {}) },
        work: mergedWork,
        security: { ...DEFAULT_CONFIG.security, ...(partial.security ?? {}) },
        worktree: { ...DEFAULT_CONFIG.worktree, ...(partial.worktree ?? {}) },
        tddEnforce: validateTddEnforce({
            ...DEFAULT_CONFIG.tddEnforce,
            ...(partial.tddEnforce ?? {}),
        }),
        codeRabbit: { ...DEFAULT_CONFIG.codeRabbit, ...(partial.codeRabbit ?? {}) },
        tooling: { ...DEFAULT_CONFIG.tooling, ...(partial.tooling ?? {}) },
        release: validateRelease({
            ...DEFAULT_CONFIG.release,
            ...(partial.release ?? {}),
        }),
        userPromptSubmit: {
            ...DEFAULT_CONFIG.userPromptSubmit,
            ...(partial.userPromptSubmit ?? {}),
        },
        postToolUseFailure: {
            ...DEFAULT_CONFIG.postToolUseFailure,
            ...(partial.postToolUseFailure ?? {}),
        },
        configChange: {
            ...DEFAULT_CONFIG.configChange,
            ...(partial.configChange ?? {}),
        },
        subagentStart: {
            ...DEFAULT_CONFIG.subagentStart,
            ...(partial.subagentStart ?? {}),
            // agentTypeNotes は shallow merge だと `partial` の存在で default {} を上書きするのみ。
            // ただし user 指定の key/value が残り、default の空 {} と union されるので実害なし。
            agentTypeNotes: {
                ...DEFAULT_CONFIG.subagentStart.agentTypeNotes,
                ...(partial.subagentStart?.agentTypeNotes ?? {}),
            },
        },
        imageGeneration: validateImageGeneration(mergeImageGenerationConfig(partial.imageGeneration)),
        ...(() => {
            const merged = mergeModelsConfig(partial.models);
            return merged ? { models: merged } : {};
        })(),
    };
}
/**
 * Deep-merge `models` so per-agent overrides and the codex aliases map
 * inherit sibling defaults. `agents` and `aliases` are merged one level;
 * arrays (none in this config surface) would replace wholesale if added.
 * Returns `undefined` only when *both* default and partial are absent,
 * matching the interface's optional semantics.
 */
function mergeModelsConfig(partial) {
    const base = DEFAULT_CONFIG.models;
    if (!base && !partial)
        return undefined;
    const mergedCodex = base?.codex || partial?.codex
        ? {
            ...(base?.codex ?? {}),
            ...(partial?.codex ?? {}),
            aliases: {
                ...(base?.codex?.aliases ?? {}),
                ...(partial?.codex?.aliases ?? {}),
            },
        }
        : undefined;
    // Drop the aliases key when both sides were absent so the merged shape
    // matches "absent" rather than "present-but-empty".
    const finalCodex = mergedCodex &&
        (mergedCodex.aliases && Object.keys(mergedCodex.aliases).length === 0)
        ? (() => {
            const { aliases: _aliases, ...rest } = mergedCodex;
            return rest;
        })()
        : mergedCodex;
    const mergedAgents = {
        ...(base?.agents ?? {}),
        ...(partial?.agents ?? {}),
    };
    const result = {};
    if (finalCodex)
        result.codex = finalCodex;
    if (Object.keys(mergedAgents).length > 0)
        result.agents = mergedAgents;
    return result;
}
/**
 * Guard against `pseudoCoderabbitProfile` being set to a string outside
 * the allowed union (e.g. a typo like `"strict1"` or an older profile
 * name). Falls back to the default and writes a single warning line to
 * stderr so consumers (pseudo-coderabbit-loop) never need a fifth
 * `default:` branch in their switch.
 */
const VALID_CODERABBIT_PROFILES = [
    "chill",
    "assertive",
    "strict",
];
function validateTddEnforce(cfg) {
    if (!VALID_CODERABBIT_PROFILES.includes(cfg.pseudoCoderabbitProfile)) {
        process.stderr.write(`[harness config] tddEnforce.pseudoCoderabbitProfile=${JSON.stringify(cfg.pseudoCoderabbitProfile)} is not one of ${JSON.stringify(VALID_CODERABBIT_PROFILES)}; falling back to "${DEFAULT_CONFIG.tddEnforce.pseudoCoderabbitProfile}".\n`);
        return {
            ...cfg,
            pseudoCoderabbitProfile: DEFAULT_CONFIG.tddEnforce.pseudoCoderabbitProfile,
        };
    }
    return cfg;
}
// `VALID_IMAGE_REASONING_EFFORTS` and `VALID_IMAGE_ASPECT_RATIOS` are
// imported from `./models/resolver.js` at the top of this file —
// resolver.ts is the canonical source of truth so the runtime allowlist
// tracks the type union without manual sync (avoiding a divergence
// hazard where one file silently extends the union without the other).
/**
 * Type-guard the user-supplied `imageGeneration` partial before
 * spreading it over `DEFAULT_CONFIG.imageGeneration`. Without this
 * guard, malformed shapes (`null`, `42`, `"oops"`, `[]`, etc.) would
 * silently spread as `{}` (or worse, splice array indices into the
 * merged object) and the user would never learn that their config
 * was ignored.
 *
 */
function mergeImageGenerationConfig(partial) {
    if (partial === undefined) {
        return { ...DEFAULT_CONFIG.imageGeneration };
    }
    if (partial === null ||
        typeof partial !== "object" ||
        Array.isArray(partial)) {
        process.stderr.write(`[harness config] imageGeneration=${sanitiseConfigValueForStderr(partial)} must be a JSON object; falling back to defaults.\n`);
        return { ...DEFAULT_CONFIG.imageGeneration };
    }
    return {
        ...DEFAULT_CONFIG.imageGeneration,
        ...partial,
    };
}
/**
 * Sanitise a value before writing it to stderr. The user-supplied input
 * may carry ANSI escape sequences, NUL bytes, or other C0 / DEL / C1
 * control characters that downstream log scrapers would interpret as
 * terminal cursor / colour controls. Replace them with `?` so the
 * report stays readable and audit-safe.
 *
 */
function sanitiseConfigValueForStderr(value) {
    return JSON.stringify(value).replace(
    // C0 (excluding LF / CR / TAB which JSON.stringify already escapes
    // to \\n / \\r / \\t) + DEL + C1 range. Anything that survives is
    // printable ASCII or properly escaped Unicode.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "?");
}
/**
 * Guard against `imageGeneration.defaultReasoning` / `defaultAspect` /
 * `defaultCount` / `refImageAllowlistPrefixes` carrying invalid shapes.
 * Falls back to the default for the offending field (rather than
 * rejecting the whole section) so a malformed knob does not pull down
 * adjacent valid overrides.
 *
 * - **defaultReasoning** / **defaultAspect**: enum check, fall back to
 *   `DEFAULT_CONFIG.imageGeneration.*`.
 * - **defaultCount**: integer in [1, 16]. Schema enforces this for
 *   schema-aware tools, but the loader runs before schema validation
 *   so we duplicate the range check here as a runtime guard.
 * - **refImageAllowlistPrefixes**: each entry must be a non-empty
 *   absolute path string without `..` segments or control characters.
 *   Invalid entries are dropped (preserving the rest of the array).
 *
 * stderr output uses `sanitiseConfigValueForStderr` so attacker-
 * controlled values cannot inject ANSI escape codes / NUL bytes into
 * harness diagnostics.
 */
function validateImageGeneration(cfg) {
    let next = cfg;
    if (!VALID_IMAGE_REASONING_EFFORTS.includes(next.defaultReasoning)) {
        process.stderr.write(`[harness config] imageGeneration.defaultReasoning=${sanitiseConfigValueForStderr(next.defaultReasoning)} is not one of ${JSON.stringify(VALID_IMAGE_REASONING_EFFORTS)}; falling back to "${DEFAULT_CONFIG.imageGeneration.defaultReasoning}".\n`);
        next = {
            ...next,
            defaultReasoning: DEFAULT_CONFIG.imageGeneration.defaultReasoning,
        };
    }
    if (!VALID_IMAGE_ASPECT_RATIOS.includes(next.defaultAspect)) {
        process.stderr.write(`[harness config] imageGeneration.defaultAspect=${sanitiseConfigValueForStderr(next.defaultAspect)} is not one of ${JSON.stringify(VALID_IMAGE_ASPECT_RATIOS)}; falling back to "${DEFAULT_CONFIG.imageGeneration.defaultAspect}".\n`);
        next = {
            ...next,
            defaultAspect: DEFAULT_CONFIG.imageGeneration.defaultAspect,
        };
    }
    // defaultBackend basename guard. Backend script names resolve
    // against `${SKILL_DIR}/scripts/backends/<name>.sh` at invocation
    // time — a value containing path separators or `..` segments could
    // escape the backends directory and execute arbitrary scripts.
    // Reject malformed values (path separators / control chars / empty
    // / whitespace-only) at load time and fall back to the shipped
    // backend.
    if (typeof next.defaultBackend !== "string" ||
        next.defaultBackend.trim().length === 0 ||
        next.defaultBackend.includes("/") ||
        next.defaultBackend.includes("\\") ||
        next.defaultBackend.split(/[\\/]/).some((seg) => seg === "..") ||
        /[\x00-\x1f\x7f-\x9f]/.test(next.defaultBackend)) {
        process.stderr.write(`[harness config] imageGeneration.defaultBackend=${sanitiseConfigValueForStderr(next.defaultBackend)} must be a non-empty basename without path separators or control characters; falling back to "${DEFAULT_CONFIG.imageGeneration.defaultBackend}".\n`);
        next = {
            ...next,
            defaultBackend: DEFAULT_CONFIG.imageGeneration.defaultBackend,
        };
    }
    else if (next.defaultBackend !== next.defaultBackend.trim()) {
        // Surrounding whitespace is benign; normalise so downstream
        // consumers do not see padded backend names.
        next = { ...next, defaultBackend: next.defaultBackend.trim() };
    }
    // defaultCount range guard. Schema declares minimum 1 / maximum 16
    // but loadConfig runs before schema validation, so re-enforce here.
    if (typeof next.defaultCount !== "number" ||
        !Number.isInteger(next.defaultCount) ||
        next.defaultCount < 1 ||
        next.defaultCount > 16) {
        process.stderr.write(`[harness config] imageGeneration.defaultCount=${sanitiseConfigValueForStderr(next.defaultCount)} is not an integer in [1, 16]; falling back to ${DEFAULT_CONFIG.imageGeneration.defaultCount}.\n`);
        next = {
            ...next,
            defaultCount: DEFAULT_CONFIG.imageGeneration.defaultCount,
        };
    }
    // refImageAllowlistPrefixes element guard. Drop any entry that is
    // not a non-empty absolute path without `..` segments or control
    // characters. Falls through to the default (empty array) when the
    // entire input is malformed (non-array).
    if (!Array.isArray(next.refImageAllowlistPrefixes)) {
        process.stderr.write(`[harness config] imageGeneration.refImageAllowlistPrefixes=${sanitiseConfigValueForStderr(next.refImageAllowlistPrefixes)} is not an array; falling back to ${JSON.stringify(DEFAULT_CONFIG.imageGeneration.refImageAllowlistPrefixes)}.\n`);
        next = {
            ...next,
            refImageAllowlistPrefixes: DEFAULT_CONFIG.imageGeneration.refImageAllowlistPrefixes,
        };
    }
    else {
        const dropped = [];
        const cleanPrefixes = [];
        for (let i = 0; i < next.refImageAllowlistPrefixes.length; i += 1) {
            const entry = next.refImageAllowlistPrefixes[i];
            if (typeof entry === "string" &&
                entry.length > 0 &&
                // Cross-platform absolute-path detection. node:path's
                // `isAbsolute` covers POSIX (`/foo`), Windows drive letters
                // (`C:\foo`), and UNC paths (`\\server\share`).
                isAbsolute(entry) &&
                // No traversal *segments*. Splitting on both POSIX (`/`) and
                // Windows (`\\`) separators lets a legitimate filename like
                // `foo..bar` survive while the `..` segment (the actual path-
                // traversal vector) is rejected on either platform.
                !entry.split(/[\\/]/).some((segment) => segment === "..") &&
                // No control characters / NUL byte / DEL / C1 range — these
                // would confuse downstream path comparison and log output.
                !/[\x00-\x1f\x7f-\x9f]/.test(entry)) {
                cleanPrefixes.push(entry);
            }
            else {
                dropped.push(i);
            }
        }
        if (dropped.length > 0) {
            process.stderr.write(`[harness config] imageGeneration.refImageAllowlistPrefixes dropped ${dropped.length} invalid entr${dropped.length === 1 ? "y" : "ies"} (indices ${JSON.stringify(dropped)}); each entry must be a non-empty absolute path without ".." segments or control characters.\n`);
            next = {
                ...next,
                refImageAllowlistPrefixes: cleanPrefixes,
            };
        }
    }
    return next;
}
const VALID_RELEASE_STRATEGIES = [
    "two-branch",
    "three-branch",
];
function validateRelease(cfg) {
    if (!VALID_RELEASE_STRATEGIES.includes(cfg.strategy)) {
        process.stderr.write(`[harness config] release.strategy=${JSON.stringify(cfg.strategy)} is not one of ${JSON.stringify(VALID_RELEASE_STRATEGIES)}; falling back to "${DEFAULT_CONFIG.release.strategy}".\n`);
        return { ...cfg, strategy: DEFAULT_CONFIG.release.strategy };
    }
    return cfg;
}
/**
 * Load harness config from `<projectRoot>/harness.config.json`.
 * Returns defaults if the file does not exist.
 * Throws if the file exists but is not valid JSON **or** if the parsed
 * value is not a JSON object (e.g. `42`, `[]`, `null`) — callers should
 * be prepared to fall back to defaults via a try/catch if they prefer
 * fail-open behaviour.
 */
export function loadConfig(projectRoot) {
    const path = resolve(projectRoot, "harness.config.json");
    if (!existsSync(path))
        return DEFAULT_CONFIG;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)) {
        throw new Error(`harness.config.json must be a JSON object (got ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed})`);
    }
    return mergeConfig(parsed);
}
/**
 * Fail-open variant: returns defaults when the file is missing, unreadable,
 * or malformed. Used by the guardrail hook path where any error in config
 * loading must not break tool execution.
 *
 * This variant **silently** swallows errors. Hooks that need to
 * distinguish "config absent" from "config broken" (so they can emit a
 * diagnostic rather than silently applying defaults) should use
 * `loadConfigWithError()` instead.
 */
export function loadConfigSafe(projectRoot) {
    try {
        return loadConfig(projectRoot);
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
/**
 * Load harness config and surface any parse error to the caller.
 *
 * - File absent ⇒ `{ config: DEFAULT_CONFIG }` (no error).
 * - File present and parses OK ⇒ `{ config: <merged> }` (no error).
 * - File present but parse / shape error ⇒ `{ config: DEFAULT_CONFIG, error }`.
 *
 * The implementation is the same as `loadConfigSafe()` plus the error
 * surfacing. Hooks that previously suppressed the error and quietly ran
 * with defaults (e.g. `stop.ts` emitting every quality-gate reminder
 * because `mergeConfig` filled in `qualityGates=true` defaults) should
 * use this to **refuse** to act on defaults when a broken config
 * explicitly fell through.
 */
export function loadConfigWithError(projectRoot) {
    const path = resolve(projectRoot, "harness.config.json");
    if (!existsSync(path)) {
        // File absent is not an error. Caller decides whether to act on defaults.
        return { config: DEFAULT_CONFIG };
    }
    try {
        return { config: loadConfig(projectRoot) };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { config: DEFAULT_CONFIG, error: message };
    }
}
//# sourceMappingURL=config.js.map