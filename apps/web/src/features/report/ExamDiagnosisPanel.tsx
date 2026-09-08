import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { fetchExamDiagnosis } from '../../api/endpoints/exam';
import type { ExamDiagnosis } from '../../api/types';
import './exam-diagnosis.css';

/**
 * LE-V10 F2 — mock-exam diagnosis view ("诊断书"). Read-only consumption of
 * the exam-diagnosis projection; every estimate carries its 估算 marker and
 * basis; missing target/plan sections degrade to explicit honest notes.
 */
export function ExamDiagnosisPanel({ sessionId }: { sessionId: string }) {
  const [diagnosis, setDiagnosis] = useState<ExamDiagnosis | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    setDiagnosis(null);
    setError('');
    (async () => {
      try {
        const payload = await fetchExamDiagnosis(sessionId);
        if (cancelled) return;
        setDiagnosis(payload);
      } catch {
        if (!cancelled) setError('诊断加载失败，请稍后重试。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (isStaticDemoMode()) return null;

  return (
    <section className="exam-diagnosis-panel" aria-label="模考诊断">
      <p className="exam-diagnosis-heading">模考诊断书</p>
      {error ? <p className="exam-diagnosis-note">{error}</p> : null}
      {!error && !diagnosis ? <p className="exam-diagnosis-note">诊断生成中…</p> : null}
      {diagnosis ? (
        <>
          {diagnosis.score150Estimate ? (
            <div className="exam-diagnosis-score">
              <strong>{diagnosis.score150Estimate.value}</strong>
              <span className="exam-diagnosis-estimate-badge">估算</span>
              <span>
                客观估算 {diagnosis.score150Estimate.objectiveEarnedEstimate}/{diagnosis.score150Estimate.objectiveMax} 分 ·
                主观题自评 {diagnosis.score150Estimate.subjectiveEarned}/{diagnosis.score150Estimate.subjectiveMax} 分
                （{diagnosis.score150Estimate.subjectiveNote}）
              </span>
              <span className="exam-diagnosis-basis">{diagnosis.score150Estimate.basis}（置信度：中）</span>
            </div>
          ) : (
            <p className="exam-diagnosis-note">本场练习未携带分值口径，无法估算 150 分制得分。</p>
          )}
          <ul className="exam-diagnosis-subjects">
            {diagnosis.perSubject.map((row) => (
              <li key={row.subject} title={row.scopeNote}>
                <span>{row.subject}</span>
                <span>正确率 {row.accuracyRate}% · 客观估算 {row.objectiveEarnedEstimate}/{row.objectiveMax} 分</span>
              </li>
            ))}
          </ul>
          {diagnosis.nodeLoss.length > 0 ? (
            <div className="exam-diagnosis-nodes">
              <p className="exam-diagnosis-subheading">失分知识点（按 丢题数 × 考频 排序）</p>
              <ul>
                {diagnosis.nodeLoss.map((row) => (
                  <li key={row.knowledgeNodeId}>
                    <span>{row.name}</span>
                    <span>
                      丢 {row.lostCount} 题
                      {row.stars > 0 ? ` · ${'★'.repeat(row.stars)} 近5年 ${row.recent5Frequency ?? 0} 次` : ' · 暂无真题数据'}
                    </span>
                  </li>
                ))}
              </ul>
              {diagnosis.nodeLossUnmappedCount > 0 ? (
                <p className="exam-diagnosis-note">另有 {diagnosis.nodeLossUnmappedCount} 道失分题未能归因到知识点。</p>
              ) : null}
            </div>
          ) : null}
          {diagnosis.gapDecomposition ? (
            <p className="exam-diagnosis-gap">
              距目标 {diagnosis.gapDecomposition.targetScore} 分：预计 {diagnosis.gapDecomposition.predictedScore150} 分，
              差 {diagnosis.gapDecomposition.gap} 分（估算）
            </p>
          ) : (
            <p className="exam-diagnosis-note">未设置目标分数，暂不进行差距对比。</p>
          )}
          {diagnosis.recoveryClosure ? (
            <p className="exam-diagnosis-closure">
              恢复计划闭环：{diagnosis.recoveryClosure.completedTasks}/{diagnosis.recoveryClosure.exposedTasks}
              （{diagnosis.recoveryClosure.closureRate}%）
            </p>
          ) : (
            <p className="exam-diagnosis-note">
              {diagnosis.recoveryClosureReason === 'recovery_plan_not_generated'
                ? '尚未生成恢复计划——使用报告页的“生成考后复习任务”把失分点变成任务。'
                : null}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
