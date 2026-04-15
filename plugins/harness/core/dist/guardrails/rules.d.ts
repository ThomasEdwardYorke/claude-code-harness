/**
 * core/src/guardrails/rules.ts
 * Declarative guardrail rule table.
 *
 * Each rule is a (toolPattern, evaluate) pair that returns a HookResult
 * when it fires, or null to pass through to the next rule.
 *
 * Rules R01–R09 and R12 are domain-neutral. R10, R11, R13 are driven by
 * `harness.config.json` and no-op when their configuration arrays are
 * empty, so the distribution is entirely project-agnostic by default.
 */
import type { GuardRule, HookResult, RuleContext } from "../types.js";
export declare const GUARD_RULES: readonly GuardRule[];
/**
 * Evaluate all rules in order. Return the first non-null result, or
 * { decision: "approve" } if no rule fired.
 */
export declare function evaluateRules(ctx: RuleContext): HookResult;
//# sourceMappingURL=rules.d.ts.map