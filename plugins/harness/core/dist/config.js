/* generality-exemption: B-10 | HARNESS-model-registry | 2099-12-31 | DEFAULT_CONFIG carries the literal HARNESS_DEFAULT_MODEL slug by design */
/**
 * core/src/config.ts
 * Harness configuration loader.
 *
 * Reads `harness.config.json` from the project root and merges with defaults.
 * Every guardrail that depends on project-specific values (R10/R11 etc.)
 * reads from the `HarnessConfig` on `RuleContext.config`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    codex: { enabled: false },
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
    models: {
        codex: {
            default: "gpt-5.5",
            reasoningEffort: "medium",
        },
    },
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
        codex: { ...DEFAULT_CONFIG.codex, ...(partial.codex ?? {}) },
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