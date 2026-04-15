/**
 * core/src/guardrails/post-tool.ts
 * PostToolUse hook evaluator.
 *
 * Runs tampering detection and generic security-pattern scanning in
 * parallel, then aggregates warnings into a single HookResult. The decision
 * tier (approve / ask / deny) is driven by
 * `harness.config.json:tampering.severity`.
 */
import type { HookInput, HookResult } from "../types.js";
export declare function evaluatePostTool(input: HookInput): Promise<HookResult>;
//# sourceMappingURL=post-tool.d.ts.map