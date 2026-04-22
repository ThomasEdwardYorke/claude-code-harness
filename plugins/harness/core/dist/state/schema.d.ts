/**
 * core/src/state/schema.ts
 * Harness state store — JSON schema (pure JS implementation).
 *
 * As of v0.1.0 this module replaces the previous SQLite layout with a single JSON file at
 * `<projectRoot>/.claude/state/harness.json`. This eliminates the native
 * `better-sqlite3` dependency and removes all cross-platform build pain,
 * which was the dominant portability issue for the original harness.
 *
 * The shape below is written to disk verbatim. Bump SCHEMA_VERSION and add
 * a migration in `migration.ts` whenever fields change.
 */
import type { SessionState, Signal, TaskFailure } from "../types.js";
export declare const SCHEMA_VERSION = 1;
/** Session row as persisted to disk. */
export interface StoredSession {
    session_id: string;
    mode: SessionState["mode"];
    project_root: string;
    /** Unix seconds. */
    started_at: number;
    /** Unix seconds, null while the session is active. */
    ended_at: number | null;
    context: Record<string, unknown>;
}
/** Signal row as persisted to disk. */
export interface StoredSignal {
    id: number;
    type: Signal["type"];
    from_session_id: string;
    /** null means broadcast. */
    to_session_id: string | null;
    payload: Record<string, unknown>;
    /** Unix seconds. */
    sent_at: number;
    /** 0 = unread, 1 = consumed. */
    consumed: 0 | 1;
}
/** Task failure row as persisted to disk. */
export interface StoredFailure {
    id: number;
    task_id: string;
    session_id: string;
    severity: TaskFailure["severity"];
    message: string;
    detail: string | null;
    /** Unix seconds. */
    failed_at: number;
    attempt: number;
}
/** Per-session ephemeral state (TTL 24h). */
export interface StoredWorkState {
    session_id: string;
    codex_mode: 0 | 1;
    bypass_rm_rf: 0 | 1;
    bypass_git_push: 0 | 1;
    /** Unix seconds. */
    expires_at: number;
}
/** Top-level shape of `.claude/state/harness.json`. */
export interface HarnessStateFile {
    schema_version: number;
    meta: Record<string, string>;
    sessions: StoredSession[];
    signals: StoredSignal[];
    task_failures: StoredFailure[];
    work_states: StoredWorkState[];
    /** Monotonically increasing signal id. */
    next_signal_id: number;
    /** Monotonically increasing failure id. */
    next_failure_id: number;
}
/** Create an empty state file with the current schema version. */
export declare function createEmptyState(): HarnessStateFile;
//# sourceMappingURL=schema.d.ts.map