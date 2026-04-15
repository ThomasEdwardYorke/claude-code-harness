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
export declare function defaultStatePath(projectRoot: string): string;
/**
 * Migrate legacy v2 JSON/JSONL files into the v3 JSON store.
 *
 * @param projectRoot - Project root path (default: process.cwd()).
 * @param statePath   - Destination JSON file (default: `<projectRoot>/.claude/state/harness.json`).
 */
export declare function migrate(projectRoot?: string, statePath?: string): MigrationResult;
//# sourceMappingURL=migration.d.ts.map