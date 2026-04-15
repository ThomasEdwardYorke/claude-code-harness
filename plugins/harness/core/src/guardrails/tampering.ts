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

// ============================================================
// File-type classification
// ============================================================

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.test\.py$/,
  /test_[^/]+\.py$/,
  /[^/]+_test\.py$/,
  /\.test\.go$/,
  /[^/]+_test\.go$/,
  /\/__tests__\//,
  /\/tests\//,
] as const;

const CONFIG_FILE_PATTERNS = [
  /(?:^|\/)\.eslintrc(?:\.[^/]+)?$/,
  /(?:^|\/)eslint\.config\.[^/]+$/,
  /(?:^|\/)\.prettierrc(?:\.[^/]+)?$/,
  /(?:^|\/)prettier\.config\.[^/]+$/,
  /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/,
  /(?:^|\/)biome\.json$/,
  /(?:^|\/)\.stylelintrc(?:\.[^/]+)?$/,
  /(?:^|\/)(?:jest|vitest)\.config\.[^/]+$/,
  /\.github\/workflows\/[^/]+\.ya?ml$/,
  /(?:^|\/)\.gitlab-ci\.ya?ml$/,
  /(?:^|\/)Jenkinsfile$/,
] as const;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(filePath));
}

function isConfigFile(filePath: string): boolean {
  return CONFIG_FILE_PATTERNS.some((p) => p.test(filePath));
}

// ============================================================
// Tampering patterns
// ============================================================

interface TamperingPattern {
  id: string;
  description: string;
  pattern: RegExp;
  /** If true, only flag when the target file is a test file. */
  testFileOnly: boolean;
}

export const TAMPERING_PATTERNS: readonly TamperingPattern[] = [
  // --- Skipped tests ---
  {
    id: "T01:it-skip",
    description: "`it.skip` / `describe.skip` disables a test",
    pattern: /(?:it|test|describe|context)\.skip\s*\(/,
    testFileOnly: true,
  },
  {
    id: "T02:xit-xdescribe",
    description: "`xit` / `xdescribe` disables a test",
    pattern: /\b(?:xit|xtest|xdescribe)\s*\(/,
    testFileOnly: true,
  },
  {
    id: "T03:pytest-skip",
    description: "`@pytest.mark.skip` / `@pytest.mark.xfail` disables a test",
    pattern: /@pytest\.mark\.(?:skip|xfail)\b/,
    testFileOnly: true,
  },
  {
    id: "T04:go-skip",
    description: "`t.Skip()` disables a test",
    pattern: /\bt\.Skip(?:f|Now)?\s*\(/,
    testFileOnly: true,
  },

  // --- Removed / commented-out assertions ---
  {
    id: "T05:expect-removed",
    description: "`expect(` is commented out",
    pattern: /\/\/\s*expect\s*\(/,
    testFileOnly: true,
  },
  {
    id: "T06:assert-commented",
    description: "`assert…` call is commented out",
    pattern: /\/\/\s*assert(?:Equal|NotEqual|True|False|Nil|Error)?\s*\(/,
    testFileOnly: true,
  },
  {
    id: "T07:todo-assert",
    description: "TODO comment replaces an assertion",
    pattern: /\/\/\s*TODO.*assert|\/\/\s*TODO.*expect/i,
    testFileOnly: true,
  },

  // --- Lint suppression in tests / CI ---
  {
    id: "T08:eslint-disable",
    description: "`eslint-disable` suppresses lint rules",
    pattern:
      /(?:\/\/\s*eslint-disable(?:-next-line|-line)?(?:\s+[^\n]+)?$|\/\*\s*eslint-disable\b[^*]*\*\/)/m,
    testFileOnly: false,
  },

  // --- CI workflow tampering ---
  {
    id: "T09:ci-continue-on-error",
    description: "`continue-on-error: true` hides failures in CI",
    pattern: /continue-on-error\s*:\s*true/,
    testFileOnly: false,
  },
  {
    id: "T10:ci-if-always",
    description: "`if: always()` forces a CI step regardless of upstream failure",
    pattern: /if\s*:\s*always\s*\(\s*\)/,
    testFileOnly: false,
  },

  // --- Hardcoded answers ---
  {
    id: "T11:hardcoded-answer",
    description: "Test expected value is hardcoded in a dictionary",
    pattern: /answers?_for_tests?\s*=\s*\{/,
    testFileOnly: true,
  },
  {
    id: "T12:return-hardcoded",
    description: "Test returns a hardcoded literal with a test/spec comment",
    pattern:
      /return\s+(?:"[^"]*"|'[^']*'|\d+)\s*;\s*\/\/.*(?:test|spec|expect)/i,
    testFileOnly: true,
  },
];

// ============================================================
// Detection
// ============================================================

export interface TamperingWarning {
  patternId: string;
  description: string;
  matchedText: string;
}

export function detectTampering(text: string, isTest: boolean): TamperingWarning[] {
  const warnings: TamperingWarning[] = [];
  for (const p of TAMPERING_PATTERNS) {
    if (p.testFileOnly && !isTest) continue;
    const match = p.pattern.exec(text);
    if (match !== null) {
      warnings.push({
        patternId: p.id,
        description: p.description,
        matchedText: match[0].slice(0, 120),
      });
    }
  }
  return warnings;
}

function extractTargets(
  input: HookInput,
): { filePath: string; changedText: string } | null {
  const toolInput = input.tool_input;
  const filePath = toolInput["file_path"];
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  const changedText =
    typeof toolInput["content"] === "string"
      ? toolInput["content"]
      : typeof toolInput["new_string"] === "string"
        ? toolInput["new_string"]
        : null;
  if (changedText === null) return null;
  return { filePath, changedText };
}

/**
 * PostToolUse entrypoint. Reads `config.tampering.severity` to decide
 * whether to approve+warn, ask, or deny on detection.
 */
export function detectTestTampering(
  input: HookInput,
  config?: HarnessConfig,
): HookResult {
  if (!["Write", "Edit", "MultiEdit"].includes(input.tool_name)) {
    return { decision: "approve" };
  }
  const targets = extractTargets(input);
  if (targets === null) return { decision: "approve" };

  const { filePath, changedText } = targets;
  const isTest = isTestFile(filePath);
  const isConfig = isConfigFile(filePath);
  if (!isTest && !isConfig) return { decision: "approve" };

  const warnings = detectTampering(changedText, isTest);
  if (warnings.length === 0) return { decision: "approve" };

  const fileType = isTest ? "test file" : "CI / config file";
  const warningLines = warnings
    .map(
      (w) =>
        `- [${w.patternId}] ${w.description}\n  Detected: ${w.matchedText}`,
    )
    .join("\n");

  const message =
    `[harness] Tampering patterns detected in ${fileType} \`${filePath}\`:\n\n` +
    warningLines +
    `\n\nReview this change: make sure it is not silently weakening tests or CI gates.`;

  const decision = config?.tampering.severity ?? "approve";

  if (decision === "approve") {
    return { decision: "approve", systemMessage: message };
  }
  return { decision, reason: message };
}
