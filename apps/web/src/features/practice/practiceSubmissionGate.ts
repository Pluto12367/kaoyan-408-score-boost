/**
 * 答题提交请求门控：只管理请求生命周期（同步占锁 + 旧请求失效），
 * 不承载答题结果等业务状态（结果仍由 App 的 React state 管理）。
 *
 * 背景：handleSubmitAnswer 是异步请求，重做/变式复测/切题会立即重置
 * 答题尝试状态；若旧请求随后返回并写回，会把新尝试覆盖。本模块用
 * attemptVersion + requestId 双校验，使旧请求无法写回或释放新请求。
 */
export interface PracticeSubmissionToken {
  attemptVersion: number;
  requestId: number;
}

export interface PracticeSubmissionGate {
  attemptVersion: number;
  nextRequestId: number;
  activeSubmission: PracticeSubmissionToken | null;
}

export function createPracticeSubmissionGate(): PracticeSubmissionGate {
  return { attemptVersion: 0, nextRequestId: 0, activeSubmission: null };
}

/**
 * 同步占用提交权：同一答题尝试已有活动请求时返回 null（拒绝第二次提交）。
 * 成功时返回本次请求 token，之后 `setPracticeSubmitting(true)` 才可执行。
 */
export function tryStartPracticeSubmission(
  gate: PracticeSubmissionGate,
): PracticeSubmissionToken | null {
  if (gate.activeSubmission !== null) return null;
  const token: PracticeSubmissionToken = {
    attemptVersion: gate.attemptVersion,
    requestId: gate.nextRequestId,
  };
  gate.nextRequestId += 1;
  gate.activeSubmission = token;
  return token;
}

/**
 * 重做 / 变式复测 / 切题等开始新答题尝试时调用：
 * 递增尝试版本并使所有旧请求失效（清空 activeSubmission）。
 */
export function invalidatePracticeAttempt(gate: PracticeSubmissionGate): void {
  gate.attemptVersion += 1;
  gate.activeSubmission = null;
}

/**
 * 异步请求返回后、写回任何本次提交相关状态前调用：
 * 仅当 token 仍是当前活动请求时才允许写回。
 */
export function isCurrentPracticeSubmission(
  gate: PracticeSubmissionGate,
  token: PracticeSubmissionToken | null,
): boolean {
  if (gate.activeSubmission === null || token === null) return false;
  return (
    gate.activeSubmission.attemptVersion === token.attemptVersion
    && gate.activeSubmission.requestId === token.requestId
  );
}

/**
 * 请求 finally 中调用：仅当前活动请求可以释放门控并返回 true；
 * 旧请求返回 false，不会清除新请求的活动状态。
 */
export function finishPracticeSubmission(
  gate: PracticeSubmissionGate,
  token: PracticeSubmissionToken,
): boolean {
  if (gate.activeSubmission === null) return false;
  if (
    gate.activeSubmission.attemptVersion !== token.attemptVersion
    || gate.activeSubmission.requestId !== token.requestId
  ) return false;
  gate.activeSubmission = null;
  return true;
}
