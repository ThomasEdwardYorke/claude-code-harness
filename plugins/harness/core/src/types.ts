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

  // ----------------------------------------------------------
  // Universal control fields (Phase κ-2 / θ minimal set)
  //
  // 公式仕様: https://code.claude.com/docs/en/hooks
  // これらは全 hook event で top-level に置ける汎用 field。event-specific な
  // field (updatedInput / updatedPermissions / updatedMCPToolOutput /
  // retry / action / content 等) は `hookSpecificOutput` nested object の
  // 下に入る規約だが、本 Phase では command hook の raw stdout 運用に
  // 集中し、必要になった event から段階的に追加する。
  // ----------------------------------------------------------

  /**
   * Default `true`. `false` で Claude Code を完全停止させる。停止時は
   * `stopReason` を user に表示 (Claude には渡らない)。
   *
   * 現 harness 実装は全 hook で fail-open のため通常は未設定 (= true)。
   */
  continue?: boolean;

  /**
   * `continue: false` 時に user へ見せる停止理由メッセージ。
   */
  stopReason?: string;

  /**
   * Default `false`。true にすると debug log から stdout を除外する。
   * 機微情報を含む hook 出力を debug 画面に出したくない場合に使用。
   */
  suppressOutput?: boolean;

  // ----------------------------------------------------------
  // Event-specific top-level fields (command hook raw stdout mode で使用)
  //
  // 本来 `hookSpecificOutput.worktreePath` で返すのが JSON (HTTP hook) の
  // 公式規約だが、command hook は stdout に raw absolute path を直接出す。
  // route() → index.ts main() の橋渡しとして HookResult に worktreePath を
  // 載せ、main() の worktree-create 分岐で raw stdout に書き出す。
  // ----------------------------------------------------------

  /**
   * WorktreeCreate hook の出力 — 作成された worktree の absolute path。
   * Phase κ-2 blocking protocol で設定。
   *
   * - 設定あり: index.ts main() が raw path を stdout に書き出し、exit 0
   * - 設定なし: main() は exit 1 (公式仕様: any non-zero exit causes
   *   worktree creation to fail — blocking hook の挙動)
   */
  worktreePath?: string;
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
