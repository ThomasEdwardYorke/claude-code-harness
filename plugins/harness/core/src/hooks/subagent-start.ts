/**
 * hooks/subagent-start.ts
 *
 * SubagentStart hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-24)
 *
 * - **Trigger**: fires when Task tool spawns a subagent (before subagent runs).
 * - **Payload**: `session_id` / `cwd` / `agent_type` / `agent_id` /
 *   `transcript_path` / shared fields (hook_event_name).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, hookSpecificOutput }`
 *   - `hookSpecificOutput.additionalContext` → injected into **subagent's**
 *     context (advisory only, subagent reads this as additional context)
 *   - **Block NOT supported**: SubagentStart does NOT support `decision: "block"`
 *     (Anthropic official spec: subagent block is not an intended use case)
 *   - other non-zero exit → non-blocking error (subagent runs anyway)
 * - **matcher**: `agent_type` (Bash / Explore / Plan / `harness:worker` /
 *   `harness:reviewer` etc.)
 *
 * ## Handler responsibility (harness-specific)
 *
 * Observability hook with opt-in guidance injection. Default behaviour is
 * `decision: "approve"` with a diagnostic context; the user can opt in to
 * per-type guidance notes (e.g. `harness:worker` → "TDD first" reminder)
 * to bridge global plugin defaults with local project rules via the
 * subagent context.
 *
 * - **Fail-open**: config read failure / `enabled: false` → silent skip +
 *   `approve` with no additionalContext.
 * - **Sanitize**: agent_type / agent_id / note values share the same
 *   policy — CR / LF / CRLF → literal `\n`, TAB (`\x09`) + other C0
 *   (0x00-0x1F) + DEL (0x7F) → `\x{HH}`. Notes are rendered single-line
 *   (see `sanitizeNote()` for rationale: config values are attack
 *   surface, preserving raw LF would allow multi-line pseudo-section
 *   injection inside `additionalContext`).
 * - **Truncate**: agent_type > `maxIdentifierLength` → truncate + inline
 *   marker (char-based); total bytes > `maxTotalBytes` → byte-safe
 *   UTF-8 truncation (multi-byte characters kept whole).
 * - **agentTypeNotes injection**: config provides per-type guidance (e.g.
 *   `{ "harness:worker": "Remember: TDD first..." }`). When agent_type
 *   matches a key, the note value is sanitized and injected into
 *   additionalContext.
 * - **Nonce-fenced diagnostic**: 12 hex (48-bit entropy) fence markers +
 *   inline nonce to defend against fake-marker injection attacks (attacker
 *   config cannot pre-compute matching nonce).
 *
 * ## Sanitization rationale (post-tool-use-failure.ts pattern)
 *
 * An attacker-controlled config (or malicious config admin) can craft
 * agent_type / agent_id / agentTypeNotes values to (a) spoof fence
 * boundaries, (b) inject ANSI escape sequences that corrupt terminal
 * rendering, (c) confuse parsing via embedded newlines, or (d) smuggle
 * multi-line content that looks like new section boundaries. Mitigations:
 *   1. Replace CR / LF / CRLF with the literal `\n` token in **both**
 *      identifiers and note content (single-line output — config values
 *      are attack surface, multi-line preservation would enable pseudo-
 *      section injection).
 *   2. Replace all other C0 (0x00-0x1F, TAB included) + DEL (0x7F) with
 *      the `\x{HH}` form — ANSI escape + visual alignment attacks denied.
 *   3. Per-request 48-bit nonce in the header so attacker cannot
 *      pre-compute a spoofed literal (collision probability 2^-48).
 *   4. Truncation markers for overlong identifiers; byte-safe UTF-8
 *      truncation for total `additionalContext` length.
 *
 * ## Related docs
 * - `docs/maintainer/research-anthropic-official-2026-04-22.md` (hook spec)
 * - `CHANGELOG.md` (feature history)
 */

import { randomBytes } from "node:crypto";
import { loadConfigSafe } from "../config.js";

// ============================================================
// Types
// ============================================================

export interface SubagentStartInput {
  hook_event_name: string;
  /**
   * Session identifier from Claude Code. Used for observability
   * (tracing subagent back to parent session).
   */
  session_id?: string | undefined;
  /**
   * Current working directory. Used as projectRoot for config lookup.
   */
  cwd?: string | undefined;
  /**
   * Agent type (matcher value): one of
   * `Bash` / `Explore` / `Plan` / `harness:worker` / `harness:reviewer` /
   * etc. Rendered into additionalContext after control-char sanitization
   * and truncation. `undefined` is coalesced to `"unknown"` during
   * sanitization.
   */
  agent_type?: string | undefined;
  /**
   * Agent instance identifier. Rendered into additionalContext after
   * sanitization (for observability/tracing).
   */
  agent_id?: string | undefined;
  /**
   * Absolute path to the transcript file (for coordinators to locate
   * subagent output). Informational; not rendered in additionalContext
   * by this handler (used by calling layer).
   */
  transcript_path?: string | undefined;
}

export interface SubagentStartResult {
  /**
   * Always `"approve"` (SubagentStart does NOT support block).
   */
  decision: "approve";
  /**
   * Diagnostic text lifted into `hookSpecificOutput.additionalContext`
   * by index.ts main(). Includes the nonce-header, agent_type, agent_id,
   * and optional agentTypeNotes if present and config-matched.
   * Populated only when `enabled: true`; omitted when `enabled: false`.
   */
  additionalContext?: string;
}

// ============================================================
// Config loader (fail-open, shape-defensive)
// ============================================================

export interface SubagentStartConfig {
  enabled: boolean;             // default true
  maxIdentifierLength: number;  // default 128, clamp 32-1024
  fenceContext: boolean;        // default true
  agentTypeNotes: Record<string, string>; // default {}
  maxTotalBytes: number;        // default 4096, clamp 256-65536
}

function resolveConfig(projectRoot: string): SubagentStartConfig {
  try {
    const config = loadConfigSafe(projectRoot);
    const raw = (config as { subagentStart?: unknown }).subagentStart;
    const ss =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : {};

    const rawMaxId = ss["maxIdentifierLength"];
    const rawMaxTotal = ss["maxTotalBytes"];
    const rawNotes = ss["agentTypeNotes"];

    return {
      // typeof guard narrows the type automatically — no `as boolean` needed.
      enabled: typeof ss["enabled"] === "boolean" ? ss["enabled"] : true,
      // Range 32-1024: reasonable bounds for identifier display.
      maxIdentifierLength:
        typeof rawMaxId === "number" &&
        Number.isFinite(rawMaxId) &&
        rawMaxId >= 32 &&
        rawMaxId <= 1024
          ? rawMaxId
          : 128,
      fenceContext:
        typeof ss["fenceContext"] === "boolean" ? ss["fenceContext"] : true,
      // agentTypeNotes: shape-defensive per-entry validation —
      // non-string values and empty keys are silently dropped so a
      // malformed config never makes `sanitizeNote()` throw at runtime
      // (previously the type assertion `as Record<string, string>` let a
      // number/object slip through and rely on the `typeof note ===
      // "string"` guard in the handler; this is now belt-and-suspenders).
      agentTypeNotes: (() => {
        if (typeof rawNotes !== "object" || rawNotes === null) return {};
        if (Array.isArray(rawNotes)) return {};
        const filtered: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawNotes as Record<string, unknown>)) {
          // `Object.entries` は常に string key を返すため `typeof k` check
          // は省略。空 key と non-string value のみを reject (malformed
          // config が `sanitizeNote` に到達するのを防ぐ shape defense)。
          if (k.length > 0 && typeof v === "string") {
            filtered[k] = v;
          }
        }
        return filtered;
      })(),
      // Range 256-65536: total context size cap (prompt bloat prevention).
      maxTotalBytes:
        typeof rawMaxTotal === "number" &&
        Number.isFinite(rawMaxTotal) &&
        rawMaxTotal >= 256 &&
        rawMaxTotal <= 65536
          ? rawMaxTotal
          : 4096,
    };
  } catch {
    // Fail-open: keep hook operational with defaults.
    return {
      enabled: true,
      maxIdentifierLength: 128,
      fenceContext: true,
      agentTypeNotes: {},
      maxTotalBytes: 4096,
    };
  }
}

// ============================================================
// Sanitization helpers
// ============================================================

/**
 * Sanitize identifier (agent_type / agent_id): CR/LF/CRLF → literal `\n`,
 * all other C0 + DEL → `\x{HH}`.
 *
 * Note: does NOT preserve newlines (identifiers should be single-line).
 */
function sanitizeIdentifier(s: string | undefined): string {
  if (typeof s !== "string") {
    return "unknown";
  }
  if (s.length === 0) {
    return "unknown";
  }
  return s
    .replace(/\r\n|[\n\r]/g, "\\n")
    .replace(/[\x00-\x1F\x7F]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
      return `\\x${hex}`;
    });
}

/**
 * Sanitize note content (from agentTypeNotes): CR / LF / CRLF → literal
 * `\n`, TAB (`\x09`) + all other C0 (0x00-0x1F) + DEL (0x7F) → `\x{HH}`.
 *
 * **LF is escaped**: `agentTypeNotes` values come from config and are
 * attack surface — a malicious / compromised config could inject
 * multi-line content that spoofs pseudo-section boundaries inside
 * `additionalContext`. Escaping LF to literal `\n` (same policy as
 * `sanitizeIdentifier`) eliminates that vector. Notes render as a
 * single line with `\n` literals, which is sufficient for short
 * guidance ("TDD first") — operators with multi-line requirements
 * should instead author multiple config entries or use a dedicated
 * markdown-rendered skill.
 *
 * TAB is escaped for the same reason identifiers escape it (visual
 * alignment attacks in terminal rendering); prose has no readability
 * need for TAB.
 */
function sanitizeNote(s: string): string {
  return s
    .replace(/\r\n|[\n\r]/g, "\\n")
    .replace(/[\x00-\x1F\x7F]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
      return `\\x${hex}`;
    });
}

/**
 * Minimum content prefix (chars) to keep alongside the truncation marker.
 * Below this threshold the content slice becomes useless noise ("ab") so we
 * emit the marker alone instead — callers still get a clear truncation
 * signal even when `maxIdentifierLength` is tight (e.g. 32, the schema
 * minimum, where the 32-char marker exactly matches the limit).
 */
const MIN_CONTENT_PREFIX = 8;

/**
 * UTF-8 byte length of a string (vs `s.length` which counts UTF-16 code
 * units and mis-counts multi-byte characters like Japanese / emoji).
 */
function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf-8");
}

/**
 * Truncate `s` to at most `maxBytes` UTF-8 bytes. Multi-byte characters
 * (Japanese / emoji / combining marks) are kept whole — if a cut would
 * fall mid-character the trailing invalid bytes are stripped via the
 * replacement-character (U+FFFD) recovery that Node's UTF-8 decoder
 * emits. This mirrors `user-prompt-submit.ts`'s byte-safe truncation.
 */
function truncateToUtf8Bytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf-8");
  if (buf.length <= maxBytes) return s;
  if (maxBytes <= 0) return "";
  return buf.subarray(0, maxBytes).toString("utf-8").replace(/�+$/, "");
}

/**
 * Truncate an identifier to maxLength chars, appending a truncation marker
 * when content fits alongside it. Marker includes nonce so attacker cannot
 * pre-compute spoofed variant.
 *
 * Behaviour matrix (marker is `[harness <12-hex>] truncated` = 32 chars):
 *   - `s.length <= maxLength` → return `s` unchanged.
 *   - `available >= MIN_CONTENT_PREFIX` (8) → `s.slice(0, available) + marker`.
 *     Typical case at default `maxIdentifierLength=128`: 96 chars of
 *     content + 32-char marker = 128 chars.
 *   - otherwise (marker alone consumes most/all of maxLength, e.g. at the
 *     schema minimum 32) → `marker.slice(0, maxLength)`. Previously this
 *     path fell through to `s.slice(0, maxLength)` with no marker at all,
 *     silently truncating content — callers could not detect that data
 *     was dropped. The marker-only fallback keeps a visible `[harness ...]`
 *     prefix so downstream (logs, subagent context) sees the truncation
 *     signal, even when content is sacrificed.
 */
function truncateIdentifier(
  s: string,
  maxLength: number,
  nonce: string,
): string {
  if (s.length <= maxLength) {
    return s;
  }
  const marker = `[harness ${nonce}] truncated`;
  const available = maxLength - marker.length;
  if (available >= MIN_CONTENT_PREFIX) {
    return s.slice(0, available) + marker;
  }
  return marker.slice(0, maxLength);
}

// ============================================================
// Handler
// ============================================================

/**
 * Main entry point for the SubagentStart hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns Always `decision: "approve"` (block not supported).
 *          `additionalContext` is populated unless `enabled: false`.
 */
export async function handleSubagentStart(
  input: SubagentStartInput,
  options?: { projectRoot?: string | undefined },
): Promise<SubagentStartResult> {
  const projectRoot = options?.projectRoot ?? input.cwd ?? process.cwd();
  const cfg = resolveConfig(projectRoot);

  if (!cfg.enabled) {
    return { decision: "approve" };
  }

  // Per-request 48-bit nonce (defence-in-depth against spoofed fence markers).
  const nonce = randomBytes(6).toString("hex");

  // Sanitize and truncate identifiers.
  const sanitizedAgentType = sanitizeIdentifier(input.agent_type);
  const sanitizedAgentId = sanitizeIdentifier(input.agent_id);

  const truncatedAgentType = truncateIdentifier(
    sanitizedAgentType,
    cfg.maxIdentifierLength,
    nonce,
  );
  const truncatedAgentId = truncateIdentifier(
    sanitizedAgentId,
    cfg.maxIdentifierLength,
    nonce,
  );

  // Build the diagnostic line.
  const diagnosticLine = `[harness ${nonce} SubagentStart] agent_type=${truncatedAgentType} agent_id=${truncatedAgentId}`;

  const lines: string[] = [];

  // Add fence start if enabled.
  if (cfg.fenceContext) {
    lines.push(`===== HARNESS SubagentStart ${nonce} =====`);
  }

  lines.push(diagnosticLine);

  // Inject agentTypeNotes if agent_type matches a key in the config.
  // Lookup uses the COALESCED (pre-sanitize) agent_type — `undefined`
  // collapses to the literal `"unknown"` so config authors can target
  // the missing-input case via `{ "unknown": "<note>" }`. Sanitize is
  // strictly for **rendering** (control-char escape in the diagnostic
  // line); the key lookup must stay on the raw value so a config entry
  // like `{ "Bash": "..." }` still matches an unsanitized Bash spawn.
  // The name `agentTypeKey` makes the "coalesced key for lookup" intent
  // explicit (as opposed to a name like `rawAgentType` which would
  // suggest the value is unmodified, which is not the case for undefined).
  const agentTypeKey = input.agent_type ?? "unknown";
  const note = cfg.agentTypeNotes[agentTypeKey];
  if (typeof note === "string" && note.length > 0) {
    const sanitizedNote = sanitizeNote(note);
    lines.push(sanitizedNote);
  }

  // Add fence end if enabled.
  if (cfg.fenceContext) {
    lines.push(`===== END HARNESS SubagentStart ${nonce} =====`);
  }

  // Join and check total size. Preserve fence structure on overflow:
  // if the output exceeds maxTotalBytes, truncate the note BODY only
  // (between the opening fence and closing fence) and re-assemble. This
  // keeps the closing fence intact so Claude's parser can identify the
  // context boundary even when the note has been over-long.
  //
  // When fenceContext is false (no wrapping), fall back to a straight
  // byte-safe slice with an inline marker — there's no fence to preserve.
  //
  // **UTF-8 aware**: `maxTotalBytes` is a byte cap (per schema docs), so
  // all length comparisons and slices go through `utf8ByteLength` /
  // `truncateToUtf8Bytes` rather than `s.length`. Multi-byte content
  // (Japanese, emoji) is kept whole — a cut mid-character is recovered
  // via the UTF-8 decoder's replacement-character drop.
  let additionalContext = lines.join("\n");

  if (utf8ByteLength(additionalContext) > cfg.maxTotalBytes) {
    if (cfg.fenceContext && lines.length >= 3) {
      // Structure: [open-fence, ...body, close-fence]. Keep open/close,
      // compress body to fit within maxTotalBytes.
      const openFence = lines[0]!;
      const closeFence = lines[lines.length - 1]!;
      const body = lines.slice(1, -1).join("\n");

      // Budget for body = maxTotalBytes - (open + \n + \n + close).
      // Fence markers are ASCII-only, so utf8ByteLength = length, but we
      // use utf8ByteLength uniformly for clarity.
      const overhead =
        utf8ByteLength(openFence) + utf8ByteLength(closeFence) + 2;
      const markerSuffix = `\n[harness ${nonce}] context truncated at ${cfg.maxTotalBytes} bytes`;
      const bodyBudget =
        cfg.maxTotalBytes - overhead - utf8ByteLength(markerSuffix);

      let truncatedBody: string;
      if (bodyBudget > 0) {
        truncatedBody = truncateToUtf8Bytes(body, bodyBudget) + markerSuffix;
      } else {
        // maxTotalBytes is so small that fence + marker alone exceed it.
        // Drop the body entirely and keep only the fences with an inline
        // note about severe truncation.
        truncatedBody = `[harness ${nonce}] body dropped (budget exhausted)`;
      }

      additionalContext = [openFence, truncatedBody, closeFence].join("\n");
    } else {
      // No fence wrapping — byte-safe slice with marker.
      const truncationMarker = `\n[harness ${nonce}] context truncated at ${cfg.maxTotalBytes} bytes`;
      const sliceBudget = Math.max(
        0,
        cfg.maxTotalBytes - utf8ByteLength(truncationMarker),
      );
      additionalContext =
        truncateToUtf8Bytes(additionalContext, sliceBudget) + truncationMarker;
    }
  }

  return {
    decision: "approve",
    additionalContext,
  };
}
