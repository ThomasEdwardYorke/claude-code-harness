/**
 * core/src/index.ts
 * Harness core entry point.
 *
 * Reads JSON from stdin, routes by hook type, writes a JSON response to stdout.
 *
 *   echo '{"tool_name":"Bash","tool_input":{...}}' | node dist/index.js pre-tool
 *   echo '{"tool_name":"Write","tool_input":{...}}' | node dist/index.js post-tool
 *   echo '{"tool_name":"Bash","tool_input":{...}}' | node dist/index.js permission
 *   echo '{}' | node dist/index.js session-start
 *   echo '{}' | node dist/index.js session-end
 */

import type { HookInput, HookResult } from "./types.js";

type HookType =
  | "pre-tool"
  | "post-tool"
  | "permission"
  | "session-start"
  | "session-end";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseInput(raw: string): HookInput {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("tool_name" in parsed) ||
    typeof (parsed as Record<string, unknown>)["tool_name"] !== "string"
  ) {
    throw new Error("Invalid hook input: missing required field 'tool_name'");
  }
  const obj = parsed as Record<string, unknown>;
  const result: HookInput = {
    tool_name: obj["tool_name"] as string,
    tool_input:
      typeof obj["tool_input"] === "object" && obj["tool_input"] !== null
        ? (obj["tool_input"] as Record<string, unknown>)
        : {},
  };
  if (typeof obj["session_id"] === "string") {
    result.session_id = obj["session_id"];
  }
  if (typeof obj["cwd"] === "string") {
    result.cwd = obj["cwd"];
  }
  if (typeof obj["plugin_root"] === "string") {
    result.plugin_root = obj["plugin_root"];
  }
  return result;
}

/**
 * Minimal shape we accept on session hooks (tool_name etc. not required).
 */
function parseSessionInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

export async function route(
  hookType: HookType,
  input: HookInput,
): Promise<HookResult> {
  switch (hookType) {
    case "pre-tool": {
      const { evaluatePreTool } = await import("./guardrails/pre-tool.js");
      return evaluatePreTool(input);
    }
    case "post-tool": {
      const { evaluatePostTool } = await import("./guardrails/post-tool.js");
      return evaluatePostTool(input);
    }
    case "permission": {
      const { evaluatePermission, formatPermissionOutput } = await import(
        "./guardrails/permission.js"
      );
      const permResult = evaluatePermission(input);
      const permJson = formatPermissionOutput(permResult);
      return { decision: permResult.decision, systemMessage: permJson };
    }
    case "session-start":
    case "session-end": {
      // Session lifecycle hooks currently act as silent no-ops that just
      // approve. Projects can extend this later by plugging into the
      // engine/lifecycle module without touching the hook dispatcher.
      return { decision: "approve" };
    }
    default: {
      return {
        decision: "approve",
        reason: `Unknown hook type: ${String(hookType)}`,
      };
    }
  }
}

function errorToResult(err: unknown): HookResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    decision: "approve",
    reason: `Core engine error (safe fallback): ${message}`,
  };
}

async function main(): Promise<void> {
  const hookType = (process.argv[2] ?? "pre-tool") as HookType;
  let result: HookResult;

  try {
    const raw = await readStdin();

    if (hookType === "session-start" || hookType === "session-end") {
      // Session hooks only need to swallow arbitrary JSON and approve.
      parseSessionInput(raw); // validate but discard
      result = await route(hookType, { tool_name: "__session__", tool_input: {} });
    } else if (!raw.trim()) {
      result = { decision: "approve", reason: "Empty input" };
    } else {
      const input = parseInput(raw);
      result = await route(hookType, input);
    }
  } catch (err) {
    result = errorToResult(err);
  }

  if (hookType === "permission" && result.systemMessage !== undefined) {
    process.stdout.write(result.systemMessage + "\n");
  } else {
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}

// Only run main() when this module is the entry point — tests import safely.
const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("\\index.js"));
if (isEntry) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${message}\n`);
    process.exit(1);
  });
}
