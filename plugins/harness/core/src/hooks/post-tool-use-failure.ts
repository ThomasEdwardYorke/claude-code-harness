/**
 * hooks/post-tool-use-failure.ts
 *
 * PostToolUseFailure hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **Trigger**: fires when a tool execution fails (exception / non-zero exit /
 *   interrupt). Mutually exclusive with PostToolUse (success fires PostToolUse,
 *   failure fires this hook).
 * - **Payload**: `tool_name` / `tool_input` / `tool_use_id` / `error` (string) /
 *   `is_interrupt` (optional) + the shared fields (session_id / transcript_path /
 *   cwd / hook_event_name / permission_mode).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }` parsed
 *   - exit 0 + `hookSpecificOutput.additionalContext` → injected into Claude context
 *   - `decision: "block"` + reason → would block the tool failure explicitly
 *     (this handler does not use it)
 *   - other non-zero exit → non-blocking error (execution continues)
 * - **matcher**: tool-name based (same as PostToolUse); harness registers for all tools.
 *
 * ## Handler responsibility
 *
 * Observability hook that injects diagnostic information plus optional
 * corrective hints for known error patterns into
 * `hookSpecificOutput.additionalContext`, so Claude has material to decide
 * recovery on the next turn.
 *
 * - **Fail-open**: config read failure / empty error → silent skip + `approve`.
 * - **Truncate**: when error length exceeds `maxErrorLength`, truncate and emit
 *   an inline marker.
 * - **Built-in hints (`correctiveHints: true`)**: six patterns (permission denied /
 *   no such file / command not found / signal abort / timeout / connection refused).
 * - **Non-blocking**: always returns `decision: "approve"`. Blocking the failure
 *   itself is out of scope — this hook observes and advises only.
 *
 * ## Related docs
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (hook spec research)
 * - CHANGELOG.md (feature history)
 */

import { randomBytes } from "node:crypto";
import { loadConfigSafe } from "../config.js";

// ============================================================
// Types
// ============================================================

export interface PostToolUseFailureInput {
  hook_event_name: string;
  /** Name of the failing tool (official payload). */
  tool_name?: string | undefined;
  /** Arguments passed to the failing tool (official payload). */
  tool_input?: Record<string, unknown> | undefined;
  /** Tool invocation id (official payload). */
  tool_use_id?: string | undefined;
  /** Error string (official payload, e.g. `Command exited with non-zero status code 1`). */
  error?: string | undefined;
  /** User-interrupt flag (official payload, optional). */
  is_interrupt?: boolean | undefined;
  session_id?: string | undefined;
  cwd?: string | undefined;
  transcript_path?: string | undefined;
  permission_mode?: string | undefined;
}

export interface PostToolUseFailureResult {
  /** This handler always returns `approve` (observability hook). */
  decision: "approve";
  /** Diagnostic text + hint (lifted into `hookSpecificOutput.additionalContext`). */
  additionalContext?: string;
}

// ============================================================
// Config loader (fail-open)
// ============================================================

interface ResolvedConfig {
  enabled: boolean;
  maxErrorLength: number;
  correctiveHints: boolean;
}

function resolveConfig(projectRoot: string): ResolvedConfig {
  try {
    const config = loadConfigSafe(projectRoot);
    const raw = (config as { postToolUseFailure?: unknown }).postToolUseFailure;
    const ptuf =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const rawMax = ptuf["maxErrorLength"];
    return {
      enabled:
        typeof ptuf["enabled"] === "boolean"
          ? (ptuf["enabled"] as boolean)
          : true,
      maxErrorLength:
        typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 256
          ? Math.min(rawMax, 16384)
          : 1024,
      correctiveHints:
        typeof ptuf["correctiveHints"] === "boolean"
          ? (ptuf["correctiveHints"] as boolean)
          : true,
    };
  } catch {
    // Fail-open: keep the hook operational with defaults rather than going silent.
    return { enabled: true, maxErrorLength: 1024, correctiveHints: true };
  }
}

// ============================================================
// Corrective hint patterns
//
// Minimal support for the official-docs use case "auto-retry on specific
// error patterns". Patterns are chosen carefully so they do not overlap,
// keeping the false-positive rate low.
// ============================================================

function formatHint(error: string): string | null {
  if (/permission\s+denied/i.test(error)) {
    return "hint: check file permissions (chmod / chown) or rerun with appropriate privileges";
  }
  if (/no\s+such\s+file\s+or\s+directory/i.test(error)) {
    return "hint: verify the path; list the parent directory (ls) or check for typos";
  }
  if (/command\s+not\s+found/i.test(error)) {
    return "hint: the command is not installed or not on PATH; install or use an alternative";
  }
  // Signal-induced abort: 128+N (shell convention) — 130 (SIGINT), 137 (SIGKILL / OOM), 143 (SIGTERM)
  // Matches:
  //   - `exit status 130` / `exit code 137`
  //   - `exited with status code 130` / `Command exited with non-zero status code 130`
  //   - `Subprocess exited abnormally with code 143`
  // Non-matching example: `status 130 is informational` (no `exit` / `exited` prefix).
  if (/\bexit(?:ed)?\b[\s\S]{0,50}?(?:status\s+code|status|code)\s+(?:130|137|143)\b/i.test(error)) {
    return "hint: signal-based abort (interrupt / OOM / termination); inspect stderr and consider retry";
  }
  if (/\btimed\s+out\b|\bdeadline\s+exceeded\b/i.test(error)) {
    return "hint: operation timed out; raise the timeout or split into smaller steps";
  }
  if (/\bconnection\s+refused\b|\bnetwork\s+unreachable\b|\bdns\s+resolution\s+failed\b/i.test(error)) {
    return "hint: network endpoint unreachable; verify URL / port / firewall / VPN / DNS";
  }
  return null;
}

// ============================================================
// Sanitization (internal security review — error injection)
//
// Problem: when raw `error` / `tool_name` strings are injected into
// `additionalContext` without sanitization, an attacker-controlled tool
// (e.g. an arbitrary Bash script) can confuse the Claude context via:
//   - Multi-line error output forging fence-boundary-like patterns, enabling
//     subsequent prompt injection.
//   - ANSI escape sequences / control characters that corrupt terminal rendering.
//   - Secrets (API keys / passwords) injected into logs becoming model-visible.
//
// Mitigation (same approach as UserPromptSubmit content sanitize):
//   1. Escape newline / CR to the literal string `\\n` (fence-injection defence).
//   2. Escape other control characters (C0 except TAB + DEL) to `\x{NN}` form.
//   3. `tool_name` is an identifier, so enforce a strict `[A-Za-z0-9_-]` set
//      and replace everything else with `?`.
//
// Related: the newline sanitize step in `user-prompt-submit.ts`
// (internal security review).
// ============================================================

function sanitizeErrorLine(s: string): string {
  // 1. `\r\n` / `\n` / `\r` → `\\n` (visible literal).
  // 2. Other C0 control chars (TAB `\x09` kept) + DEL `\x7F` → `\x{HH}`.
  //    Keeping TAB favours readability in logs and stack traces.
  return s
    .replace(/\r\n|[\n\r]/g, "\\n")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
      return `\\x${hex}`;
    });
}

function sanitizeToolName(s: string): string {
  // Tool name is Claude Code's identifier attribute. Any character outside
  // `[A-Za-z0-9_-]` is treated as an injection attempt (e.g. `Bash\n==== END
  // HARNESS ====`): replace invalid characters with `?` and cap at 64 chars.
  const clean = s.replace(/[^A-Za-z0-9_\-]/g, "?");
  return clean.length > 64 ? clean.slice(0, 64) + "…" : clean;
}

// ============================================================
// Handler
// ============================================================

/**
 * Main entry point for the PostToolUseFailure hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns Always `decision: "approve"` (observability hook, fail-open).
 *          Includes `additionalContext` when diagnostics and hints can be
 *          generated.
 */
export async function handlePostToolUseFailure(
  input: PostToolUseFailureInput,
  options?: { projectRoot?: string | undefined },
): Promise<PostToolUseFailureResult> {
  const projectRoot = options?.projectRoot ?? input.cwd ?? process.cwd();
  const cfg = resolveConfig(projectRoot);

  if (!cfg.enabled) {
    return { decision: "approve" };
  }

  const toolName =
    typeof input.tool_name === "string" && input.tool_name.length > 0
      ? sanitizeToolName(input.tool_name)
      : "unknown";
  const rawError = typeof input.error === "string" ? input.error : "";

  if (rawError.length === 0) {
    // No diagnostic available — fail-open no-op
    return { decision: "approve" };
  }

  // Per-request nonce (internal security review — fake-marker injection
  // defence, same pattern as UserPromptSubmit):
  //   Attacker-controlled tool output can embed literals such as
  //   `[harness PostToolUseFailure]` or `[harness] error truncated at N
  //   chars` to spoof the header / truncation notice. A 48-bit random
  //   nonce defeats this because the attacker cannot predict the
  //   next-request value (collision probability 2^-48 ≈ 3.5e-15). The
  //   header and the truncation marker within the same request share the
  //   nonce (request-level coherence).
  const nonce = randomBytes(6).toString("hex");

  // Truncate first (byte-safe), then sanitize for injection defence
  // Note: truncate uses char length not byte length — acceptable trade-off
  // for error strings which are typically ASCII-heavy (stack traces / exit
  // messages). UserPromptSubmit takes byte-level care for user-controlled
  // content files; error payloads are system-generated and short.
  const truncatedErrorRaw =
    rawError.length > cfg.maxErrorLength
      ? rawError.slice(0, cfg.maxErrorLength) +
        `\n[harness ${nonce}] error truncated at ${cfg.maxErrorLength} chars`
      : rawError;
  const sanitizedError = sanitizeErrorLine(truncatedErrorRaw);

  const lines: string[] = [
    `[harness ${nonce} PostToolUseFailure] tool=${toolName}`,
    `error: ${sanitizedError}`,
  ];

  if (input.is_interrupt === true) {
    lines.push("(interrupted)");
  }

  if (cfg.correctiveHints) {
    const hint = formatHint(rawError);
    if (hint !== null) {
      lines.push(hint);
    }
  }

  return {
    decision: "approve",
    additionalContext: lines.join("\n"),
  };
}
