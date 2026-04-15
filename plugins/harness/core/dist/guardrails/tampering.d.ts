/**
 * core/src/guardrails/tampering.ts
 * Tampering-pattern detector for PostToolUse.
 *
 * When Write / Edit / MultiEdit modifies a test or CI-config file, scan the
 * new content for patterns that indicate deliberate erosion of quality gates
 * (skipped tests, removed assertions, continue-on-error, hardcoded answers,
 * …). The returned HookResult decision is driven by
 * `harness.config.json:tampering.severity` (default: "approve" = warn only).
 */
import type { HookInput, HookResult } from "../types.js";
import type { HarnessConfig } from "../config.js";
interface TamperingPattern {
    id: string;
    description: string;
    pattern: RegExp;
    /** If true, only flag when the target file is a test file. */
    testFileOnly: boolean;
}
export declare const TAMPERING_PATTERNS: readonly TamperingPattern[];
export interface TamperingWarning {
    patternId: string;
    description: string;
    matchedText: string;
}
export declare function detectTampering(text: string, isTest: boolean): TamperingWarning[];
/**
 * PostToolUse entrypoint. Reads `config.tampering.severity` to decide
 * whether to approve+warn, ask, or deny on detection.
 */
export declare function detectTestTampering(input: HookInput, config?: HarnessConfig): HookResult;
export {};
//# sourceMappingURL=tampering.d.ts.map