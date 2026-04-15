/**
 * lifecycle.ts — セッションライフサイクル管理
 *
 * 旧セッション系スキル（session / session-init / session-control /
 * session-state / session-memory）のロジックを吸収。
 * セッション開始・終了・状態遷移を一元管理する。
 */
// ============================================================
// セッション開始（session-init 相当）
// ============================================================
/**
 * セッション開始処理。
 * 環境チェック・タスク状況把握・引き継ぎ確認を行う。
 */
export function initSession(opts) {
    const initialState = {
        session_id: opts.sessionId,
        mode: opts.mode ?? "normal",
        project_root: opts.projectRoot,
        started_at: new Date().toISOString(),
    };
    return {
        sessionId: opts.sessionId,
        startedAt: new Date(),
        phase: "active",
        state: initialState,
        recentFiles: [],
    };
}
// ============================================================
// セッション状態遷移（session-state / session-control 相当）
// ============================================================
/** 許可された状態遷移マップ */
const VALID_TRANSITIONS = {
    active: ["paused", "completed", "failed"],
    paused: ["active", "completed", "failed"],
    completed: [],
    failed: [],
};
/**
 * セッションフェーズを遷移させる。
 * 不正な遷移の場合は Error をスロー。
 */
export function transitionSession(ctx, next) {
    const allowed = VALID_TRANSITIONS[ctx.phase];
    if (!allowed.includes(next)) {
        throw new Error(`Invalid session transition: ${ctx.phase} → ${next}`);
    }
    return { ...ctx, phase: next };
}
/**
 * セッション終了処理。
 * 完了・失敗いずれの場合も呼び出す。
 */
export function finalizeSession(ctx, signals = []) {
    const duration = Date.now() - ctx.startedAt.getTime();
    return {
        sessionId: ctx.sessionId,
        duration,
        finalPhase: ctx.phase,
        signals,
    };
}
// ============================================================
// セッションフォーク（session-control の --fork 相当）
// ============================================================
/**
 * 現在のセッションコンテキストをフォークする。
 * 新しいセッション ID を割り当てた独立したコピーを返す。
 */
export function forkSession(parent, newSessionId) {
    const forkedState = {
        ...parent.state,
        session_id: newSessionId,
        started_at: new Date().toISOString(),
    };
    return {
        ...parent,
        sessionId: newSessionId,
        startedAt: new Date(),
        phase: "active",
        state: forkedState,
    };
}
/**
 * 過去セッションを再開する。
 * lastPhase が completed / failed の場合は新規セッションとして扱う。
 */
export function resumeSession(info) {
    const isResumable = info.lastPhase === "active" || info.lastPhase === "paused";
    const newId = isResumable
        ? info.sessionId
        : `${info.sessionId}-resumed`;
    const state = {
        session_id: newId,
        mode: info.mode,
        project_root: info.projectRoot,
        started_at: new Date().toISOString(),
    };
    return {
        sessionId: newId,
        startedAt: new Date(),
        phase: "active",
        state,
        recentFiles: [],
    };
}
//# sourceMappingURL=lifecycle.js.map