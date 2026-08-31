import type { PracticeSetResult, StageAssessmentResult } from '../../../../api/types';
import type { StudentAction } from '../studentAction';

export function buildAssessmentActions(result: StageAssessmentResult | null): StudentAction[] {
  if (!result || !isRealId(result.id)) return [];

  const assessmentId = result.id;
  const actions: StudentAction[] = [
    {
      id: `assessment-review:${assessmentId}`,
      type: 'assessment_review',
      title: '复盘阶段测评',
      destination: 'test',
      source: 'assessment',
      context: { assessmentId },
    },
  ];

  for (const item of result.reviewItems) {
    if (!isRealId(item.questionId)) continue;
    actions.push({
      id: `assessment-wrong-question:${assessmentId}:${item.questionId}`,
      type: 'assessment_wrong_questions',
      title: item.stem,
      destination: 'review',
      source: 'assessment',
      ...(item.mistakeReason ? { reason: item.mistakeReason } : {}),
      context: { assessmentId, questionId: item.questionId },
    });
  }

  actions.push(
    {
      id: `assessment-practice:${assessmentId}`,
      type: 'assessment_practice',
      title: '进行针对性练习',
      destination: 'practice',
      source: 'assessment',
      context: { assessmentId },
    },
    {
      id: `assessment-report:${assessmentId}`,
      type: 'open_report',
      title: '查看阶段测评报告',
      destination: 'test',
      source: 'assessment',
      context: { reportId: `assessment:${assessmentId}`, assessmentId },
    },
  );

  return actions;
}

export function buildPracticeSetActions(result: PracticeSetResult | null): StudentAction[] {
  if (!result) return [];

  return result.results.flatMap((item): StudentAction[] => {
    if (item.correct || !isRealId(item.questionId)) return [];
    return [{
      id: `practice-result-question:${item.questionId}`,
      type: 'practice_recommended',
      title: item.stem,
      destination: 'practice',
      source: 'training',
      ...(item.mistakeReason ? { reason: item.mistakeReason } : {}),
      context: { questionId: item.questionId },
    }];
  });
}

function isRealId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
