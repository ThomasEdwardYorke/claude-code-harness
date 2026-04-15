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
import type { Signal, SessionState, TaskFailure } from "../types.js";
export declare class HarnessStore {
    private readonly path;
    private state;
    constructor(path: string);
    private load;
    /** Atomic-ish write via temp file + rename. */
    private persist;
    upsertSession(session: SessionState): void;
    endSession(sessionId: string): void;
    getSession(sessionId: string): SessionState | null;
    sendSignal(signal: Omit<Signal, "timestamp">): number;
    receiveSignals(sessionId: string): Signal[];
    recordFailure(failure: Omit<TaskFailure, "timestamp">, sessionId: string): number;
    getFailures(taskId: string): TaskFailure[];
    setWorkState(sessionId: string, options?: {
        codexMode?: boolean;
        bypassRmRf?: boolean;
        bypassGitPush?: boolean;
    }): void;
    getWorkState(sessionId: string): {
        codexMode: boolean;
        bypassRmRf: boolean;
        bypassGitPush: boolean;
    } | null;
    cleanExpiredWorkStates(): number;
    getMeta(key: string): string | null;
    setMeta(key: string, value: string): void;
    /** No-op in the JSON implementation — kept for API parity with the old SQLite store. */
    close(): void;
}
//# sourceMappingURL=store.d.ts.map