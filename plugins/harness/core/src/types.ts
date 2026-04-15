/**
 * core/src/types.ts
 * Claude Code Harness — shared type definitions
 *
 * Defines the hook I/O contract (Claude Code hooks protocol) and the
 * internal types used by the guardrail engine and state store.
 */

import type { HarnessConfig } from "./config.js";

// ============================================================
// Hook I/O types (Claude Code hooks protocol)
// ============================================================

/** Input payload for PreToolUse / PostToolUse hooks. */
export interface HookInput {
  /** Name of the tool that is about to run (e.g. "Bash", "Write"). */
  tool_name: string;
  /** Arguments passed to the tool. */
  tool_input: Record<string, unknown>;
  /** Claude Code session identifier (if available). */
  session_id?: string;
  /** Current working directory. */
  cwd?: string;
  /** Plugin root directory, if invoked via plugin. */
  plugin_root?: string;
}

/** Decision returned by a hook. */
export type HookDecision = "approve" | "deny" | "ask";

/** Output payload for hooks (Claude Code hooks protocol). */
export interface HookResult {
  /** Whether to allow, block, or ask the user. */
  decision: HookDecision;
  /** Human-readable explanation. */
  reason?: string;
  /** Extra context surfaced to Claude. */
  systemMessage?: string;
}

// ============================================================
// Guardrail types
// ============================================================

/** Context passed to each guard rule during evaluation. */
export interface RuleContext {
  input: HookInput;
  projectRoot: string;
  workMode: boolean;
  codexMode: boolean;
  breezingRole: string | null;
  /** Loaded harness configuration (defaults applied). */
  config: HarnessConfig;
}

/** A single guardrail. */
export interface GuardRule {
  /** Stable rule identifier (used for logs and tests). */
  id: string;
  /** Regex that must match `tool_name` for the rule to apply. */
  toolPattern: RegExp;
  /** Evaluation function. Returns null if the rule does not match. */
  evaluate: (ctx: RuleContext) => HookResult | null;
}

// ============================================================
// Signal types (agent-to-agent messaging)
// ============================================================

export type SignalType =
  | "task_completed"
  | "task_failed"
  | "teammate_idle"
  | "session_start"
  | "session_end"
  | "request_review";

export interface Signal {
  type: SignalType;
  from_session_id: string;
  to_session_id?: string;
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

// ============================================================
// Task-failure tracking
// ============================================================

export type FailureSeverity = "warning" | "error" | "critical";

export interface TaskFailure {
  task_id: string;
  severity: FailureSeverity;
  message: string;
  detail?: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  attempt: number;
}

// ============================================================
// Session state
// ============================================================

export type SessionMode = "normal" | "work" | "codex" | "breezing";

export interface SessionState {
  session_id: string;
  mode: SessionMode;
  project_root: string;
  /** ISO 8601 timestamp. */
  started_at: string;
  context?: Record<string, unknown>;
}
