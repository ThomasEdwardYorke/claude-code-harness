/**
 * lifecycle.ts — セッションライフサイクル管理
 *
 * 旧セッション系スキル（session / session-init / session-control /
 * session-state / session-memory）のロジックを吸収。
 * セッション開始・終了・状態遷移を一元管理する。
 */
import type { SessionState, SessionMode, Signal } from "../types.js";
/** セッションの実行フェーズ */
export type SessionPhase = "active" | "paused" | "completed" | "failed";
/** セッションコンテキスト */
export interface SessionContext {
    sessionId: string;
    startedAt: Date;
    phase: SessionPhase;
    state: SessionState;
    /** 直近の agent-trace エントリ */
    recentFiles: string[];
}
/**
 * セッション開始処理。
 * 環境チェック・タスク状況把握・引き継ぎ確認を行う。
 */
export declare function initSession(opts: {
    sessionId: string;
    projectRoot: string;
    mode?: SessionMode;
}): SessionContext;
/**
 * セッションフェーズを遷移させる。
 * 不正な遷移の場合は Error をスロー。
 */
export declare function transitionSession(ctx: SessionContext, next: SessionPhase): SessionContext;
/** セッション終了時のサマリー */
export interface SessionSummary {
    sessionId: string;
    duration: number;
    finalPhase: SessionPhase;
    signals: Signal[];
}
/**
 * セッション終了処理。
 * 完了・失敗いずれの場合も呼び出す。
 */
export declare function finalizeSession(ctx: SessionContext, signals?: Signal[]): SessionSummary;
/**
 * 現在のセッションコンテキストをフォークする。
 * 新しいセッション ID を割り当てた独立したコピーを返す。
 */
export declare function forkSession(parent: SessionContext, newSessionId: string): SessionContext;
/** セッション再開用の最小情報 */
export interface ResumeInfo {
    sessionId: string;
    projectRoot: string;
    mode: SessionMode;
    lastPhase: SessionPhase;
}
/**
 * 過去セッションを再開する。
 * lastPhase が completed / failed の場合は新規セッションとして扱う。
 */
export declare function resumeSession(info: ResumeInfo): SessionContext;
//# sourceMappingURL=lifecycle.d.ts.map