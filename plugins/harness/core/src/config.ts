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

/**
 * PostToolUseFailure hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): this hook fires
 * when tool execution fails (exception / non-zero exit / interrupt) on a
 * path separate from `PostToolUse`. Non-blocking observability hook that
 * adds failure diagnostics and optional corrective hints to
 * `additionalContext` so Claude has material for next-turn recovery.
 *
 * When `correctiveHints` is true (default), the harness built-in hint
 * matchers cover common error patterns (permission denied / no such file /
 * command not found / signal abort / timeout / network unreachable) and
 * append a short suggestion string.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open).
 */
export interface PostToolUseFailureConfig {
  /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
  enabled: boolean;
  /**
   * Maximum length of the raw error string before truncation. Excess is
   * cut with an inline marker. Range: 256-16384 chars, default 1024.
   */
  maxErrorLength: number;
  /**
   * When true (default), append a corrective hint for the first matching
   * built-in error pattern. Set false to inject the raw error only
   * (no hint lookup).
   */
  correctiveHints: boolean;
}

/**
 * UserPromptSubmit hook configuration.
 *
 * Designed as the harness "Global plugin → Local project rules bridge":
 * each user prompt is augmented with project-local context (e.g.
 * `.claude/rules/coding-style.md`) so Claude inherits invariants the
 * project owner cares about, without forcing the user to re-paste them.
 *
 * Empty `contextFiles` (default) makes the hook a no-op — handler returns
 * `decision: "approve"` with no `additionalContext`, matching fail-open
 * behaviour throughout the harness.
 */
export interface UserPromptSubmitConfig {
  /**
   * Project-local context file paths (relative to `projectRoot`) appended
   * to each user prompt as `hookSpecificOutput.additionalContext`.
   * Missing files are skipped silently. Path-traversal entries (`..` or
   * absolute paths) are rejected and skipped.
   */
  contextFiles: string[];
  /**
   * Total byte cap across all contextFiles. Excess content is truncated
   * with an inline marker so Claude can detect the boundary. Range 256
   * (minimal) to 65536 (64 KiB) to keep prompt overhead bounded.
   */
  maxTotalBytes: number;
  /**
   * When true, the injected context block is wrapped in fence markers with
   * a per-request nonce (12 hex chars, 48-bit entropy):
   * `===== HARNESS PROJECT-LOCAL CONTEXT <nonce> =====` /
   * `===== END HARNESS CONTEXT <nonce> =====`
   * so the user / reader can attribute the content to the harness rather
   * than mistaking it for their own prompt. The nonce prevents context
   * boundary spoofing by literal fence markers embedded in rule file
   * content (attackers cannot predict the per-request value).
   */
  fenceContext: boolean;
}

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

/**
 * Model registry configuration. Controls which Codex model every
 * harness-dispatched Codex invocation targets, with a per-agent override
 * surface and a logical-alias table so projects can pin `gpt-5.5` (or a
 * legacy model for reproducibility) without editing the agent markdown.
 *
 * Implementation lives in `src/models/resolver.ts`; consumers are the
 * `bin/harness model resolve` CLI, each Codex-dispatching agent's
 * Invocation Rules, and the `harness model check` deprecation linter.
 * See `HARNESS_DEFAULT_MODEL` in resolver.ts for the compile-time default.
 */
export interface ModelsCodexRegistryConfig {
  default?: string;
  reasoningEffort?:
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";
  aliases?: Record<string, string>;
}

export interface ModelsAgentRegistryConfig {
  model?: string;
  reasoningEffort?:
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";
}

export interface ModelsConfig {
  codex?: ModelsCodexRegistryConfig;
  agents?: Record<string, ModelsAgentRegistryConfig>;
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
  userPromptSubmit: UserPromptSubmitConfig;
  postToolUseFailure: PostToolUseFailureConfig;
  /**
   * Optional model registry. When absent, harness resolves to
   * `HARNESS_DEFAULT_MODEL` (see `src/models/resolver.ts`).
   */
  models?: ModelsConfig;
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
function mergeModelsConfig(
  partial: ModelsConfig | undefined,
): ModelsConfig | undefined {
  const base = DEFAULT_CONFIG.models;
  if (!base && !partial) return undefined;
  const mergedCodex =
    base?.codex || partial?.codex
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
  const finalCodex =
    mergedCodex &&
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
  const result: ModelsConfig = {};
  if (finalCodex) result.codex = finalCodex;
  if (Object.keys(mergedAgents).length > 0) result.agents = mergedAgents;
  return result;
}

/**
 * Guard against `pseudoCoderabbitProfile` being set to a string outside
 * the allowed union (e.g. a typo like `"strict1"` or an older profile
 * name). Falls back to the default and writes a single warning line to
 * stderr so consumers (pseudo-coderabbit-loop) never need a fifth
 * `default:` branch in their switch.
 */
const VALID_CODERABBIT_PROFILES: readonly PseudoCoderabbitProfile[] = [
  "chill",
  "assertive",
  "strict",
];
function validateTddEnforce(cfg: TddEnforceConfig): TddEnforceConfig {
  if (!VALID_CODERABBIT_PROFILES.includes(cfg.pseudoCoderabbitProfile)) {
    process.stderr.write(
      `[harness config] tddEnforce.pseudoCoderabbitProfile=${JSON.stringify(
        cfg.pseudoCoderabbitProfile,
      )} is not one of ${JSON.stringify(
        VALID_CODERABBIT_PROFILES,
      )}; falling back to "${DEFAULT_CONFIG.tddEnforce.pseudoCoderabbitProfile}".\n`,
    );
    return {
      ...cfg,
      pseudoCoderabbitProfile:
        DEFAULT_CONFIG.tddEnforce.pseudoCoderabbitProfile,
    };
  }
  return cfg;
}

const VALID_RELEASE_STRATEGIES: readonly ReleaseStrategy[] = [
  "two-branch",
  "three-branch",
];
function validateRelease(cfg: ReleaseConfig): ReleaseConfig {
  if (!VALID_RELEASE_STRATEGIES.includes(cfg.strategy)) {
    process.stderr.write(
      `[harness config] release.strategy=${JSON.stringify(
        cfg.strategy,
      )} is not one of ${JSON.stringify(
        VALID_RELEASE_STRATEGIES,
      )}; falling back to "${DEFAULT_CONFIG.release.strategy}".\n`,
    );
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
export function loadConfig(projectRoot: string): HarnessConfig {
  const path = resolve(projectRoot, "harness.config.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      `harness.config.json must be a JSON object (got ${
        parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed
      })`,
    );
  }
  return mergeConfig(parsed as Partial<HarnessConfig>);
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
export function loadConfigSafe(projectRoot: string): HarnessConfig {
  try {
    return loadConfig(projectRoot);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Outcome of a config load attempt that surfaces the error for the
 * caller to decide what to do. Hooks that care whether the config file
 * parsed successfully (so they can warn / suppress unreliable behaviour)
 * use this instead of `loadConfigSafe()`.
 *
 * Invariant: `config` is always a valid `HarnessConfig`. When `error`
 * is set, `config` is `DEFAULT_CONFIG` (the same value `loadConfigSafe`
 * would return) — callers can still proceed, but now they know that
 * they fell back because of a parse failure, not because the user
 * deliberately accepted defaults.
 */
export interface ConfigLoadOutcome {
  /** Parsed config on success, DEFAULT_CONFIG when `error` is set. */
  config: HarnessConfig;
  /**
   * Populated when `loadConfig()` threw (malformed JSON / shape error /
   * I/O failure). Not populated when the file is simply absent — absence
   * is a valid opt-in-to-defaults state, not an error.
   */
  error?: string;
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
export function loadConfigWithError(projectRoot: string): ConfigLoadOutcome {
  const path = resolve(projectRoot, "harness.config.json");
  if (!existsSync(path)) {
    // File absent is not an error. Caller decides whether to act on defaults.
    return { config: DEFAULT_CONFIG };
  }
  try {
    return { config: loadConfig(projectRoot) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { config: DEFAULT_CONFIG, error: message };
  }
}
