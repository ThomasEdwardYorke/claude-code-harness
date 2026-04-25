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
import {
  HARNESS_IMAGE_DEFAULT_ASPECT,
  HARNESS_IMAGE_DEFAULT_BACKEND,
  HARNESS_IMAGE_DEFAULT_COUNT,
  HARNESS_IMAGE_DEFAULT_MODEL,
  HARNESS_IMAGE_DEFAULT_REASONING_EFFORT,
  VALID_IMAGE_ASPECT_RATIOS,
  VALID_IMAGE_REASONING_EFFORTS,
  type ImageAspectRatio,
  type ImageGenerationConfig,
  type ImageReasoningEffort,
} from "./models/resolver.js";

// Re-export the types so config.ts consumers (HarnessConfig field
// callers, downstream skill scripts that import from `@cc-triad-relay/core`)
// can pick up the canonical definitions without reaching into the
// `models/resolver` subpath. resolver.ts is the single source of truth
// — duplicating the declarations here would let the two files drift
// silently on enum extensions.
export {
  type ImageAspectRatio,
  type ImageGenerationConfig,
  type ImageReasoningEffort,
};

// ============================================================
// Type definitions
// ============================================================

export type HarnessLanguage = "en" | "ja";
export type TamperingSeverity = "approve" | "ask" | "deny";

/**
 * Tunables for the codex-sync agent aimed at mitigating mid-response
 * truncation caused by Claude Code's subagent output limit. See
 * `agents/codex-sync.md` for the user-facing remediation path.
 *
 * Background: Claude Code exposes `TASK_MAX_OUTPUT_LENGTH` (default
 * 32000 characters, runtime-observed cap at 160000) which middle-truncates
 * subagent final responses that exceed the effective limit (full output
 * is auto-saved to disk). codex-sync returns multi-KB Codex review output
 * and hit this truncation repeatedly during development. These knobs
 * let `harness doctor` warn when the effective limit is below the
 * runtime default without hardcoding the threshold inside bin/harness.
 */
export interface CodexSyncConfig {
  /**
   * Value `harness doctor` prints as the recommended setting for the
   * `TASK_MAX_OUTPUT_LENGTH` environment variable. Capped at 160000 —
   * Claude Code silently clamps higher values so advertising one would
   * be misleading.
   */
  recommendedTaskMaxOutputLength: number;
  /**
   * Threshold below which `harness doctor` flags the current effective
   * `TASK_MAX_OUTPUT_LENGTH` as WARN. Default 32000 mirrors Claude Code's
   * runtime default so the doctor warns whenever the env var is unset.
   */
  warnTaskMaxOutputLengthBelow: number;
  /**
   * When true, `harness doctor` reports the effective
   * `TASK_MAX_OUTPUT_LENGTH` alongside codex plugin detection. Set false
   * to silence the report entirely (e.g. for CI images where the env
   * var is intentionally left at the runtime default).
   */
  checkTaskMaxOutputLength: boolean;
}

export interface CodexConfig {
  /** Whether the codex-sync agent path resolution is active. */
  enabled: boolean;
  /**
   * Absolute path to the installed codex plugin root (e.g.
   * `${HOME}/.claude/plugins/cache/openai-codex/codex/1.0.2`).
   * If omitted, `harness doctor` auto-detects the latest version.
   */
  pluginRoot?: string;
  /**
   * Tunables for the codex-sync agent. **Non-optional after `loadConfig` /
   * `loadConfigSafe`**: `DEFAULT_CONFIG.codex.sync` is always populated and
   * `mergeConfig()` carries it through unconditionally (see the nested
   * spread in `mergeConfig` — `partial.codex?.sync ?? {}` fallback ensures
   * the merged object always has the three threshold fields).
   *
   * The user-facing JSON surface is still free to omit `codex.sync`
   * entirely; schema validation treats the section as optional. Only the
   * post-merge `HarnessConfig` consumer view is guaranteed to see a fully
   * populated `CodexSyncConfig`, which is why downstream code (bin/harness
   * doctor, `stop.ts` reminders, etc.) can dereference without optional
   * chaining.
   */
  sync: CodexSyncConfig;
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

/**
 * Task tracker source identifier consumed by `/harness-work` and related
 * skills. `"plans"` (default) reads the legacy flat `Plans.md` markdown
 * file. `"handoff"` opts the project into the 4-layer handoff structure
 * (`roadmap.md` / `backlog.md` / `current.md` / `decisions.md`) so the
 * skills can dispatch from the structured backlog while the roadmap layer
 * holds Phase / Week / AC source-of-truth.
 *
 * When set to `"handoff"`, `WorkConfig.handoffPaths` MUST be populated
 * with all four file paths. Missing or malformed entries cause
 * `validateWorkTaskTracker` to silently fall back to `"plans"` with a
 * stderr warning so consumers (skills, hooks) never see an undefined
 * dispatch source.
 */
export type TaskTrackerMode = "plans" | "handoff";

/**
 * 4-layer handoff document paths. All four fields are required when
 * `WorkConfig.taskTrackerMode === "handoff"`. Paths are project-relative
 * (anchored at `projectRoot`); absolute paths and `..` segments are
 * rejected by the loader to keep the handoff scope contained.
 *
 * Wholesale-replace semantics — the user-supplied object is used verbatim
 * (no merge with defaults) because partial overrides would yield silently
 * incomplete configs.
 */
export interface HandoffPathsConfig {
  /** Phase / Week / Task definition with YAML frontmatter (source-of-truth). */
  roadmap: string;
  /** Priority-ordered dispatchable view consumed by `/harness-work`. */
  backlog: string;
  /** Bird's-eye index file consumed by `/session-handoff check`. */
  current: string;
  /** Append-only design decisions log. */
  decisions: string;
}

export interface WorkConfig {
  /** Relative path to the project's task/plan file. Consumed by pre-compact and task-lifecycle hooks. */
  plansFile: string;
  /**
   * Task source for `/harness-work` and related skills. `"plans"` (default)
   * keeps the legacy `Plans.md` flow; `"handoff"` opts in to the 4-layer
   * handoff backlog. See `TaskTrackerMode` for the full contract.
   */
  taskTrackerMode: TaskTrackerMode;
  /**
   * 4-layer handoff document paths. Required when `taskTrackerMode ===
   * "handoff"`; ignored otherwise (but preserved for forward-compat so an
   * author can flip the mode later without re-typing the paths).
   */
  handoffPaths?: HandoffPathsConfig;
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
 * ConfigChange hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): fires when a
 * configuration file changes during a session (external editor / process
 * modifies `settings.json` / `settings.local.json` / skills files). The
 * matcher filters by source — `user_settings` / `project_settings` /
 * `local_settings` / `policy_settings` / `skills`.
 *
 * Observability-first hook with opt-in blocking: default behaviour is
 * `decision: "approve"` with a diagnostic context. Users set
 * `blockOnSources: ["policy_settings"]` (etc.) to enforce immutability
 * for specific sources, without writing a bespoke hook.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open, matching the rest of the harness hook stack).
 */
export interface ConfigChangeConfig {
  /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
  enabled: boolean;
  /**
   * Max file_path display length before truncation. Excess is cut with an
   * inline marker containing the per-request nonce so spoofing is hard.
   * Range: 32-4096 chars, default 256.
   */
  maxFilePathLength: number;
  /**
   * When true (default), emit `hint: potential secret file` for
   * `.env` / `.env.<suffix>` / `secrets.<ext>` / `credentials.<ext>` /
   * `*.pem` / `*.key` / `*.p12` / `*.pfx`. Hint is observational only —
   * the handler never blocks based on sensitive-path detection.
   */
  detectSensitivePaths: boolean;
  /**
   * Matcher sources that cause this hook to return `decision: "block"`
   * and reject the configuration change. Only valid enum values are
   * honoured (`user_settings` / `project_settings` / `local_settings` /
   * `policy_settings` / `skills`); unknown entries are silently dropped
   * so a malformed config cannot turn the hook into a blunt
   * reject-everything instrument.
   *
   * Default `[]` (observability only — never blocks).
   */
  blockOnSources: string[];
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

/**
 * SubagentStart hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): fires when the
 * Task tool spawns a subagent, **before** the subagent runs. The handler
 * emits `hookSpecificOutput.additionalContext` which is injected into
 * the **subagent's** context (unidirectional). Analogous to
 * UserPromptSubmit for the top-level prompt, but scoped to subagents.
 *
 * SubagentStart is informational-only — the official spec does **not**
 * support `decision: "block"` (blocking belongs to the earlier
 * PreToolUse hook on the Task tool call). The harness handler therefore
 * always returns `"approve"`.
 *
 * Observability + opt-in per-type guidance: use `agentTypeNotes` to
 * inject short reminders (e.g. `{ "harness:worker": "TDD first" }`)
 * into the corresponding subagent's context.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open, matching the rest of the harness hook stack).
 */
export interface SubagentStartConfig {
  /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
  enabled: boolean;
  /**
   * Max character length for `agent_type` / `agent_id` display before
   * truncation. Excess is cut with an inline marker containing the
   * per-request nonce so spoofing is hard. Range 32-1024, default 128.
   */
  maxIdentifierLength: number;
  /**
   * When true (default), wrap the diagnostic in fence markers with a
   * per-request nonce (12 hex chars, 48-bit entropy):
   * `===== HARNESS SubagentStart <nonce> =====` /
   * `===== END HARNESS SubagentStart <nonce> =====`.
   * The nonce defeats context-boundary spoofing by literal fence
   * markers embedded in `agentTypeNotes` values.
   */
  fenceContext: boolean;
  /**
   * Per-agent-type guidance notes injected into the subagent context
   * as additional lines inside the fence. Key matches `agent_type`
   * verbatim (undefined input coalesces to `"unknown"` — use the
   * key `"unknown"` to target it). Missing keys / non-string values
   * are silently dropped.
   *
   * Default `{}` (no notes — diagnostic header only).
   */
  agentTypeNotes: Record<string, string>;
  /**
   * Total byte cap for the emitted `additionalContext`. Excess is
   * truncated with an inline marker so the subagent can detect the
   * boundary. Range 256-65536, default 4096 (keeps subagent prompt
   * overhead bounded).
   */
  maxTotalBytes: number;
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
 * surface and a logical-alias table so projects can pin a specific Codex
 * model (including a legacy model for reproducibility) without editing
 * the agent markdown.
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

// `ImageReasoningEffort`, `ImageAspectRatio`, and `ImageGenerationConfig`
// are re-exported from `./models/resolver.js` (see top-of-file imports).
// resolver.ts is the canonical source of truth for the image surface —
// duplicating the declarations here would let the two files drift on
// enum extensions.

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
  configChange: ConfigChangeConfig;
  subagentStart: SubagentStartConfig;
  /**
   * Image-generation skill registry. Always populated post-merge —
   * `DEFAULT_CONFIG.imageGeneration` ships full defaults so callers do
   * not need optional chaining. The user-facing JSON surface still
   * accepts partial overrides (sibling keys keep their defaults).
   */
  imageGeneration: ImageGenerationConfig;
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
    // Task source defaults to legacy Plans.md mode. The 4-layer handoff
    // structure (roadmap / backlog / current / decisions) is genuinely
    // opt-in — `handoffPaths` is intentionally omitted so the absence of
    // a configured path set is unambiguously a Plans.md user. Downstream
    // skills must check `taskTrackerMode === "handoff"` before they
    // dereference `handoffPaths`.
    taskTrackerMode: "plans",
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
function mergeConfig(partial: Partial<HarnessConfig>): HarnessConfig {
  const partialWork: Partial<WorkConfig> = partial.work ?? {};
  const baseWork: WorkConfig = {
    ...DEFAULT_CONFIG.work,
    ...partialWork,
    qualityGates: {
      ...DEFAULT_CONFIG.work.qualityGates,
      ...(partialWork.qualityGates ?? {}),
    },
  };
  // handoffPaths uses wholesale-replace semantics. The user-supplied
  // object (when present) is used verbatim — partial overrides would
  // produce silently incomplete configs, since each of the four file
  // paths is required for the handoff dispatch to function.
  if ("handoffPaths" in partialWork) {
    if (partialWork.handoffPaths === undefined) {
      // Spread above carries through `undefined`; normalise so the field
      // is genuinely absent rather than a sentinel value.
      delete (baseWork as { handoffPaths?: HandoffPathsConfig }).handoffPaths;
    } else {
      baseWork.handoffPaths = partialWork.handoffPaths;
    }
  }
  const mergedWork: WorkConfig = validateWorkTaskTracker(baseWork);

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
    imageGeneration: validateImageGeneration(
      mergeImageGenerationConfig(partial.imageGeneration),
    ),
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
function mergeImageGenerationConfig(
  partial: unknown,
): ImageGenerationConfig {
  if (partial === undefined) {
    return { ...DEFAULT_CONFIG.imageGeneration };
  }
  if (
    partial === null ||
    typeof partial !== "object" ||
    Array.isArray(partial)
  ) {
    process.stderr.write(
      `[harness config] imageGeneration=${sanitiseConfigValueForStderr(
        partial,
      )} must be a JSON object; falling back to defaults.\n`,
    );
    return { ...DEFAULT_CONFIG.imageGeneration };
  }
  return {
    ...DEFAULT_CONFIG.imageGeneration,
    ...(partial as Partial<ImageGenerationConfig>),
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
function sanitiseConfigValueForStderr(value: unknown): string {
  // `JSON.stringify(undefined)` returns `undefined` (not the string
  // `"undefined"`), which would crash the subsequent `.replace` call.
  // Coerce explicitly so this helper is safe to call with any input —
  // including missing config keys surfaced via bracket access.
  const stringified = JSON.stringify(value);
  return (stringified ?? "undefined").replace(
    // C0 (excluding LF / CR / TAB which JSON.stringify already escapes
    // to \\n / \\r / \\t) + DEL + C1 range. Anything that survives is
    // printable ASCII or properly escaped Unicode.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g,
    "?",
  );
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
function validateImageGeneration(
  cfg: ImageGenerationConfig,
): ImageGenerationConfig {
  let next = cfg;
  if (
    !VALID_IMAGE_REASONING_EFFORTS.includes(
      next.defaultReasoning as ImageReasoningEffort,
    )
  ) {
    process.stderr.write(
      `[harness config] imageGeneration.defaultReasoning=${sanitiseConfigValueForStderr(
        next.defaultReasoning,
      )} is not one of ${JSON.stringify(
        VALID_IMAGE_REASONING_EFFORTS,
      )}; falling back to "${DEFAULT_CONFIG.imageGeneration.defaultReasoning}".\n`,
    );
    next = {
      ...next,
      defaultReasoning: DEFAULT_CONFIG.imageGeneration.defaultReasoning,
    };
  }
  if (
    !VALID_IMAGE_ASPECT_RATIOS.includes(
      next.defaultAspect as ImageAspectRatio,
    )
  ) {
    process.stderr.write(
      `[harness config] imageGeneration.defaultAspect=${sanitiseConfigValueForStderr(
        next.defaultAspect,
      )} is not one of ${JSON.stringify(
        VALID_IMAGE_ASPECT_RATIOS,
      )}; falling back to "${DEFAULT_CONFIG.imageGeneration.defaultAspect}".\n`,
    );
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
  if (
    typeof next.defaultBackend !== "string" ||
    next.defaultBackend.trim().length === 0 ||
    next.defaultBackend.includes("/") ||
    next.defaultBackend.includes("\\") ||
    next.defaultBackend.split(/[\\/]/).some((seg) => seg === "..") ||
    /[\x00-\x1f\x7f-\x9f]/.test(next.defaultBackend)
  ) {
    process.stderr.write(
      `[harness config] imageGeneration.defaultBackend=${sanitiseConfigValueForStderr(
        next.defaultBackend,
      )} must be a non-empty basename without path separators or control characters; falling back to "${
        DEFAULT_CONFIG.imageGeneration.defaultBackend
      }".\n`,
    );
    next = {
      ...next,
      defaultBackend: DEFAULT_CONFIG.imageGeneration.defaultBackend,
    };
  } else if (next.defaultBackend !== next.defaultBackend.trim()) {
    // Surrounding whitespace is benign; normalise so downstream
    // consumers do not see padded backend names.
    next = { ...next, defaultBackend: next.defaultBackend.trim() };
  }
  // defaultCount range guard. Schema declares minimum 1 / maximum 16
  // but loadConfig runs before schema validation, so re-enforce here.
  if (
    typeof next.defaultCount !== "number" ||
    !Number.isInteger(next.defaultCount) ||
    next.defaultCount < 1 ||
    next.defaultCount > 16
  ) {
    process.stderr.write(
      `[harness config] imageGeneration.defaultCount=${sanitiseConfigValueForStderr(
        next.defaultCount,
      )} is not an integer in [1, 16]; falling back to ${
        DEFAULT_CONFIG.imageGeneration.defaultCount
      }.\n`,
    );
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
    process.stderr.write(
      `[harness config] imageGeneration.refImageAllowlistPrefixes=${sanitiseConfigValueForStderr(
        next.refImageAllowlistPrefixes,
      )} is not an array; falling back to ${JSON.stringify(
        DEFAULT_CONFIG.imageGeneration.refImageAllowlistPrefixes,
      )}.\n`,
    );
    next = {
      ...next,
      refImageAllowlistPrefixes:
        DEFAULT_CONFIG.imageGeneration.refImageAllowlistPrefixes,
    };
  } else {
    const dropped: number[] = [];
    const cleanPrefixes: string[] = [];
    for (let i = 0; i < next.refImageAllowlistPrefixes.length; i += 1) {
      const entry = next.refImageAllowlistPrefixes[i];
      if (
        typeof entry === "string" &&
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
        !/[\x00-\x1f\x7f-\x9f]/.test(entry)
      ) {
        cleanPrefixes.push(entry);
      } else {
        dropped.push(i);
      }
    }
    if (dropped.length > 0) {
      process.stderr.write(
        `[harness config] imageGeneration.refImageAllowlistPrefixes dropped ${
          dropped.length
        } invalid entr${
          dropped.length === 1 ? "y" : "ies"
        } (indices ${JSON.stringify(
          dropped,
        )}); each entry must be a non-empty absolute path without ".." segments or control characters.\n`,
      );
      next = {
        ...next,
        refImageAllowlistPrefixes: cleanPrefixes,
      };
    }
  }
  return next;
}

const VALID_TASK_TRACKER_MODES: readonly TaskTrackerMode[] = [
  "plans",
  "handoff",
];
const HANDOFF_PATH_KEYS: readonly (keyof HandoffPathsConfig)[] = [
  "roadmap",
  "backlog",
  "current",
  "decisions",
];

/**
 * Guard against `work.taskTrackerMode` / `work.handoffPaths` being set to
 * shapes that downstream skills (`/harness-work`, `/session-handoff`)
 * cannot safely consume:
 *
 * 1. `taskTrackerMode` outside the allowed enum → fall back to `"plans"`.
 * 2. `taskTrackerMode === "handoff"` without a fully populated
 *    `handoffPaths` object → fall back to `"plans"` and drop
 *    `handoffPaths` so consumers do not see a partial structure.
 * 3. Any `handoffPaths` field that is not a non-empty string, contains
 *    `..` segments (path traversal), is absolute (escapes the project
 *    root), or carries control characters → reject the whole handoff
 *    override (mirrors the userPromptSubmit.contextFiles rule).
 *
 * Validation runs after the work-level merge so legitimate Plans.md
 * users see zero behaviour change. The `"plans"` mode never validates
 * `handoffPaths` (the field is a benign forward-compat carry-over).
 *
 * stderr output uses `sanitiseConfigValueForStderr` so attacker-
 * controlled values cannot inject ANSI escape codes / NUL bytes into
 * harness diagnostics.
 */
function validateWorkTaskTracker(cfg: WorkConfig): WorkConfig {
  let next = cfg;
  // 1. Enum check on taskTrackerMode.
  if (!VALID_TASK_TRACKER_MODES.includes(next.taskTrackerMode)) {
    process.stderr.write(
      `[harness config] work.taskTrackerMode=${sanitiseConfigValueForStderr(
        next.taskTrackerMode,
      )} is not one of ${JSON.stringify(
        VALID_TASK_TRACKER_MODES,
      )}; falling back to "${DEFAULT_CONFIG.work.taskTrackerMode}".\n`,
    );
    next = { ...next, taskTrackerMode: DEFAULT_CONFIG.work.taskTrackerMode };
  }
  // 2. handoffPaths shape check is gated on mode === "handoff" so a
  //    project that sets paths defensively while staying on plans mode
  //    sees no warning (forward-compat carry-over).
  if (next.taskTrackerMode === "handoff") {
    const paths = next.handoffPaths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
      process.stderr.write(
        `[harness config] work.taskTrackerMode="handoff" requires work.handoffPaths to be a JSON object with all four keys (${JSON.stringify(
          HANDOFF_PATH_KEYS,
        )}); falling back to "plans" mode.\n`,
      );
      next = { ...next, taskTrackerMode: "plans" };
      delete (next as { handoffPaths?: HandoffPathsConfig }).handoffPaths;
      return next;
    }
    const issues: string[] = [];
    for (const key of HANDOFF_PATH_KEYS) {
      const value = (paths as unknown as Record<string, unknown>)[key];
      if (typeof value !== "string" || value.length === 0) {
        issues.push(`${key}=${sanitiseConfigValueForStderr(value)} (missing / non-string / empty)`);
        continue;
      }
      // Path traversal segments (`..`) and absolute paths both let the
      // handoff scope escape the project root. Reject either.
      if (
        isAbsolute(value) ||
        value.split(/[\\/]/).some((segment) => segment === "..")
      ) {
        issues.push(`${key}=${sanitiseConfigValueForStderr(value)} (path traversal / absolute path rejected)`);
        continue;
      }
      // Control characters / NUL byte / DEL / C1 range — same defensive
      // rule as userPromptSubmit.contextFiles.
      if (/[\x00-\x1f\x7f-\x9f]/.test(value)) {
        issues.push(`${key}=${sanitiseConfigValueForStderr(value)} (control characters rejected)`);
        continue;
      }
    }
    if (issues.length > 0) {
      process.stderr.write(
        `[harness config] work.handoffPaths invalid: ${issues.join(
          "; ",
        )}; falling back to "plans" mode.\n`,
      );
      next = { ...next, taskTrackerMode: "plans" };
      delete (next as { handoffPaths?: HandoffPathsConfig }).handoffPaths;
    }
  }
  return next;
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
