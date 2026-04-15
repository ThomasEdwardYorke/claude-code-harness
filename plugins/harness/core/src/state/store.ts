/**
 * core/src/state/store.ts
 * Harness state store — pure JS JSON file implementation.
 *
 * Replaces the former better-sqlite3 backed implementation. The on-disk
 * layout is a single JSON file defined by `HarnessStateFile` in schema.ts.
 *
 * Concurrency model: each HarnessStore instance reads the file at construction
 * and writes the whole file after each mutating call. Single-process use is
 * safe; heavy concurrent multi-process use was never a real requirement
 * (the SQLite backend in the source harness was effectively dormant due to
 * a DB-path mismatch and never actually served such workloads).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

import {
  createEmptyState,
  SCHEMA_VERSION,
  type HarnessStateFile,
  type StoredFailure,
  type StoredSession,
  type StoredSignal,
  type StoredWorkState,
} from "./schema.js";
import type { Signal, SessionState, TaskFailure } from "../types.js";

// ============================================================
// HarnessStore
// ============================================================

export class HarnessStore {
  private readonly path: string;
  private state: HarnessStateFile;

  constructor(path: string) {
    this.path = path;
    this.state = this.load();
  }

  // ------------------------------------------------------------
  // File I/O
  // ------------------------------------------------------------

  private load(): HarnessStateFile {
    if (!existsSync(this.path)) {
      return createEmptyState();
    }
    const raw = readFileSync(this.path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HarnessStateFile>;
    // Defensive merge — ensures older partial files still load.
    const empty = createEmptyState();
    return {
      schema_version: parsed.schema_version ?? SCHEMA_VERSION,
      meta: { ...empty.meta, ...(parsed.meta ?? {}) },
      sessions: parsed.sessions ?? empty.sessions,
      signals: parsed.signals ?? empty.signals,
      task_failures: parsed.task_failures ?? empty.task_failures,
      work_states: parsed.work_states ?? empty.work_states,
      next_signal_id: parsed.next_signal_id ?? empty.next_signal_id,
      next_failure_id: parsed.next_failure_id ?? empty.next_failure_id,
    };
  }

  /** Atomic-ish write via temp file + rename. */
  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
    renameSync(tmp, this.path);
  }

  // ------------------------------------------------------------
  // Sessions
  // ------------------------------------------------------------

  upsertSession(session: SessionState): void {
    const startedAt = Math.floor(new Date(session.started_at).getTime() / 1000);
    const context = session.context ?? {};
    const existing = this.state.sessions.findIndex(
      (s) => s.session_id === session.session_id,
    );
    const row: StoredSession = {
      session_id: session.session_id,
      mode: session.mode,
      project_root: session.project_root,
      started_at: existing >= 0
        ? (this.state.sessions[existing]?.started_at ?? startedAt)
        : startedAt,
      ended_at: existing >= 0
        ? (this.state.sessions[existing]?.ended_at ?? null)
        : null,
      context,
    };
    if (existing >= 0) {
      this.state.sessions[existing] = row;
    } else {
      this.state.sessions.push(row);
    }
    this.persist();
  }

  endSession(sessionId: string): void {
    const endedAt = Math.floor(Date.now() / 1000);
    const row = this.state.sessions.find((s) => s.session_id === sessionId);
    if (row !== undefined) {
      row.ended_at = endedAt;
      this.persist();
    }
  }

  getSession(sessionId: string): SessionState | null {
    const row = this.state.sessions.find((s) => s.session_id === sessionId);
    if (row === undefined) return null;
    return {
      session_id: row.session_id,
      mode: row.mode,
      project_root: row.project_root,
      started_at: new Date(row.started_at * 1000).toISOString(),
      context: row.context,
    };
  }

  // ------------------------------------------------------------
  // Signals
  // ------------------------------------------------------------

  sendSignal(signal: Omit<Signal, "timestamp">): number {
    const sentAt = Math.floor(Date.now() / 1000);
    const id = this.state.next_signal_id;
    this.state.next_signal_id = id + 1;
    const row: StoredSignal = {
      id,
      type: signal.type,
      from_session_id: signal.from_session_id,
      to_session_id: signal.to_session_id ?? null,
      payload: signal.payload,
      sent_at: sentAt,
      consumed: 0,
    };
    this.state.signals.push(row);
    this.persist();
    return id;
  }

  receiveSignals(sessionId: string): Signal[] {
    const matches = this.state.signals.filter(
      (s) =>
        s.consumed === 0 &&
        (s.to_session_id === sessionId || s.to_session_id === null) &&
        s.from_session_id !== sessionId,
    );
    if (matches.length === 0) return [];
    matches.sort((a, b) => a.sent_at - b.sent_at);

    const out: Signal[] = matches.map((r) => {
      const signal: Signal = {
        type: r.type,
        from_session_id: r.from_session_id,
        payload: r.payload,
        timestamp: new Date(r.sent_at * 1000).toISOString(),
      };
      if (r.to_session_id !== null) {
        signal.to_session_id = r.to_session_id;
      }
      return signal;
    });

    const matchedIds = new Set(matches.map((r) => r.id));
    for (const row of this.state.signals) {
      if (matchedIds.has(row.id)) row.consumed = 1;
    }
    this.persist();
    return out;
  }

  // ------------------------------------------------------------
  // Task failures
  // ------------------------------------------------------------

  recordFailure(
    failure: Omit<TaskFailure, "timestamp">,
    sessionId: string,
  ): number {
    const failedAt = Math.floor(Date.now() / 1000);
    const id = this.state.next_failure_id;
    this.state.next_failure_id = id + 1;
    const row: StoredFailure = {
      id,
      task_id: failure.task_id,
      session_id: sessionId,
      severity: failure.severity,
      message: failure.message,
      detail: failure.detail ?? null,
      failed_at: failedAt,
      attempt: failure.attempt,
    };
    this.state.task_failures.push(row);
    this.persist();
    return id;
  }

  getFailures(taskId: string): TaskFailure[] {
    const matches = this.state.task_failures
      .filter((r) => r.task_id === taskId)
      .sort((a, b) => a.failed_at - b.failed_at);
    return matches.map((r) => {
      const out: TaskFailure = {
        task_id: r.task_id,
        severity: r.severity,
        message: r.message,
        timestamp: new Date(r.failed_at * 1000).toISOString(),
        attempt: r.attempt,
      };
      if (r.detail !== null) {
        out.detail = r.detail;
      }
      return out;
    });
  }

  // ------------------------------------------------------------
  // Work states (TTL 24h)
  // ------------------------------------------------------------

  setWorkState(
    sessionId: string,
    options: {
      codexMode?: boolean;
      bypassRmRf?: boolean;
      bypassGitPush?: boolean;
    } = {},
  ): void {
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
    const row: StoredWorkState = {
      session_id: sessionId,
      codex_mode: options.codexMode ? 1 : 0,
      bypass_rm_rf: options.bypassRmRf ? 1 : 0,
      bypass_git_push: options.bypassGitPush ? 1 : 0,
      expires_at: expiresAt,
    };
    const existing = this.state.work_states.findIndex(
      (s) => s.session_id === sessionId,
    );
    if (existing >= 0) {
      this.state.work_states[existing] = row;
    } else {
      this.state.work_states.push(row);
    }
    this.persist();
  }

  getWorkState(sessionId: string): {
    codexMode: boolean;
    bypassRmRf: boolean;
    bypassGitPush: boolean;
  } | null {
    const now = Math.floor(Date.now() / 1000);
    const row = this.state.work_states.find(
      (s) => s.session_id === sessionId && s.expires_at > now,
    );
    if (row === undefined) return null;
    return {
      codexMode: row.codex_mode === 1,
      bypassRmRf: row.bypass_rm_rf === 1,
      bypassGitPush: row.bypass_git_push === 1,
    };
  }

  cleanExpiredWorkStates(): number {
    const now = Math.floor(Date.now() / 1000);
    const before = this.state.work_states.length;
    this.state.work_states = this.state.work_states.filter(
      (s) => s.expires_at > now,
    );
    const removed = before - this.state.work_states.length;
    if (removed > 0) this.persist();
    return removed;
  }

  // ------------------------------------------------------------
  // Meta key/value
  // ------------------------------------------------------------

  getMeta(key: string): string | null {
    return this.state.meta[key] ?? null;
  }

  setMeta(key: string, value: string): void {
    this.state.meta[key] = value;
    this.persist();
  }

  // ------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------

  /** No-op in the JSON implementation — kept for API parity with the old SQLite store. */
  close(): void {
    // intentionally empty
  }
}
