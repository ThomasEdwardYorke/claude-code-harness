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
};
// ============================================================
// Loader
// ============================================================
/** Deep-merge user config over defaults (shallow for scalar fields). */
function mergeConfig(partial) {
    return {
        ...DEFAULT_CONFIG,
        ...partial,
        codex: { ...DEFAULT_CONFIG.codex, ...(partial.codex ?? {}) },
        workMode: { ...DEFAULT_CONFIG.workMode, ...(partial.workMode ?? {}) },
        tampering: { ...DEFAULT_CONFIG.tampering, ...(partial.tampering ?? {}) },
    };
}
/**
 * Load harness config from `<projectRoot>/harness.config.json`.
 * Returns defaults if the file does not exist.
 * Throws if the file exists but is not valid JSON — callers should be
 * prepared to fall back to defaults via a try/catch if they prefer
 * fail-open behaviour.
 */
export function loadConfig(projectRoot) {
    const path = resolve(projectRoot, "harness.config.json");
    if (!existsSync(path))
        return DEFAULT_CONFIG;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return mergeConfig(parsed);
}
/**
 * Fail-open variant: returns defaults when the file is missing, unreadable,
 * or malformed. Used by the guardrail hook path where any error in config
 * loading must not break tool execution.
 */
export function loadConfigSafe(projectRoot) {
    try {
        return loadConfig(projectRoot);
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
//# sourceMappingURL=config.js.map