/**
 * tampering.test.ts
 * Unit tests for the tampering-pattern detector.
 *
 * Each T01–T12 pattern is covered individually so that future edits to
 * TAMPERING_PATTERNS cannot silently lose coverage.
 */

import { describe, it, expect } from "vitest";
import {
  TAMPERING_PATTERNS,
  detectTampering,
  detectTestTampering,
} from "../tampering.js";
import type { HookInput } from "../../types.js";
import { DEFAULT_CONFIG, type HarnessConfig } from "../../config.js";

function makeInput(filePath: string, content: string): HookInput {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

function configWith(
  severity: HarnessConfig["tampering"]["severity"],
): HarnessConfig {
  return {
    ...DEFAULT_CONFIG,
    tampering: { severity },
  };
}

describe("TAMPERING_PATTERNS catalog", () => {
  it("declares T01..T12", () => {
    const ids = TAMPERING_PATTERNS.map((p) => p.id);
    const expected = Array.from({ length: 12 }, (_, i) =>
      `T${(i + 1).toString().padStart(2, "0")}`,
    );
    for (const want of expected) {
      expect(ids.some((id) => id.startsWith(`${want}:`))).toBe(true);
    }
  });
});

describe("detectTampering — per-pattern", () => {
  // T01: it.skip / describe.skip
  it("T01 detects it.skip", () => {
    const w = detectTampering("it.skip('x', () => {})", true);
    expect(w.map((x) => x.patternId)).toContain("T01:it-skip");
  });

  // T02: xit / xdescribe
  it("T02 detects xit()", () => {
    const w = detectTampering("xit('x', () => {})", true);
    expect(w.map((x) => x.patternId)).toContain("T02:xit-xdescribe");
  });

  // T03: pytest.mark.skip
  it("T03 detects @pytest.mark.skip", () => {
    const w = detectTampering("@pytest.mark.skip\ndef test_x(): pass", true);
    expect(w.map((x) => x.patternId)).toContain("T03:pytest-skip");
  });

  // T04: go t.Skip
  it("T04 detects t.Skip()", () => {
    const w = detectTampering("func TestX(t *testing.T) { t.Skip() }", true);
    expect(w.map((x) => x.patternId)).toContain("T04:go-skip");
  });

  // T05: commented expect(
  it("T05 detects commented expect(", () => {
    const w = detectTampering("// expect(result).toBe(1)", true);
    expect(w.map((x) => x.patternId)).toContain("T05:expect-removed");
  });

  // T06: commented assert
  it("T06 detects commented assertEqual", () => {
    const w = detectTampering("// assertEqual(a, b)", true);
    expect(w.map((x) => x.patternId)).toContain("T06:assert-commented");
  });

  // T07: TODO assert
  it("T07 detects TODO assert", () => {
    const w = detectTampering("// TODO: assert that result is valid", true);
    expect(w.map((x) => x.patternId)).toContain("T07:todo-assert");
  });

  // T08: eslint-disable  (applies to non-test files too)
  it("T08 detects eslint-disable", () => {
    const w = detectTampering("/* eslint-disable */\nconst x = 1;", false);
    expect(w.map((x) => x.patternId)).toContain("T08:eslint-disable");
  });

  // T09: continue-on-error: true  (CI yaml; applies to config files)
  it("T09 detects continue-on-error: true", () => {
    const w = detectTampering(
      "steps:\n  - run: npm test\n    continue-on-error: true",
      false,
    );
    expect(w.map((x) => x.patternId)).toContain("T09:ci-continue-on-error");
  });

  // T10: if: always()
  it("T10 detects if: always()", () => {
    const w = detectTampering(
      "steps:\n  - run: echo hi\n    if: always()",
      false,
    );
    expect(w.map((x) => x.patternId)).toContain("T10:ci-if-always");
  });

  // T11: hardcoded answers dict
  it("T11 detects answers_for_tests = {", () => {
    const w = detectTampering("answers_for_tests = { 'q1': 'a1' }", true);
    expect(w.map((x) => x.patternId)).toContain("T11:hardcoded-answer");
  });

  // T12: return literal with test comment
  it("T12 detects return literal // test", () => {
    const w = detectTampering('return "42"; // test expected value', true);
    expect(w.map((x) => x.patternId)).toContain("T12:return-hardcoded");
  });
});

describe("testFileOnly flag", () => {
  it("T05 (testFileOnly) does NOT fire on non-test files", () => {
    const w = detectTampering("// expect(result).toBe(1)", false);
    expect(w.map((x) => x.patternId)).not.toContain("T05:expect-removed");
  });

  it("T08 (non-testFileOnly) fires on non-test files", () => {
    const w = detectTampering("/* eslint-disable */", false);
    expect(w.map((x) => x.patternId)).toContain("T08:eslint-disable");
  });
});

describe("detectTestTampering entrypoint", () => {
  it("returns approve when no patterns match", () => {
    const result = detectTestTampering(
      makeInput("src/a.test.ts", 'it("x", () => { expect(1).toBe(1) })'),
      DEFAULT_CONFIG,
    );
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeUndefined();
  });

  it("returns approve + systemMessage when severity=approve", () => {
    const result = detectTestTampering(
      makeInput("src/a.test.ts", 'it.skip("x", () => {})'),
      configWith("approve"),
    );
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeDefined();
    expect(result.systemMessage).toContain("T01:it-skip");
  });

  it("returns ask when severity=ask", () => {
    const result = detectTestTampering(
      makeInput("src/a.test.ts", 'it.skip("x", () => {})'),
      configWith("ask"),
    );
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("T01:it-skip");
  });

  it("returns deny when severity=deny", () => {
    const result = detectTestTampering(
      makeInput("src/a.test.ts", 'it.skip("x", () => {})'),
      configWith("deny"),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("T01:it-skip");
  });

  it("ignores files that are neither test nor config files", () => {
    const result = detectTestTampering(
      makeInput("src/app.ts", 'it.skip("x", () => {})'),
      DEFAULT_CONFIG,
    );
    expect(result.decision).toBe("approve");
    expect(result.systemMessage).toBeUndefined();
  });

  it("ignores tools that are not write/edit/multiedit", () => {
    const input: HookInput = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    const result = detectTestTampering(input, DEFAULT_CONFIG);
    expect(result.decision).toBe("approve");
  });
});
