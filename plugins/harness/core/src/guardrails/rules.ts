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

// ============================================================
// Helpers
// ============================================================

/** Escape a string so it can be safely embedded in a RegExp. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a regex that matches ANY of the given literal strings, or null if the list is empty. */
function anyOfLiteral(values: readonly string[]): RegExp | null {
  if (values.length === 0) return null;
  const alternation = values.map(escapeRegex).join("|");
  return new RegExp(`(${alternation})`);
}

/** Test whether `filePath` hits a statically protected path (dot-env, .git, private keys, …). */
function isProtectedPath(filePath: string): boolean {
  const protected_patterns = [
    /^\.git\//,
    /\/\.git\//,
    /^\.env$/,
    /\/\.env$/,
    /\.env\./,
    /id_rsa/,
    /id_ed25519/,
    /id_ecdsa/,
    /id_dsa/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /authorized_keys/,
    /known_hosts/,
  ];
  return protected_patterns.some((p) => p.test(filePath));
}

function isUnderProjectRoot(filePath: string, projectRoot: string): boolean {
  const root = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
  return filePath.startsWith(root) || filePath === projectRoot;
}

function hasDangerousRmRf(command: string): boolean {
  if (/\brm\s+(?:[^\s]*\s+)*-(?=[^-]*r)[rf]+\b/.test(command)) return true;
  if (/\brm\s+--recursive\b/.test(command)) return true;
  return false;
}

function hasForcePush(command: string): boolean {
  return (
    /\bgit\s+push\b.*--force(?:-with-lease)?\b/.test(command) ||
    /\bgit\s+push\b.*-f\b/.test(command)
  );
}

function hasSudo(command: string): boolean {
  return /(?:^|\s)sudo\s/.test(command);
}

// ============================================================
// Rule table
// ============================================================

export const GUARD_RULES: readonly GuardRule[] = [
  // ------------------------------------------------------------------
  // R01: sudo is blocked (Bash)
  // ------------------------------------------------------------------
  {
    id: "R01:no-sudo",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;
      if (!hasSudo(command)) return null;
      return {
        decision: "deny",
        reason:
          "sudo is not permitted. If elevated privileges are required, ask the user to run the command manually.",
      };
    },
  },

  // ------------------------------------------------------------------
  // R02: block writes to protected paths (.env, .git, private keys, …)
  // ------------------------------------------------------------------
  {
    id: "R02:no-write-protected-paths",
    toolPattern: /^(?:Write|Edit|MultiEdit)$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const filePath = ctx.input.tool_input["file_path"];
      if (typeof filePath !== "string") return null;
      if (!isProtectedPath(filePath)) return null;
      return {
        decision: "deny",
        reason: `Writing to the protected path "${filePath}" is not permitted.`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R03: block shell-level writes to protected paths (echo > .env, tee, …)
  // ------------------------------------------------------------------
  {
    id: "R03:no-bash-write-protected-paths",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;
      const writePatterns = [
        /(?:>>?|tee)\s+\S*\.env\b/,
        /(?:>>?|tee)\s+\S*\.env\./,
        /(?:>>?|tee)\s+\S*\.git\//,
        /(?:>>?|tee)\s+\S*id_rsa\b/,
        /(?:>>?|tee)\s+\S*id_ed25519\b/,
        /(?:>>?|tee)\s+\S*\.pem\b/,
        /(?:>>?|tee)\s+\S*\.key\b/,
      ];
      if (!writePatterns.some((p) => p.test(command))) return null;
      return {
        decision: "deny",
        reason: "Shell-level writes to protected files are not permitted.",
      };
    },
  },

  // ------------------------------------------------------------------
  // R04: confirm writes outside the project root (bypassed in work mode)
  // ------------------------------------------------------------------
  {
    id: "R04:confirm-write-outside-project",
    toolPattern: /^(?:Write|Edit|MultiEdit)$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const filePath = ctx.input.tool_input["file_path"];
      if (typeof filePath !== "string") return null;
      if (!filePath.startsWith("/")) return null;
      if (isUnderProjectRoot(filePath, ctx.projectRoot)) return null;
      if (ctx.workMode) return null;
      return {
        decision: "ask",
        reason: `Write target is outside the project root: ${filePath}. Proceed?`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R05: confirm rm -rf (bypassed in work mode)
  // ------------------------------------------------------------------
  {
    id: "R05:confirm-rm-rf",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;
      if (!hasDangerousRmRf(command)) return null;
      if (ctx.workMode) return null;
      return {
        decision: "ask",
        reason: `Dangerous delete detected:\n${command}\nExecute?`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R06: `git push --force` is blocked (no bypass)
  // ------------------------------------------------------------------
  {
    id: "R06:no-force-push",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;
      if (!hasForcePush(command)) return null;
      return {
        decision: "deny",
        reason:
          "`git push --force` is not permitted. History-rewriting operations must be done explicitly by the user.",
      };
    },
  },

  // ------------------------------------------------------------------
  // R07: Codex mode blocks Write/Edit (Claude is PM, Codex is implementer)
  // ------------------------------------------------------------------
  {
    id: "R07:codex-mode-no-write",
    toolPattern: /^(?:Write|Edit|MultiEdit)$/,
    evaluate(ctx: RuleContext): HookResult | null {
      if (!ctx.codexMode) return null;
      return {
        decision: "deny",
        reason:
          "Codex mode is active. Claude cannot write files directly — delegate implementation to a Codex worker (e.g. `codex exec`).",
      };
    },
  },

  // ------------------------------------------------------------------
  // R08: Breezing reviewer role cannot write/mutate
  // ------------------------------------------------------------------
  {
    id: "R08:breezing-reviewer-no-write",
    toolPattern: /^(?:Write|Edit|MultiEdit|Bash)$/,
    evaluate(ctx: RuleContext): HookResult | null {
      if (ctx.breezingRole !== "reviewer") return null;
      if (ctx.input.tool_name === "Bash") {
        const command = ctx.input.tool_input["command"];
        if (typeof command !== "string") return null;
        const prohibited = [
          /\bgit\s+(?:commit|push|reset|checkout|merge|rebase)\b/,
          /\brm\s+/,
          /\bmv\s+/,
          /\bcp\s+.*-r\b/,
        ];
        if (!prohibited.some((p) => p.test(command))) return null;
      }
      return {
        decision: "deny",
        reason:
          "The Breezing reviewer role cannot modify files or run mutating commands.",
      };
    },
  },

  // ------------------------------------------------------------------
  // R09: warn on reads of likely-secret files (approve + systemMessage)
  // ------------------------------------------------------------------
  {
    id: "R09:warn-secret-file-read",
    toolPattern: /^Read$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const filePath = ctx.input.tool_input["file_path"];
      if (typeof filePath !== "string") return null;
      const secretPatterns = [
        /\.env$/,
        /id_rsa$/,
        /\.pem$/,
        /\.key$/,
        /secrets?\//,
      ];
      if (!secretPatterns.some((p) => p.test(filePath))) return null;
      return {
        decision: "approve",
        systemMessage: `Warning: reading a file that may contain secrets: ${filePath}`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R10: block deletion of configured protected directories (PARAMETERIZED)
  //      Configure via harness.config.json: protectedDirectories
  //      Empty array ⇒ rule is a no-op.
  // ------------------------------------------------------------------
  {
    id: "R10:no-delete-protected-dirs",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;

      const protectedDirs = ctx.config.protectedDirectories;
      const dirAlt = anyOfLiteral(protectedDirs);
      if (dirAlt === null) return null; // no-op when unconfigured

      if (!/\b(?:rm|rmdir|unlink)\b/.test(command)) return null;
      const m = dirAlt.exec(command);
      if (m === null) return null;

      const matched = m[1] ?? m[0];
      return {
        decision: "deny",
        reason:
          `Deletion of protected directory "${matched}" is blocked. ` +
          `Configure via harness.config.json:protectedDirectories.`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R11: block API keys from appearing in Bash commands (PARAMETERIZED)
  //      Configure via harness.config.json: protectedEnvVarNames
  //      Empty array ⇒ rule is a no-op.
  // ------------------------------------------------------------------
  {
    id: "R11:no-api-key-in-command",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;

      const names = ctx.config.protectedEnvVarNames;
      const alt = anyOfLiteral(names);
      if (alt === null) return null; // no-op when unconfigured

      const m = alt.exec(command);
      if (m === null) return null;

      const matched = m[1] ?? m[0];
      return {
        decision: "deny",
        reason:
          `The command contains the protected environment variable name "${matched}". ` +
          `Reference it from .env / a secret manager instead.`,
      };
    },
  },

  // ------------------------------------------------------------------
  // R12: block `curl | bash`-style remote script execution
  // ------------------------------------------------------------------
  {
    id: "R12:no-curl-pipe-bash",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;
      if (!/(curl|wget)\s+.*\|\s*(bash|sh|zsh)/.test(command)) return null;
      return {
        decision: "deny",
        reason:
          "Piping a remote script directly into a shell is blocked. Download the script, inspect it, then run it.",
      };
    },
  },

  // ------------------------------------------------------------------
  // R13: block direct reads of files matching protectedFileSuffixes
  //      Configure via harness.config.json: protectedFileSuffixes (default: [".env"])
  //      Empty array ⇒ rule is a no-op.
  // ------------------------------------------------------------------
  {
    id: "R13:no-protected-file-access",
    toolPattern: /^Bash$/,
    evaluate(ctx: RuleContext): HookResult | null {
      const command = ctx.input.tool_input["command"];
      if (typeof command !== "string") return null;

      const suffixes = ctx.config.protectedFileSuffixes;
      if (suffixes.length === 0) return null;

      const sufAlt = suffixes.map(escapeRegex).join("|");
      // Match the dangerous-read command names even when invoked by absolute
      // path (`/bin/cat`, `/usr/bin/head`, …) or via backslash-escape
      // (`\cat`). `\b` boundary keeps the suffix match strict.
      const re = new RegExp(
        `(?:^|[\\s;&|(\\\\])(?:/\\S+/)?(cat|head|tail|less|more|open|echo)\\b\\s+.*(${sufAlt})\\b`,
      );
      const m = re.exec(command);
      if (m === null) return null;

      const matched = m[2] ?? m[0];
      return {
        decision: "deny",
        reason:
          `Direct access to a protected file ("${matched}") is blocked. ` +
          `Check for existence without reading contents.`,
      };
    },
  },
];

/**
 * Evaluate all rules in order. Return the first non-null result, or
 * { decision: "approve" } if no rule fired.
 */
export function evaluateRules(ctx: RuleContext): HookResult {
  const toolName = ctx.input.tool_name;
  for (const rule of GUARD_RULES) {
    if (!rule.toolPattern.test(toolName)) continue;
    const result = rule.evaluate(ctx);
    if (result !== null) return result;
  }
  return { decision: "approve" };
}
