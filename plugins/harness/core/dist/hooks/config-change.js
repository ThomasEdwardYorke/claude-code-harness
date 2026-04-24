/**
 * hooks/config-change.ts
 *
 * ConfigChange hook handler.
 *
 * ## Official spec (https://code.claude.com/docs/en/hooks, verified 2026-04-24)
 *
 * - **Trigger**: fires when a configuration file changes during the session
 *   (external editor / process modifies settings or skills files).
 * - **Payload**: `source` (matcher: user_settings / project_settings /
 *   local_settings / policy_settings / skills) + `file_path` + shared
 *   fields (session_id / cwd / transcript_path / hook_event_name).
 * - **Output**:
 *   - exit 0 + JSON stdout → `{ decision?, reason?, hookSpecificOutput }`
 *   - `decision: "block"` → prevent the config change from taking effect
 *   - `hookSpecificOutput.additionalContext` → injected into Claude context
 *   - other non-zero exit → non-blocking error (change proceeds)
 * - **matcher**: source-based (the 5 enum values documented above).
 *
 * ## Handler responsibility (harness-specific)
 *
 * Observability hook with opt-in blocking. Default behaviour is
 * `decision: "approve"` with a diagnostic context; the user can opt in to
 * blocking specific sources (e.g.
 * `configChange.blockOnSources: ["policy_settings"]`) to enforce
 * immutability of enterprise-managed policy without writing a custom hook.
 *
 * - **Fail-open**: config read failure / `enabled: false` → silent skip +
 *   `approve` with no additionalContext.
 * - **Sanitize**: file_path control chars / CR / LF / ANSI escape → literal
 *   `\n` / `\x{NN}`. source outside the 5-enum whitelist → `"unknown"`.
 * - **Truncate**: file_path > `maxFilePathLength` → truncate + inline marker.
 * - **Sensitive hint**: `.env` / `.env.<suffix>` / `secrets.<ext>` /
 *   `credentials.<ext>` / `*.pem` / `*.key` / `*.p12` / `*.pfx` →
 *   append `hint: potential secret file`.
 * - **Harness reload hint**: file_path endsWith `harness.config.json` →
 *   append `hint: harness config changed — run `harness doctor` or
 *   restart Claude Code to reload`.
 * - **Opt-in block**: `blockOnSources` に source が含まれる → `decision:
 *   "block"` + reason。additionalContext は block 時も保持 (observability)。
 *
 * ## Sanitization rationale (同 post-tool-use-failure.ts pattern)
 *
 * An attacker-controlled process can modify a settings file and trigger this
 * hook with crafted `source` / `file_path` strings to (a) spoof fence
 * boundaries in additionalContext, (b) inject ANSI escape sequences that
 * corrupt terminal rendering, or (c) leak secrets via the injected context.
 * Mitigations:
 *   1. Replace newline / CR with the literal `\n` token.
 *   2. Replace all other C0 control chars (including TAB `\x09`) + DEL `\x7F`
 *      with `\x{HH}` form. TAB is escaped here (unlike post-tool-use-failure
 *      which preserves TAB for error stack trace readability) because a
 *      file_path legitimately never contains TAB and an unescaped TAB can
 *      create visual alignment attacks in terminal rendering.
 *   3. Validate `source` against the 5-enum allowlist; anything else → "unknown".
 *   4. Per-request 48-bit nonce in the header + truncation marker so the
 *      attacker cannot pre-compute a spoofed literal.
 *
 * ## Related docs
 * - `docs/maintainer/research-anthropic-official-2026-04-22.md` (hook spec)
 * - `CHANGELOG.md` (feature history)
 */
import { randomBytes } from "node:crypto";
import { loadConfigSafe } from "../config.js";
const OFFICIAL_SOURCES = new Set([
    "user_settings",
    "project_settings",
    "local_settings",
    "policy_settings",
    "skills",
]);
function resolveConfig(projectRoot) {
    try {
        const config = loadConfigSafe(projectRoot);
        const raw = config.configChange;
        const cc = typeof raw === "object" && raw !== null
            ? raw
            : {};
        const rawMax = cc["maxFilePathLength"];
        const rawBlock = cc["blockOnSources"];
        // Filter blockOnSources to valid enum values only — invalid entries are
        // silently dropped so a malformed config never turns the hook into a
        // blunt instrument that rejects everything.
        const blockOnSources = new Set();
        if (Array.isArray(rawBlock)) {
            for (const s of rawBlock) {
                if (typeof s === "string" &&
                    OFFICIAL_SOURCES.has(s)) {
                    blockOnSources.add(s);
                }
            }
        }
        return {
            enabled: typeof cc["enabled"] === "boolean" ? cc["enabled"] : true,
            // Range 32-4096: path display must fit a reasonable width without
            // cropping short paths. User override within bounds is honoured.
            maxFilePathLength: typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 32
                ? Math.min(rawMax, 4096)
                : 256,
            detectSensitivePaths: typeof cc["detectSensitivePaths"] === "boolean"
                ? cc["detectSensitivePaths"]
                : true,
            blockOnSources,
        };
    }
    catch {
        // Fail-open: keep the hook operational with defaults rather than going silent.
        return {
            enabled: true,
            maxFilePathLength: 256,
            detectSensitivePaths: true,
            blockOnSources: new Set(),
        };
    }
}
// ============================================================
// Sanitization (parallel to post-tool-use-failure.ts)
// ============================================================
function sanitizePathLine(s) {
    // CR / LF / CRLF → literal `\n` (fence-injection defence).
    // All other C0 (including TAB `\x09`) + DEL `\x7F` → `\x{HH}` form.
    // Rationale for TAB escaping is documented in the handler docstring
    // (Mitigations step 2): file_path legitimately never contains TAB, and
    // unescaped TAB enables visual alignment attacks in terminal rendering.
    // Contrast with post-tool-use-failure.ts which preserves TAB for error
    // stack-trace readability — different payload, different trade-off.
    return s
        .replace(/\r\n|[\n\r]/g, "\\n")
        .replace(/[\x00-\x1F\x7F]/g, (ch) => {
        const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
        return `\\x${hex}`;
    });
}
function sanitizeSource(s) {
    if (typeof s !== "string")
        return "unknown";
    if (OFFICIAL_SOURCES.has(s)) {
        return s;
    }
    return "unknown";
}
// ============================================================
// Sensitive path / reload hint detection
// ============================================================
/**
 * Return the last path segment (after `/` or `\`).
 * Works on absolute and relative paths, POSIX and Windows.
 */
function basenameOf(path) {
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}
/**
 * Pattern matchers for sensitive files whose change likely touches a secret.
 *
 * Detection runs on two axes (file-name AND parent-directory) because secret
 * conventions vary: a Rails project keeps `config/secrets.yml`, a Kubernetes
 * operator keeps `/etc/kubernetes/secrets/<something>.yaml`, and a typical
 * Unix deploy stores keys under `.ssh/`. Both patterns are informational
 * hints, never blocking.
 *
 * **Filename patterns** (checked via basename):
 *   - `.env` (exact) / `.env.<suffix>` (e.g. `.env.local`, `.env.production`).
 *   - `secrets.<ext>` / `secret.<ext>` (json/yml/yaml/toml/ini/conf).
 *   - `credentials.<ext>` / `credential.<ext>` (same extensions).
 *   - `*.pem` / `*.key` / `*.p12` / `*.pfx` (private-key / cert bundle).
 *
 * **Parent-directory patterns** (checked on full path):
 *   `/secrets/` / `/credentials/` / `/keys/` / `/.ssh/` — changes to ANY
 *   file inside these directories get the hint.
 *
 * Intentionally conservative: `settings.json` and similar general-purpose
 * config files are NOT flagged by filename. Partial matches like
 * `deploy.secrets.bak/innocent.json` do fire the dir-level hint, which is
 * the intended over-cautious behaviour (false-positive > false-negative
 * for secret exposure).
 */
function isSensitivePath(path) {
    const name = basenameOf(path);
    if (name === ".env")
        return true;
    if (/^\.env\.[A-Za-z0-9._-]+$/.test(name))
        return true;
    if (/^secrets?\.(json|ya?ml|toml|ini|conf)$/i.test(name))
        return true;
    if (/^credentials?\.(json|ya?ml|toml|ini|conf)$/i.test(name))
        return true;
    if (/\.(pem|key|p12|pfx)$/i.test(name))
        return true;
    // Parent-directory heuristic: only match clean segment boundaries to avoid
    // false positives like `/keystore-backup/` (which contains the substring
    // `/key` but isn't a secrets directory). POSIX and Windows separators both
    // normalised by scanning for `/<seg>/` and `\<seg>\`.
    const normalised = path.replace(/\\/g, "/");
    if (/\/(?:secrets?|credentials?|keys?|\.ssh)\//i.test(normalised))
        return true;
    return false;
}
function isHarnessConfigPath(path) {
    return basenameOf(path) === "harness.config.json";
}
// ============================================================
// Handler
// ============================================================
/**
 * Main entry point for the ConfigChange hook.
 *
 * @param input  hook payload passed in by Claude Code
 * @param options.projectRoot  root used for config resolution; defaults to
 *   `input.cwd ?? process.cwd()` when omitted
 *
 * @returns `decision: "block"` when `sanitizedSource ∈ blockOnSources`,
 *          otherwise `decision: "approve"`. `additionalContext` is always
 *          populated unless `enabled: false`.
 */
export async function handleConfigChange(input, options) {
    const projectRoot = options?.projectRoot ?? input.cwd ?? process.cwd();
    const cfg = resolveConfig(projectRoot);
    if (!cfg.enabled) {
        return { decision: "approve" };
    }
    const sanitizedSource = sanitizeSource(input.source);
    const rawPath = typeof input.file_path === "string" ? input.file_path : "";
    // Per-request 48-bit nonce (defence-in-depth against spoofed fence
    // markers — collision probability 2^-48 ≈ 3.5e-15). Header and
    // truncation marker share the same nonce (request-level coherence).
    const nonce = randomBytes(6).toString("hex");
    // Truncate first (by char length), then sanitize. The truncation marker
    // contains a newline that will be converted to `\n` literal by
    // sanitizePathLine — intentional: the marker still reads sensibly in
    // the rendered output.
    //
    // Length contract: the final pre-sanitize string MUST NOT exceed
    // `maxFilePathLength`. Compute `available = maxFilePathLength -
    // markerSuffix.length`, then:
    //   - `available > 0` → slice to `available` chars + append marker
    //     (total = maxFilePathLength exactly).
    //   - `available <= 0` → maxFilePathLength is smaller than the marker
    //     itself, so we omit the marker and slice strictly to
    //     maxFilePathLength. Observability signal is sacrificed here, but
    //     declared max is honoured (the configured value was the user's
    //     choice). Practically reached only when maxFilePathLength ≈ 32-56,
    //     deep inside the configurable range floor.
    //
    // Post-sanitize, the displayed string may grow by ≤ 5 chars because
    // the marker's leading `\n` becomes `\\n` etc. — callers that need a
    // strict post-sanitize bound should budget accordingly.
    const markerSuffix = `\n[harness ${nonce}] file_path truncated at ${cfg.maxFilePathLength} chars`;
    const available = cfg.maxFilePathLength - markerSuffix.length;
    let truncatedPathRaw;
    if (rawPath.length > cfg.maxFilePathLength) {
        truncatedPathRaw =
            available > 0
                ? rawPath.slice(0, available) + markerSuffix
                : rawPath.slice(0, cfg.maxFilePathLength);
    }
    else {
        truncatedPathRaw = rawPath;
    }
    const displayPath = rawPath.length > 0 ? sanitizePathLine(truncatedPathRaw) : "<unknown>";
    const lines = [
        `[harness ${nonce} ConfigChange] source=${sanitizedSource}`,
        `file=${displayPath}`,
    ];
    // Sensitive path detection runs on the RAW path (pre-sanitize) so pattern
    // matching is not confused by escape replacements. Matching happens on
    // the basename only, consistent with how secrets tooling (gitleaks /
    // detect-secrets) narrows scope.
    if (cfg.detectSensitivePaths && rawPath.length > 0 && isSensitivePath(rawPath)) {
        lines.push("hint: potential secret file — treat change as sensitive");
    }
    if (rawPath.length > 0 && isHarnessConfigPath(rawPath)) {
        lines.push("hint: harness config changed — run `harness doctor` or restart Claude Code to reload");
    }
    const additionalContext = lines.join("\n");
    // Opt-in blocking: only official sources can be blocked (unknown is
    // never in blockOnSources because resolveConfig filters the list).
    if (sanitizedSource !== "unknown" &&
        cfg.blockOnSources.has(sanitizedSource)) {
        return {
            decision: "block",
            reason: `Config change blocked: source=${sanitizedSource} is in blockOnSources`,
            additionalContext,
        };
    }
    return {
        decision: "approve",
        additionalContext,
    };
}
//# sourceMappingURL=config-change.js.map