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
  /**
   * If true, R05 (`rm -rf` interactive confirmation) is bypassed when
   * harness is invoked in work mode. Intended for trusted agent workflows
   * that need non-interactive destructive cleanup (e.g. automated test
   * scratch directories). Leaves R10 (`protectedDirectories`) intact —
   * those directories are still refused.
   */
  bypassRmRf: boolean;
  /**
   * If true, the `git push --force` warning surfaced by R06 is downgraded
   * in work mode (the push itself is still executed, but the prompt is
   * skipped). Leaves main/master push protection rules elsewhere intact.
   */
  bypassGitPush: boolean;
}

export interface TamperingConfig {
  /** Decision returned when tampering patterns are detected. */
  severity: TamperingSeverity;
}

/**
 * Per-project override of harness quality gates consumed by `stop.ts` to
 * emit end-of-turn reminders. Each flag corresponds to a phase in
 * `/tdd-implement` and `/harness-work`.
 */
export interface QualityGatesConfig {
  /** Phase 2-3 TDD loop (Red → Green → Refactor). */
  enforceTddImplement: boolean;
  /** Phase 5.5 local Codex-based pseudo CodeRabbit pre-review. */
  enforcePseudoCoderabbit: boolean;
  /** Phase 6 real CodeRabbit PR review loop. */
  enforceRealCoderabbit: boolean;
  /** Phase 7 Codex adversarial second-opinion review. */
  enforceCodexSecondOpinion: boolean;
}

export interface WorkConfig {
  /** Relative path to the project's task/plan file. Consumed by pre-compact and task-lifecycle hooks. */
  plansFile: string;
  /**
   * Section header keywords used to locate the assignment table inside the
   * plans file. Supports ja/en projects. First-match wins.
   */
  assignmentSectionMarkers: string[];
  /**
   * Project-specific session-handoff file paths that /harness-work and
   * /parallel-worktree update when closing a session. Existence-optional.
   */
  handoffFiles: string[];
  /**
   * Optional relative path to a project-local change log consumed by
   * /harness-plan sync. If unset, sync skips change-log scanning.
   */
  changeLogFile?: string;
  /**
   * Max concurrent tasks when `/harness-work` dispatches parallel execution
   * via `Task` tool (not via `/parallel-worktree`). Mirrors the `worktree`
   * family cap but is independently tunable so coordinators can keep a
   * lower in-process fan-out while still allowing wider multi-worktree
   * runs. 1-16.
   */
  maxParallel: number;
  /**
   * Label ordering used by `/harness-plan` / `/harness-work` when picking
   * the next task (first match wins). Empty array disables label-priority
   * ordering entirely and falls back to file order.
   */
  labelPriority: string[];
  /**
   * Labels that bypass the "minor" quick-path and force full quality
   * gates regardless of work-item size (e.g. `[security]`, `[data]`).
   */
  criticalLabels: string[];
  /**
   * Optional shell command that `/harness-work` runs as the canonical
   * test step. When unset, hooks fall back to per-stack auto-detection
   * (`detectAvailableChecks()` in `subagent-stop.ts`).
   */
  testCommand?: string;
  /**
   * Per-project override of harness quality gates. When a flag is false,
   * the corresponding phase is still allowed but its reminder is
   * suppressed in the Stop hook.
   */
  qualityGates: QualityGatesConfig;
  /**
   * When true, `/harness-work` aborts the batch on the first failing task
   * instead of running remaining tasks in isolation. Mirrors
   * `vitest --bail 1`-style semantics.
   */
  failFast: boolean;
}

export interface SecurityConfig {
  /**
   * Relative path to a project-local security checklist. security-auditor
   * loads this file as addendum when present; otherwise runs the stack-neutral
   * generic checklist only.
   */
  projectChecklistPath?: string;
  /** Enabled security check categories. */
  enabledChecks: string[];
}

/**
 * Worktree orchestration mode. `true` / `false` force on/off; `"auto"`
 * delegates to `/harness-work` auto-detection (task-count based).
 */
export type WorktreeEnabledMode = boolean | "auto";

export interface WorktreeConfig {
  /** Whether /parallel-worktree and /harness-work may use git worktrees. */
  enabled: WorktreeEnabledMode;
  /** Max concurrent worktree sessions (1-16). */
  maxParallel: number;
  /** Parent directory (relative to `projectRoot`) where sibling worktrees are created. */
  parentDir: string;
  /** Optional prefix for generated worktree directory names (e.g. `myproj-wt-`). */
  prefix?: string;
  /** Optional base branch for new worktree branches (overrides `git symbolic-ref refs/remotes/origin/HEAD`). */
  defaultBaseBranch?: string;
}

/**
 * Pseudo-CodeRabbit review profile. `chill` / `assertive` match the
 * upstream CodeRabbit profiles verbatim; `strict` is a harness-local
 * extension that raises the nitpick surface.
 */
export type PseudoCoderabbitProfile = "chill" | "assertive" | "strict";

export interface TddEnforceConfig {
  /** If true, `/tdd-implement` refuses to proceed without a failing Red test. */
  alwaysRequireRedTest: boolean;
  /** If true, `[docs]`-labelled tasks may skip the Red-test requirement. */
  allowSkipOnDocsTasks: boolean;
  /** Pseudo CodeRabbit review profile. */
  pseudoCoderabbitProfile: PseudoCoderabbitProfile;
  /** Max Codex review loop iterations per Phase 5 round. */
  maxCodexReviewRetries: number;
}

export interface CodeRabbitConfig {
  /** GitHub login of the CodeRabbit bot (for comment authorship checks). */
  botLogin: string;
  /**
   * Minutes to look back when deciding whether a `rate-limited` / `Reviews
   * paused` marker is still active. Defaults to 15 per CodeRabbit Pro
   * cooldown semantics.
   */
  ratelimitCheckWindowMinutes: number;
  /** If true, PR review state = "APPROVED" is treated as an immediate clear signal. */
  approvedStateAsClear: boolean;
  /** Max pseudo-CodeRabbit loop iterations before escalating to real CodeRabbit. */
  maxPseudoLoopIterations: number;
  /** CodeRabbit Pro "5 reviews / 1 hour" bucket size (used for local rate prediction). */
  proBucketSize: number;
  /** Window (in minutes) for the CodeRabbit Pro review bucket. */
  proBucketWindowMinutes: number;
}

/**
 * Stack-detection knobs. Kept separate from `work.*` because these answer
 * "where does this project keep its source?" questions rather than "how
 * should `/harness-work` schedule tasks?" questions.
 */
export interface ToolingConfig {
  /**
   * Directory names that `subagent-stop.ts`'s `detectAvailableChecks()`
   * consults when choosing Python lint / typecheck targets. Only existing
   * directories are included. Default `["src", "app"]` — stack-neutral;
   * projects with a `backend/` layout add it explicitly via override.
   */
  pythonCandidateDirs: string[];
}

/**
 * Branch-merge strategy identifier consumed by `/branch-merge` and
 * `/harness-release`. `three-branch` is the default (feature/* → dev →
 * main); `two-branch` skips dev entirely for trunk-style repos.
 */
export type ReleaseStrategy = "two-branch" | "three-branch";

export interface ReleaseConfig {
  /** Branch-merge strategy. Controls how /branch-merge walks feature → integration → production. */
  strategy: ReleaseStrategy;
  /**
   * Intermediate branch name used when `strategy === "three-branch"`.
   * Ignored otherwise. Default `"dev"`.
   */
  integrationBranch: string;
  /**
   * Final / production branch name. Default `"main"`. Tags from
   * `/harness-release` land here.
   */
  productionBranch: string;
  /**
   * Command executed before each merge step. When unset, /harness-release
   * falls back to `work.testCommand` and then to per-stack autodetection.
   */
  testCommand?: string;
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
  work: WorkConfig;
  security: SecurityConfig;
  worktree: WorktreeConfig;
  tddEnforce: TddEnforceConfig;
  codeRabbit: CodeRabbitConfig;
  tooling: ToolingConfig;
  release: ReleaseConfig;
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
 * Arrays are not merged — a user-provided array replaces the default
 * wholesale, matching the intuition that config authors own the list.
 */
function mergeConfig(partial: Partial<HarnessConfig>): HarnessConfig {
  const partialWork: Partial<WorkConfig> = partial.work ?? {};
  const mergedWork: WorkConfig = {
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
    tddEnforce: {
      ...DEFAULT_CONFIG.tddEnforce,
      ...(partial.tddEnforce ?? {}),
    },
    codeRabbit: { ...DEFAULT_CONFIG.codeRabbit, ...(partial.codeRabbit ?? {}) },
    tooling: { ...DEFAULT_CONFIG.tooling, ...(partial.tooling ?? {}) },
    release: { ...DEFAULT_CONFIG.release, ...(partial.release ?? {}) },
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
