/**
 * core/src/guardrails/permission.ts
 * PermissionRequest フック評価関数
 *
 * permission-request.sh の全ロジックを TypeScript に移植。
 * 安全なコマンド（read-only git、テストコマンド等）を自動承認する。
 *
 * 参照元: scripts/permission-request.sh
 */
import { type HookInput, type HookResult } from "../types.js";
/**
 * PermissionRequest フックの評価関数。
 *
 * Edit/Write は bypassPermissions 相当で自動承認。
 * Bash は安全なコマンドパターンのみ自動承認。
 * その他は何も返さず（デフォルト動作 = ユーザーに確認）。
 */
export declare function evaluatePermission(input: HookInput): HookResult;
/**
 * PermissionRequest フック用の stdout 出力を生成する。
 * index.ts の route() から "permission" フックタイプ時に呼び出す。
 */
export declare function formatPermissionOutput(result: HookResult): string;
//# sourceMappingURL=permission.d.ts.map