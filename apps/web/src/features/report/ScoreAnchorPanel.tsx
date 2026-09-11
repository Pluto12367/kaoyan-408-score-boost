import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import {
  fetchScoreEvidence,
  type ScoreAssessmentView,
  type ScoreEvidenceBundle,
  type ScoreOutcomeView,
  type ScorePredictionView,
} from '../../api/endpoints/scores';
import './score-anchor.css';

const SOURCE_LABELS: Record<string, string> = {
  MOCK: '系统模考',
  DIAGNOSTIC: '入学诊断',
  TEACHER_GRADED: '教师判分',
  RUBRIC_GRADED: '采分点评分',
  REAL_EXAM: '真实考试',
  IMPORTED: '外部导入',
  UNKNOWN: '来源未记录',
  MODEL_OUTPUT: '系统预测',
};

const STATUS_LABELS: Record<string, { text: string; tone: 'idle' | 'insufficient' | 'preliminary' | 'passed' }> = {
  not_started: { text: '尚未开始：还没有可配对的预测与成绩', tone: 'idle' },
  insufficient_evidence: { text: '证据不足：有成对记录，但未达到预注册门槛（每组 ≥5 对且中位误差 <15 分）', tone: 'insufficient' },
  preliminary: { text: '已有初步校准证据：样本已达到门槛数量，但预测误差尚未达标', tone: 'preliminary' },
  gate_passed: { text: '已达到校准门槛：该来源的预测误差通过了预注册检验', tone: 'passed' },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '日期未知';
  return value.slice(0, 10);
}

function scoreOf(row: ScoreAssessmentView | ScoreOutcomeView): string {
  if (row.normalizedScore == null) return '—';
  return `${row.normalizedScore} / 150 分`;
}

/**
 * S1 Score Anchor — student-facing ledger view.
 *
 * Honesty contract (mirrors the backend invariants):
 *   • prediction, assessment and outcome are always visually separate
 *     sections — a prediction is never rendered as an actual score
 *   • every row shows where its number came from; UNKNOWN provenance says so
 *   • the calibration status is one of four honest states and never claims
 *     "已验证/已校准" below the preregistered gate
 *   • without any ledger row the panel says so instead of rendering zeros
 *   • static demo mode renders nothing (no fake scores for no real student)
 */
export function ScoreAnchorPanel() {
  const [evidence, setEvidence] = useState<ScoreEvidenceBundle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    fetchScoreEvidence()
      .then((result) => {
        if (cancelled) return;
        setEvidence(result);
        setError('');
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '成绩锚点数据加载失败，请重试。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) return null;

  if (error) {
    return (
      <section className="score-anchor" aria-label="成绩锚点">
        <h3 className="score-anchor-title">成绩锚点</h3>
        <p className="score-anchor-error">{error}</p>
      </section>
    );
  }
  if (!evidence) {
    return (
      <section className="score-anchor" aria-label="成绩锚点">
        <h3 className="score-anchor-title">成绩锚点</h3>
        <p className="score-anchor-muted">正在加载成绩锚点…</p>
      </section>
    );
  }
  if (!evidence.storeAvailable) {
    return (
      <section className="score-anchor" aria-label="成绩锚点">
        <h3 className="score-anchor-title">成绩锚点</h3>
        <p className="score-anchor-muted">数据存储未就绪，因此不显示任何成绩记录。</p>
      </section>
    );
  }

  const hasNothing = evidence.predictions.length === 0
    && evidence.assessments.length === 0
    && evidence.outcomes.length === 0;

  const status = STATUS_LABELS[evidence.calibrationEvidence.status] ?? STATUS_LABELS.not_started;
  const anchor = evidence.anchors;

  return (
    <section className="score-anchor" aria-label="成绩锚点">
      <h3 className="score-anchor-title">成绩锚点</h3>
      <p className="score-anchor-exam-date">
        考试日期：{evidence.examDate ? formatDate(evidence.examDate) : '未设置（可在个人信息中录入，剩余天数将由考试日推导）'}
      </p>

      {hasNothing ? (
        <p className="score-anchor-empty">
          还没有任何成绩记录。做一次教师判分的全真模考，或在「导入成绩」中录入一次外部成绩，
          系统才会建立你的第一个可信成绩锚点——未测之前系统不会替你编造分数。
        </p>
      ) : (
        <>
          {anchor.verifiedOutcome ? (
            <div className="score-anchor-anchorbox">
              <span className="score-anchor-badge score-anchor-badge-verified">当前可信成绩锚</span>
              <OutcomeRow row={anchor.verifiedOutcome} />
            </div>
          ) : anchor.latestAssessment ? (
            <div className="score-anchor-anchorbox">
              <span className="score-anchor-badge">最近测评（尚无已验证成绩）</span>
              <AssessmentRow row={anchor.latestAssessment} />
            </div>
          ) : null}

          <h4 className="score-anchor-subtitle">系统预测（估算，不是成绩）</h4>
          {evidence.predictions.length === 0 ? (
            <p className="score-anchor-muted">还没有持久化的预测记录。</p>
          ) : (
            <ul className="score-anchor-list">
              {evidence.predictions.map((row) => (
                <PredictionRow key={row.id} row={row} />
              ))}
            </ul>
          )}

          <h4 className="score-anchor-subtitle">最近测评与成绩</h4>
          <ul className="score-anchor-list">
            {evidence.assessments.map((row) => (
              <AssessmentRow key={row.id} row={row} />
            ))}
            {evidence.outcomes.map((row) => (
              <OutcomeRow key={row.id} row={row} />
            ))}
          </ul>

          <div className={`score-anchor-calibration score-anchor-calibration-${status.tone}`}>
            <span className="score-anchor-calibration-status">校准状态：{status.text}</span>
            {evidence.calibrationEvidence.strata.length > 0 ? (
              <ul className="score-anchor-strata">
                {evidence.calibrationEvidence.strata.map((stratum) => (
                  <li key={stratum.source}>
                    {SOURCE_LABELS[stratum.source] ?? stratum.source}：{stratum.n} 对
                    （{stratum.gatePass ? '通过门槛' : '未通过门槛'}）
                  </li>
                ))}
              </ul>
            ) : null}
            {evidence.calibrationEvidence.pendingVerification > 0 ? (
              <p className="score-anchor-muted">
                有 {evidence.calibrationEvidence.pendingVerification} 条成绩待教师/管理员验证，验证前不参与校准。
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function PredictionRow({ row }: { row: ScorePredictionView }) {
  return (
    <li className="score-anchor-row score-anchor-row-prediction">
      <span className="score-anchor-badge score-anchor-badge-prediction">预测</span>
      <span className="score-anchor-value">
        {row.predictedScore} / 150 分
        {row.predictedMinScore != null && row.predictedMaxScore != null
          ? `（区间 ${row.predictedMinScore}–${row.predictedMaxScore}）`
          : ''}
      </span>
      <span className="score-anchor-meta">
        {formatDate(row.generatedAt)} · {row.modelVersion}
      </span>
    </li>
  );
}

function AssessmentRow({ row }: { row: ScoreAssessmentView }) {
  return (
    <li className="score-anchor-row">
      <span className="score-anchor-badge">{SOURCE_LABELS[row.source] ?? row.source}</span>
      <span className="score-anchor-value">{scoreOf(row)}</span>
      <span className="score-anchor-meta">
        {row.title ?? row.originType} · {formatDate(row.examDate)}
        {row.semantic === 'accuracy_rate' ? ' · 正确率口径' : ''}
        {row.corrected ? ` · 已修正（${row.correctionCount} 次）` : ''}
      </span>
    </li>
  );
}

function OutcomeRow({ row }: { row: ScoreOutcomeView }) {
  return (
    <li className="score-anchor-row score-anchor-row-outcome">
      <span className={`score-anchor-badge ${row.verificationStatus === 'verified' ? 'score-anchor-badge-verified' : ''}`}>
        {SOURCE_LABELS[row.source] ?? row.source}
        {row.verificationStatus === 'verified' ? ' · 已验证' : ' · 待验证'}
      </span>
      <span className="score-anchor-value">{scoreOf(row)}</span>
      <span className="score-anchor-meta">
        {row.examType} · {formatDate(row.occurredAt)}
        {row.corrected ? ` · 已修正（${row.correctionCount} 次）` : ''}
      </span>
    </li>
  );
}
