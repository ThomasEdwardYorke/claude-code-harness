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
// Type definitions
// ============================================================

export type HarnessLanguage = "en" | "ja";
export type TamperingSeverity = "approve" | "ask" | "deny";

export interface CodexConfig {
  /** Whether the codex-sync agent path resolution is active. */
  enabled: boolean;
  /**
   * Absolute path to the installed codex plugin root (e.g.
   * `${HOME}/.claude/plugins/cache/openai-codex/codex/1.0.2`).
   * If omitted, `harness doctor` auto-detects the latest version.
   */
  pluginRoot?: string;
}

export interface WorkModeConfig {
  /** If true, R05 (rm -rf confirmation) is bypassed in work mode. */
  bypassRmRf: boolean;
  /** If true, `git push --force` warnings are downgraded in work mode. */
  bypassGitPush: boolean;
}

export interface TamperingConfig {
  /** Decision returned when tampering patterns are detected. */
  severity: TamperingSeverity;
}

export interface HarnessConfig {
  /** Human-readable project name (shown in messages). */
  projectName: string;
  /** Language used for messages when a localized form is available. */
  language: HarnessLanguage;
  /**
   * Directory names that R10 refuses to delete via `rm`/`rmdir`/`unlink`.
   * Empty array disables R10 entirely (default).
   */
  protectedDirectories: string[];
  /**
   * Environment-variable names that R11 blocks from appearing in Bash
   * commands. Empty array disables R11 entirely.
   */
  protectedEnvVarNames: string[];
  /**
   * File suffixes whose direct access (cat/head/tail/…) is blocked by R13.
   * Defaults to [".env"].
   */
  protectedFileSuffixes: string[];
  codex: CodexConfig;
  workMode: WorkModeConfig;
  tampering: TamperingConfig;
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG: HarnessConfig = {
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
function mergeConfig(partial: Partial<HarnessConfig>): HarnessConfig {
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
export function loadConfig(projectRoot: string): HarnessConfig {
  const path = resolve(projectRoot, "harness.config.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Partial<HarnessConfig>;
  return mergeConfig(parsed);
}

/**
 * Fail-open variant: returns defaults when the file is missing, unreadable,
 * or malformed. Used by the guardrail hook path where any error in config
 * loading must not break tool execution.
 */
export function loadConfigSafe(projectRoot: string): HarnessConfig {
  try {
    return loadConfig(projectRoot);
  } catch {
    return DEFAULT_CONFIG;
  }
}
