/**
 * core/src/config.ts
 * Harness configuration loader.
 *
 * Reads `harness.config.json` from the project root and merges with defaults.
 * Every guardrail that depends on project-specific values (R10/R11 etc.)
 * reads from the `HarnessConfig` on `RuleContext.config`.
 */
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
     * When true, the injected context block is wrapped in fence markers
     * (`===== HARNESS PROJECT-LOCAL CONTEXT =====` / `===== END HARNESS CONTEXT =====`)
     * so the user / reader can attribute the content to the harness rather
     * than mistaking it for their own prompt.
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
}
export declare const DEFAULT_CONFIG: HarnessConfig;
/**
 * Load harness config from `<projectRoot>/harness.config.json`.
 * Returns defaults if the file does not exist.
 * Throws if the file exists but is not valid JSON **or** if the parsed
 * value is not a JSON object (e.g. `42`, `[]`, `null`) — callers should
 * be prepared to fall back to defaults via a try/catch if they prefer
 * fail-open behaviour.
 */
export declare function loadConfig(projectRoot: string): HarnessConfig;
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
export declare function loadConfigSafe(projectRoot: string): HarnessConfig;
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
export declare function loadConfigWithError(projectRoot: string): ConfigLoadOutcome;
//# sourceMappingURL=config.d.ts.map