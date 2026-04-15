/**
 * core/src/guardrails/post-tool.ts
 * PostToolUse hook evaluator.
 *
 * Runs tampering detection and generic security-pattern scanning in
 * parallel, then aggregates warnings into a single HookResult. The decision
 * tier (approve / ask / deny) is driven by
 * `harness.config.json:tampering.severity`.
 */
import { loadConfigSafe } from "../config.js";
import { detectTestTampering } from "./tampering.js";
function resolveProjectRoot(input) {
    return (input.cwd ??
        process.env["HARNESS_PROJECT_ROOT"] ??
        process.env["PROJECT_ROOT"] ??
        process.cwd());
}
// ============================================================
// Generic security patterns
// ============================================================
function detectSecurityRisks(input) {
    const toolInput = input.tool_input;
    const content = typeof toolInput["content"] === "string"
        ? toolInput["content"]
        : typeof toolInput["new_string"] === "string"
            ? toolInput["new_string"]
            : null;
    if (content === null)
        return [];
    const warnings = [];
    const securityPatterns = [
        {
            pattern: /process\.env\.[A-Z_]+.*(?:password|secret|key|token)/i,
            message: "Embedding a secret from process.env directly into a string literal — consider redaction.",
        },
        {
            pattern: /eval\s*\(\s*(?:request|req|input|param|query)/i,
            message: "Passing user input to eval() — arbitrary code execution risk (RCE).",
        },
        {
            pattern: /exec\s*\(\s*`[^`]*\$\{/,
            message: "Passing a template literal to exec() — command injection risk.",
        },
        {
            pattern: /innerHTML\s*=\s*(?:.*\+.*|`[^`]*\$\{)/,
            message: "Assigning interpolated strings to innerHTML — XSS risk.",
        },
        {
            pattern: /(?:password|passwd|secret|api_key|apikey)\s*=\s*["'][^"']{8,}["']/i,
            message: "Hardcoded secret (password / API key) detected.",
        },
    ];
    for (const { pattern, message } of securityPatterns) {
        if (pattern.test(content)) {
            warnings.push(message);
        }
    }
    return warnings;
}
// ============================================================
// Entrypoint
// ============================================================
export async function evaluatePostTool(input) {
    const isWriteOp = ["Write", "Edit", "MultiEdit"].includes(input.tool_name);
    if (!isWriteOp) {
        return { decision: "approve" };
    }
    const config = loadConfigSafe(resolveProjectRoot(input));
    const [tamperingResult, securityWarnings] = await Promise.allSettled([
        Promise.resolve(detectTestTampering(input, config)),
        Promise.resolve(detectSecurityRisks(input)),
    ]);
    // If tampering severity is non-approve and fired, short-circuit with its decision.
    if (tamperingResult.status === "fulfilled" &&
        tamperingResult.value.decision !== "approve") {
        return tamperingResult.value;
    }
    const systemMessages = [];
    if (tamperingResult.status === "fulfilled" &&
        tamperingResult.value.systemMessage !== undefined) {
        systemMessages.push(tamperingResult.value.systemMessage);
    }
    if (securityWarnings.status === "fulfilled" &&
        securityWarnings.value.length > 0) {
        const secLines = securityWarnings.value.map((w) => `- ${w}`).join("\n");
        systemMessages.push(`[harness] Potential security issues:\n${secLines}`);
    }
    if (systemMessages.length === 0) {
        return { decision: "approve" };
    }
    return {
        decision: "approve",
        systemMessage: systemMessages.join("\n\n---\n\n"),
    };
}
//# sourceMappingURL=post-tool.js.map