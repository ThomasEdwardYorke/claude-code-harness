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
 * - **Sanitize**: agent_type / agent_id / note values: CR / LF / CRLF →
 *   literal `\n`, all other C0 (0x00-0x1F) + DEL (0x7F) → `\x{HH}`.
 *   Newlines are preserved in note text for multi-line guidance (LF only).
 * - **Truncate**: agent_type > `maxIdentifierLength` → truncate + inline
 *   marker; note content > `maxTotalBytes` → truncate + marker.
 * - **agentTypeNotes injection**: config provides per-type guidance (e.g.
 *   `{ "harness:worker": "Remember: TDD first..." }`). When agent_type
 *   matches a key, the note value is sanitized and injected into
 *   additionalContext.
 * - **Harness reload hint**: agent_type containing "harness:" suggests
 *   harness plugin interaction — optional hint for tracing (no block).
 * - **Nonce-fenced diagnostic**: 12 hex (48-bit entropy) fence markers +
 *   inline nonce to defend against fake-marker injection attacks (attacker
 *   config cannot pre-compute matching nonce).
 *
 * ## Sanitization rationale (post-tool-use-failure.ts pattern)
 *
 * An attacker-controlled config (or malicious config admin) can craft
 * agent_type / agent_id / agentTypeNotes values to (a) spoof fence
 * boundaries, (b) inject ANSI escape sequences that corrupt terminal
 * rendering, or (c) confuse parsing via embedded newlines. Mitigations:
 *   1. Replace newline / CR with the literal `\n` token in agent_type /
 *      agent_id, but preserve LF newlines in note content for
 *      multi-line guidance.
 *   2. Replace all other C0 (0x00-0x1F, excluding LF 0x0A in notes) + DEL
 *      → `\x{HH}` form.
 *   3. Per-request 48-bit nonce in the header so attacker cannot
 *      pre-compute a spoofed literal (collision probability 2^-48).
 *   4. Truncation markers for overlong identifiers and total content.
 *
 * ## Related docs
 * - `docs/maintainer/research-anthropic-official-2026-04-22.md` (hook spec)
 * - `CHANGELOG.md` (feature history)
 */
import { randomBytes } from "node:crypto";
import { loadConfigSafe } from "../config.js";
function resolveConfig(projectRoot) {
    try {
        const config = loadConfigSafe(projectRoot);
        const raw = config.subagentStart;
        const ss = typeof raw === "object" && raw !== null
            ? raw
            : {};
        const rawMaxId = ss["maxIdentifierLength"];
        const rawMaxTotal = ss["maxTotalBytes"];
        const rawNotes = ss["agentTypeNotes"];
        return {
            enabled: typeof ss["enabled"] === "boolean" ? ss["enabled"] : true,
            // Range 32-1024: reasonable bounds for identifier display.
            maxIdentifierLength: typeof rawMaxId === "number" &&
                Number.isFinite(rawMaxId) &&
                rawMaxId >= 32 &&
                rawMaxId <= 1024
                ? rawMaxId
                : 128,
            fenceContext: typeof ss["fenceContext"] === "boolean"
                ? ss["fenceContext"]
                : true,
            // agentTypeNotes: shape-defensive per-entry validation —
            // non-string values and empty keys are silently dropped so a
            // malformed config never makes `sanitizeNote()` throw at runtime
            // (previously the type assertion `as Record<string, string>` let a
            // number/object slip through and rely on the `typeof note ===
            // "string"` guard in the handler; this is now belt-and-suspenders).
            agentTypeNotes: (() => {
                if (typeof rawNotes !== "object" || rawNotes === null)
                    return {};
                if (Array.isArray(rawNotes))
                    return {};
                const filtered = {};
                for (const [k, v] of Object.entries(rawNotes)) {
                    if (typeof k === "string" && k.length > 0 && typeof v === "string") {
                        filtered[k] = v;
                    }
                }
                return filtered;
            })(),
            // Range 256-65536: total context size cap (prompt bloat prevention).
            maxTotalBytes: typeof rawMaxTotal === "number" &&
                Number.isFinite(rawMaxTotal) &&
                rawMaxTotal >= 256 &&
                rawMaxTotal <= 65536
                ? rawMaxTotal
                : 4096,
        };
    }
    catch {
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
function sanitizeIdentifier(s) {
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
 * Sanitize note content (from agentTypeNotes): CR/LF/CRLF → literal `\n`,
 * but preserve LF newlines for multi-line guidance. TAB (`\x09`) + other
 * C0 + DEL → `\x{HH}`.
 *
 * Unlike identifiers, notes are expected to be multi-line, so we preserve
 * LF but normalize CR variants to literal `\n`. TAB **is** escaped here
 * (unlike `post-tool-use-failure.ts` which preserves TAB for error stack
 * trace readability) — `agentTypeNotes` is prose authored by the config
 * owner; TAB has no readability value for prose and can enable visual
 * alignment attacks in terminal rendering. This matches the stricter
 * `config-change.ts` identifier policy (escape TAB) rather than the
 * lax stack-trace policy.
 */
function sanitizeNote(s) {
    return s
        .replace(/\r\n/g, "\n") // CRLF → LF
        .replace(/\r/g, "\n") // CR → LF
        // [\x00-\x09\x0B-\x1F\x7F] escapes TAB (\x09) but preserves LF (\x0A).
        .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, (ch) => {
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
function truncateIdentifier(s, maxLength, nonce) {
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
export async function handleSubagentStart(input, options) {
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
    const truncatedAgentType = truncateIdentifier(sanitizedAgentType, cfg.maxIdentifierLength, nonce);
    const truncatedAgentId = truncateIdentifier(sanitizedAgentId, cfg.maxIdentifierLength, nonce);
    // Build the diagnostic line.
    const diagnosticLine = `[harness ${nonce} SubagentStart] agent_type=${truncatedAgentType} agent_id=${truncatedAgentId}`;
    const lines = [];
    // Add fence start if enabled.
    if (cfg.fenceContext) {
        lines.push(`===== HARNESS SubagentStart ${nonce} =====`);
    }
    lines.push(diagnosticLine);
    // Inject agentTypeNotes if agent_type matches a key in the config.
    // Use the ORIGINAL unsanitized agent_type for key lookup (as per test
    // expectation: agent_type undefined → sanitizes to "unknown" → matches
    // config key "unknown" if present).
    const originalAgentType = input.agent_type ?? "unknown";
    const note = cfg.agentTypeNotes[originalAgentType];
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
    // slice with an inline marker — there's no fence to preserve.
    let additionalContext = lines.join("\n");
    if (additionalContext.length > cfg.maxTotalBytes) {
        if (cfg.fenceContext && lines.length >= 3) {
            // Structure: [open-fence, ...body, close-fence]. Keep open/close,
            // compress body to fit within maxTotalBytes.
            const openFence = lines[0];
            const closeFence = lines[lines.length - 1];
            const body = lines.slice(1, -1).join("\n");
            // Budget for body = maxTotalBytes - (open + \n + \n + close).
            const overhead = openFence.length + closeFence.length + 2; // 2 newlines
            const markerSuffix = `\n[harness ${nonce}] context truncated at ${cfg.maxTotalBytes} bytes`;
            const bodyBudget = cfg.maxTotalBytes - overhead - markerSuffix.length;
            let truncatedBody;
            if (bodyBudget > 0) {
                truncatedBody = body.slice(0, bodyBudget) + markerSuffix;
            }
            else {
                // maxTotalBytes is so small that fence + marker alone exceed it.
                // Drop the body entirely and keep only the fences with an inline
                // note about severe truncation.
                truncatedBody = `[harness ${nonce}] body dropped (budget exhausted)`;
            }
            additionalContext = [openFence, truncatedBody, closeFence].join("\n");
        }
        else {
            // No fence wrapping — straight slice with marker.
            const truncationMarker = `\n[harness ${nonce}] context truncated at ${cfg.maxTotalBytes} bytes`;
            additionalContext =
                additionalContext.slice(0, Math.max(0, cfg.maxTotalBytes - truncationMarker.length)) + truncationMarker;
        }
    }
    return {
        decision: "approve",
        additionalContext,
    };
}
//# sourceMappingURL=subagent-start.js.map