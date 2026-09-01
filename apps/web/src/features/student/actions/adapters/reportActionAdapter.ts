import type { StudentAction } from '../studentAction';

export interface ReportActionInput {
  scopeKey?: string;
  insights?: readonly ReportActionInsight[];
}

export interface ReportActionInsight {
  action: string;
  assessmentId?: string;
  questionId?: string;
}

export function buildReportActions(input: ReportActionInput): StudentAction[] {
  const scopeKey = input.scopeKey?.trim();
  if (!scopeKey) return [];

  const reportId = `report:${scopeKey}`;
  const actions: StudentAction[] = [{
    id: reportId,
    type: 'open_report',
    title: '查看学习报告',
    destination: 'test',
    source: 'report',
    context: { reportId },
  }];

  for (const insight of input.insights ?? []) {
    if (!isRealId(insight.assessmentId)) continue;
    if (insight.action === '查看测评报告') {
      actions.push({
        id: `report-assessment-review:${insight.assessmentId}`,
        type: 'assessment_review',
        title: '查看测评报告',
        destination: 'test',
        source: 'assessment',
        context: { assessmentId: insight.assessmentId },
      });
    } else if (insight.action === '去错题本' && isRealId(insight.questionId)) {
      actions.push({
        id: `report-wrong-question:${insight.assessmentId}:${insight.questionId}`,
        type: 'assessment_wrong_questions',
        title: '去错题本',
        destination: 'review',
        source: 'assessment',
        context: { assessmentId: insight.assessmentId, questionId: insight.questionId },
      });
    } else if (insight.action === '去练习薄弱点' && isRealId(insight.questionId)) {
      actions.push({
        id: `report-practice:${insight.assessmentId}:${insight.questionId}`,
        type: 'assessment_practice',
        title: '去练习薄弱点',
        destination: 'practice',
        source: 'assessment',
        context: { assessmentId: insight.assessmentId, questionId: insight.questionId },
      });
    }
  }

  return actions;
}

function isRealId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
