/**
 * core/src/state/migration.ts
 * Migration of legacy v2 JSON / JSONL state files into the v3 JSON store.
 *
 * Source files (legacy v2):
 *   .claude/state/session.json        → sessions
 *   .claude/state/session.events.jsonl → signals
 *   .claude/work-active.json           → work_states
 *
 * Destination: single JSON file at <projectRoot>/.claude/state/harness.json
 * (see ./schema.ts).
 *
 * The migration is idempotent — a meta key `migration_v1_done = "1"` is
 * written on successful completion, and subsequent runs are skipped.
 */

import { readFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import type { SignalType } from "../types.js";
import { HarnessStore } from "./store.js";

// ============================================================
// v2 source shapes
// ============================================================

interface V2Session {
  session_id?: string;
  id?: string;
  mode?: string;
  project_root?: string;
  started_at?: string | number;
  ended_at?: string | number | null;
  context?: Record<string, unknown>;
}

interface V2Event {
  type?: string;
  event?: string;
  session_id?: string;
  from_session_id?: string;
  to_session_id?: string | null;
  payload?: Record<string, unknown>;
  data?: Record<string, unknown>;
  timestamp?: string | number;
  sent_at?: string | number;
}

interface V2WorkActive {
  session_id?: string;
  codex_mode?: boolean;
  bypass_rm_rf?: boolean;
  bypass_git_push?: boolean;
  mode?: string;
}

// ============================================================
// Helpers
// ============================================================

function toIsoString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return new Date().toISOString();
  }
  if (typeof value === "number") {
    const ms = value > 1e10 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return value;
}

function normalizeMode(
  mode: string | undefined,
): "normal" | "work" | "codex" | "breezing" {
  switch (mode) {
    case "work":
    case "codex":
    case "breezing":
      return mode;
    default:
      return "normal";
  }
}

function normalizeSignalType(type: string | undefined): SignalType {
  const valid: SignalType[] = [
    "task_completed",
    "task_failed",
    "teammate_idle",
    "session_start",
    "session_end",
    "request_review",
  ];
  if (type && (valid as string[]).includes(type)) return type as SignalType;
  return "task_completed";
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function readJsonlFile<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

// ============================================================
// Migration
// ============================================================

export interface MigrationResult {
  sessions: number;
  signals: number;
  workStates: number;
  skipped: boolean;
  errors: string[];
}

/**
 * Default location of the v3 state file.
 */
export function defaultStatePath(projectRoot: string): string {
  return resolve(projectRoot, ".claude", "state", "harness.json");
}

/**
 * Migrate legacy v2 JSON/JSONL files into the v3 JSON store.
 *
 * @param projectRoot - Project root path (default: process.cwd()).
 * @param statePath   - Destination JSON file (default: `<projectRoot>/.claude/state/harness.json`).
 */
export function migrate(
  projectRoot: string = process.cwd(),
  statePath?: string,
): MigrationResult {
  const stateDir = resolve(projectRoot, ".claude", "state");
  const resolvedStatePath = statePath ?? defaultStatePath(projectRoot);

  const result: MigrationResult = {
    sessions: 0,
    signals: 0,
    workStates: 0,
    skipped: false,
    errors: [],
  };

  const store = new HarnessStore(resolvedStatePath);

  try {
    if (store.getMeta("migration_v1_done") === "1") {
      result.skipped = true;
      return result;
    }

    // 1. session.json → sessions
    const sessionFile = resolve(stateDir, "session.json");
    const v2Session = readJsonFile<V2Session>(sessionFile);
    if (v2Session !== null) {
      const sessionId = v2Session.session_id ?? v2Session.id ?? "migrated-session";
      try {
        store.upsertSession({
          session_id: sessionId,
          mode: normalizeMode(v2Session.mode),
          project_root: v2Session.project_root ?? projectRoot,
          started_at: toIsoString(v2Session.started_at),
        });
        if (v2Session.ended_at !== null && v2Session.ended_at !== undefined) {
          store.endSession(sessionId);
        }
        result.sessions++;
      } catch (err) {
        result.errors.push(`session migration failed: ${String(err)}`);
      }
    }

    // 2. session.events.jsonl → signals
    const eventsFile = resolve(stateDir, "session.events.jsonl");
    const v2Events = readJsonlFile<V2Event>(eventsFile);
    for (const event of v2Events) {
      const type = normalizeSignalType(event.type ?? event.event);
      const fromSessionId =
        event.from_session_id ?? event.session_id ?? "unknown";
      const payload = event.payload ?? event.data ?? {};
      try {
        const signal: Parameters<HarnessStore["sendSignal"]>[0] = {
          type,
          from_session_id: fromSessionId,
          payload,
        };
        if (event.to_session_id) {
          signal.to_session_id = event.to_session_id;
        }
        store.sendSignal(signal);
        result.signals++;
      } catch (err) {
        result.errors.push(
          `signal migration failed (type=${type}): ${String(err)}`,
        );
      }
    }

    // 3. work-active.json → work_states
    const workActiveFile = resolve(projectRoot, ".claude", "work-active.json");
    const v2WorkActive = readJsonFile<V2WorkActive>(workActiveFile);
    if (v2WorkActive !== null) {
      const sessionId = v2WorkActive.session_id ?? "migrated-work-session";
      try {
        store.upsertSession({
          session_id: sessionId,
          mode: normalizeMode(v2WorkActive.mode ?? "work"),
          project_root: projectRoot,
          started_at: new Date().toISOString(),
        });
        store.setWorkState(sessionId, {
          codexMode: v2WorkActive.codex_mode ?? false,
          bypassRmRf: v2WorkActive.bypass_rm_rf ?? false,
          bypassGitPush: v2WorkActive.bypass_git_push ?? false,
        });
        result.workStates++;
      } catch (err) {
        result.errors.push(`work_state migration failed: ${String(err)}`);
      }
    }

    store.setMeta("migration_v1_done", "1");

    // Back up source files (do not delete — user can audit).
    if (v2Session !== null && existsSync(sessionFile)) {
      try {
        renameSync(sessionFile, `${sessionFile}.v2.bak`);
      } catch {
        // Ignore — migration itself succeeded.
      }
    }
  } finally {
    store.close();
  }

  return result;
}

// ============================================================
// CLI entry (node dist/state/migration.js [projectRoot] [statePath])
// ============================================================

const isMain = process.argv[1]?.endsWith("migration.js");
if (isMain) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const statePath = process.argv[3];
  const result = migrate(projectRoot, statePath);
  if (result.skipped) {
    console.log("Migration already completed. Skipped.");
    process.exit(0);
  }
  if (result.errors.length > 0) {
    console.error("Migration completed with errors:");
    for (const err of result.errors) console.error(`  - ${err}`);
  }
  console.log(
    `Migration done: ${result.sessions} sessions, ${result.signals} signals, ${result.workStates} work_states`,
  );
  process.exit(result.errors.length > 0 ? 1 : 0);
}
