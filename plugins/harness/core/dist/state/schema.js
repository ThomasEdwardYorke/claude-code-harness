/**
 * core/src/state/schema.ts
 * Harness state store — JSON schema (pure JS implementation).
 *
 * v0.1.0 replaces the previous SQLite layout with a single JSON file at
 * `<projectRoot>/.claude/state/harness.json`. This eliminates the native
 * `better-sqlite3` dependency and removes all cross-platform build pain,
 * which was the dominant portability issue for the original harness.
 *
 * The shape below is written to disk verbatim. Bump SCHEMA_VERSION and add
 * a migration in `migration.ts` whenever fields change.
 */
export const SCHEMA_VERSION = 1;
/** Create an empty state file with the current schema version. */
export function createEmptyState() {
    return {
        schema_version: SCHEMA_VERSION,
        meta: {},
        sessions: [],
        signals: [],
        task_failures: [],
        work_states: [],
        next_signal_id: 1,
        next_failure_id: 1,
    };
}
//# sourceMappingURL=schema.js.map