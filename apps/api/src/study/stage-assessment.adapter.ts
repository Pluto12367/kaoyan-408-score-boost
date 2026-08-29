// StageAssessmentAdapter is a pure snapshot+selection -> legacy DTO mapper.
// It does NOT query the database, access repositories, recompute study state,
// or run selection strategy. It only converts already-produced facts into the
// legacy-compatible DTO shape and generates UI copy/fallbacks.
import type { StageAssessmentSnapshot } from './stage-assessment.snapshot';
import type { StageAssessmentSelection } from './stage-assessment.selector';
import { studyDateKey } from './study-date';

export interface LegacyStageAssessmentDto {
  id: string;
  title: string;
  userId: string;
  description: string;
  stage: string;
  estimatedMinutes: number;
  focusKnowledgePoints: Array<{ id: string; subject: string; chapter: string; title: string; importance: number }>;
  questions: Array<{
    id: string;
    stem: string;
    difficulty: string;
    type: string;
    source: string | null;
    year: number | null;
    knowledgePointIds: string[];
    expectedTimeSec: number;
  }>;
  summary: {
    attemptCount: number;
    bestScore: number | null;
    latestScore: number | null;
    latestAccuracyRate: number | null;
  };
  reason: string;
  actionText: string;
  generatedAt: string;
}

export function toLegacyStageAssessment(
  snapshot: StageAssessmentSnapshot,
  selection: StageAssessmentSelection,
  generatedAt = snapshot.asOf,
): LegacyStageAssessmentDto {
  const stage = snapshot.studentFacts.stage ?? '强化';
  const selected = selection.selectedQuestions;
  const estimatedMinutes = selected.length
    ? Math.max(10, Math.round(selected.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60))
    : 10;

  return {
    id: `stage-${studyDateKey(generatedAt)}`,
    title: `${stage}阶段测评`,
    userId: snapshot.userId,
    description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
    stage,
    estimatedMinutes,
    focusKnowledgePoints: selection.focusKnowledgePoints.map((point) => ({ ...point })),
    questions: selected.map((question) => ({ ...question })),
    summary: {
      attemptCount: snapshot.assessmentFacts.attemptCount,
      bestScore: snapshot.assessmentFacts.bestScore,
      latestScore: snapshot.assessmentFacts.latestScore,
      latestAccuracyRate: snapshot.assessmentFacts.latestAccuracyRate,
    },
    reason: selection.focusKnowledgePoints.length
      ? `围绕 ${selection.focusKnowledgePoints[0].title} 等薄弱知识点生成。`
      : '根据当前学习情况生成阶段小测。',
    actionText: selected.length ? '开始测评' : '暂无可用题目',
    generatedAt,
  };
}
