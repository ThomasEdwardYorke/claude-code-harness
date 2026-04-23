/**
 * hooks/post-tool-use-failure.ts
 *
 * PostToolUseFailure hook handler.
 *
 * ## 公式仕様 (https://code.claude.com/docs/en/hooks, verified 2026-04-23)
 *
 * - **Trigger**: tool の実行が失敗した時 (exception / non-zero exit / interrupt)
 *   PostToolUse と mutually exclusive (成功時は PostToolUse、失敗時は本 hook)
 * - **Payload**: `tool_name` / `tool_input` / `tool_use_id` / `error` (string) /
 *   `is_interrupt` (optional) + 共通 (session_id / transcript_path / cwd /
 *   hook_event_name / permission_mode)
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }` を parse
 *   - exit 0 + `hookSpecificOutput.additionalContext` → Claude context 注入
 *   - `decision: "block"` + reason → tool failure を明示 block (本 handler は使わない)
 *   - その他 non-zero → non-blocking error (実行継続)
 * - **matcher**: tool name base (PostToolUse と同じ)、本 harness は全 tool 登録
 *
 * ## 本 handler の責務
 *
 * tool 失敗時に診断情報 + 既知 error pattern の corrective hint を
 * `hookSpecificOutput.additionalContext` へ inject し、Claude が次 turn で
 * 修復判断する材料を増やす observability hook。
 *
 * - **Fail-open**: config 読込失敗 / error 文字列空 → silent skip で approve
 * - **Truncate**: error 文字列が `maxErrorLength` 超なら truncate + marker
 * - **Built-in hints (correctiveHints: true)**: 6 pattern (permission denied /
 *   no such file / command not found / signal abort / timeout / connection refused)
 * - **non-blocking**: 必ず `decision: "approve"` を返す (failure そのものを
 *   block するのは設計外 — 本 hook は観察 + 助言に徹する)
 *
 * ## 関連 doc
 * - docs/maintainer/research-anthropic-official-2026-04-22.md (hook 仕様調査)
 * - CHANGELOG.md (feature history)
 */

import { randomBytes } from "node:crypto";
import { loadConfigSafe } from "../config.js";

// ============================================================
// Types
// ============================================================

export interface PostToolUseFailureInput {
  hook_event_name: string;
  /** 失敗した tool 名 (公式 payload)。 */
  tool_name?: string | undefined;
  /** 失敗した tool の arguments (公式 payload)。 */
  tool_input?: Record<string, unknown> | undefined;
  /** Tool invocation id (公式 payload)。 */
  tool_use_id?: string | undefined;
  /** Error 文字列 (公式 payload、e.g. "Command exited with non-zero status code 1")。 */
  error?: string | undefined;
  /** ユーザー割り込みフラグ (公式 payload optional)。 */
  is_interrupt?: boolean | undefined;
  session_id?: string | undefined;
  cwd?: string | undefined;
  transcript_path?: string | undefined;
  permission_mode?: string | undefined;
}

export interface PostToolUseFailureResult {
  /** 本 handler は常に approve (observability hook)。 */
  decision: "approve";
  /** 診断 + hint (`hookSpecificOutput.additionalContext` として lift)。 */
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
    // Fail-open: hook が完全に沈黙しないよう、defaults で動作継続
    return { enabled: true, maxErrorLength: 1024, correctiveHints: true };
  }
}

// ============================================================
// Corrective hint patterns
//
// 公式 docs で use case として挙げられた "auto-retry on specific error
// patterns" を最小限サポート。patterns は overlap しないよう慎重に
// 選択し、false positive を抑える。
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
  // Non-matching example: `status 130 is informational`（`exit` / `exited` が先行しない）
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
// 問題: raw `error` / `tool_name` 文字列が `additionalContext` へ unsanitized
// で inject されると、attacker-controlled tool (e.g. 任意 Bash script) の
// 出力で Claude context を混乱させることができる:
//   - Multi-line error で fence boundary 類似 pattern を偽造し、以降の
//     prompt injection につなげる
//   - ANSI escape sequence / control char で terminal rendering を破壊
//   - Secrets (API key / password) が log に inject されると model-visible
//
// 対策 (UserPromptSubmit の content sanitize と同じ思想):
//   1. newline / CR を literal `\\n` に escape (fence injection 防御)
//   2. その他 control char (TAB 以外の C0 + DEL) を `\x{NN}` escape
//   3. tool_name は identifier 属性なので厳格: `[A-Za-z0-9_-]` 以外は `?`
//
// 関連: user-prompt-submit.ts の newline sanitize (internal security review)
// ============================================================

function sanitizeErrorLine(s: string): string {
  // 1. `\r\n` / `\n` / `\r` → `\\n` (visible literal)
  // 2. その他 C0 control char (TAB \x09 は残す) + DEL \x7F → `\x{HH}`
  //    tab は logs / stack trace で一般的なので可読性を優先
  return s
    .replace(/\r\n|[\n\r]/g, "\\n")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
      return `\\x${hex}`;
    });
}

function sanitizeToolName(s: string): string {
  // Tool name は Claude Code 公式の identifier 属性。`[A-Za-z0-9_-]` 以外が
  // 現れたら injection attempt (e.g. `Bash\n==== END HARNESS ====`) とみなし
  // 最大 64 chars に制限 + 無効文字を `?` に置換。
  const clean = s.replace(/[^A-Za-z0-9_\-]/g, "?");
  return clean.length > 64 ? clean.slice(0, 64) + "…" : clean;
}

// ============================================================
// Handler
// ============================================================

/**
 * PostToolUseFailure hook の本体実装。
 *
 * @param input  Claude Code から渡される hook payload
 * @param options.projectRoot  config 読み込みの起点。未指定なら `input.cwd ?? process.cwd()`
 *
 * @returns 必ず `decision: "approve"` を返す (observability hook, fail-open)。
 *          診断情報 + hint が生成できるとき `additionalContext` を含む。
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

  // Per-request nonce (internal security review — fake marker injection 対策、
  // UserPromptSubmit と同一 pattern):
  //   attacker-controlled tool output 内に `[harness PostToolUseFailure]` /
  //   `[harness] error truncated at N chars` 相当の literal を仕込まれると、
  //   header / 告知 を偽装 spoofing できる。48-bit 乱数 nonce を付与し、
  //   attacker は次回 nonce を予測不能 (2^-48 ≈ 3.5e-15 衝突確率) なため
  //   spoofing が成立しない。同 request の header / truncate marker は同じ
  //   nonce を共有 (request 整合)。
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
