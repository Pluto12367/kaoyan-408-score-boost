/**
 * V14 ①（Owner 批准 D-V-1′/D-V-2/D-V-3，2026-09-27）— 提分账本声明纯模块。
 * 设计 docs/v14-flagship-detailed-design.md §1.4。
 *
 * 两层口径（D-V-1′）：
 *   • 同题追回（buildScoreRecovery 的 recovered 行）→ 声明等级随失分行 lossKind；
 *     未定价失分（priced=false）追回 → 只计数，金额 null（NULL ≠ 0）。
 *   • 同节点补偿（同 nodeId 后续正确作答但非原题）→ PROXY，绝不进 OBSERVED。
 *
 * 声明门槛（D-V-2）：recovered 候选 < minSamples → insufficient_data，零金额输出。
 * RULE-11：本模块一切输出都不得称为 Verified Score Gain——语义脚注固定输出。
 *
 * Pure: 零 IO，确定性。
 */

import type { ScoreRecoveryRow } from './score-recovery';

export type RecoveryClaimKind = 'OBSERVED' | 'PROXY';

export interface RecoveryClaim {
  kind: RecoveryClaimKind;
  /** null = 未定价失分被追回（只计数，绝不定价）。 */
  recoveredScore: number | null;
  /** PROXY 层（同节点补偿）无原题。 */
  questionId: string | null;
  nodeId: string | null;
  nodeName: string | null;
  /** 证据链人读描述：哪次丢 → 哪次追回。 */
  note: string;
}

export interface RecoveryClaimsResult {
  claims: RecoveryClaim[];
  proxyClaims: RecoveryClaim[];
  summary: {
    observedRecovered: number;
    proxyRecovered: number;
    unpricedRecovered: number;
    recoveredCandidates: number;
    insufficient: boolean;
    minSamples: number;
  };
}

export const RECOVERY_CLAIM_FOOTNOTE =
  '挽回分 = 失分被后续正确作答追回的测量值，不是成绩预测。PROXY 行（同考点补偿、AI/自评判分的失分）与 OBSERVED 行分列，绝不合并。';

export interface BuildRecoveryClaimsInput {
  rows: readonly ScoreRecoveryRow[];
  minSamples: number;
  nodeNameById: ReadonlyMap<string, string>;
}

export function buildRecoveryClaims(input: BuildRecoveryClaimsInput): RecoveryClaimsResult {
  const recoveredRows = input.rows.filter((row) => row.status === 'recovered');
  const recoveredCandidates = recoveredRows.length;
  // D-V-2：样本不足 → 不输出任何金额声明（RULE-06：insufficient_data 不是 0）。
  const insufficient = recoveredCandidates < input.minSamples;

  if (insufficient) {
    return {
      claims: [],
      proxyClaims: [],
      summary: {
        observedRecovered: 0,
        proxyRecovered: 0,
        unpricedRecovered: 0,
        recoveredCandidates,
        insufficient: true,
        minSamples: input.minSamples,
      },
    };
  }

  const claims: RecoveryClaim[] = [];
  const proxyClaims: RecoveryClaim[] = [];
  let observedRecovered = 0;
  let proxyRecovered = 0;
  let unpricedRecovered = 0;

  for (const row of recoveredRows) {
    const nodeName = row.nodeId != null ? input.nodeNameById.get(row.nodeId) ?? null : null;
    const note = `${row.lastLossAt.slice(0, 10)} 失分 → ${row.latestReattemptAt?.slice(0, 10) ?? '?'} 复做全对（${row.reattemptSources.join('/')}）`;

    // OBSERVED 层：失分行自身是 OBSERVED。
    if (row.observedLossWithReattemptSuccess > 0) {
      observedRecovered += row.observedLossWithReattemptSuccess;
      claims.push({
        kind: 'OBSERVED',
        recoveredScore: row.observedLossWithReattemptSuccess,
        questionId: row.questionId,
        nodeId: row.nodeId,
        nodeName,
        note,
      });
    }

    // PROXY 层：proxy 失分被追回（自评/AI 判定的失分）。
    if (row.proxyLossWithReattemptSuccess > 0) {
      proxyRecovered += row.proxyLossWithReattemptSuccess;
      proxyClaims.push({
        kind: 'PROXY',
        recoveredScore: row.proxyLossWithReattemptSuccess,
        questionId: row.questionId,
        nodeId: row.nodeId,
        nodeName,
        note,
      });
    }

    // 未定价失分被追回：只计数。
    if (!row.priced) {
      unpricedRecovered += 1;
      claims.push({
        kind: row.observedLostScore > 0 || row.proxyLostScore > 0 ? 'PROXY' : 'OBSERVED',
        recoveredScore: null,
        questionId: row.questionId,
        nodeId: row.nodeId,
        nodeName,
        note: `${note}（原失分未定价——只计数，不计金额）`,
      });
    }
  }

  return {
    claims,
    proxyClaims,
    summary: {
      observedRecovered,
      proxyRecovered,
      unpricedRecovered,
      recoveredCandidates,
      insufficient: false,
      minSamples: input.minSamples,
    },
  };
}
