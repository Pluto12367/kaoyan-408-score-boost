import type { StudentAction } from '../../student/actions/studentAction';

export type TrainingRoomSource = 'today_task' | 'practice_set' | 'stage_assessment' | 'paper' | 'question_bank';

export interface TrainingRoomProgressInput {
  current: number;
  total: number;
}

export interface TrainingRoomSessionProgressInput {
  currentIndex: number;
  totalQuestions: number;
}

export interface TrainingRoomResultInput {
  completed: boolean;
  totalQuestions?: number;
  correctCount?: number;
  accuracyRate?: number;
  nextActions?: string[];
  actions?: readonly StudentAction[];
}

export interface TrainingRoomViewModelInput {
  source: TrainingRoomSource;
  title?: string | null;
  target?: string | null;
  estimatedMinutes?: number | null;
  questionProgress?: TrainingRoomProgressInput | null;
  sessionProgress?: TrainingRoomSessionProgressInput | null;
  result?: TrainingRoomResultInput | null;
}

export interface TrainingRoomProgress {
  current: number;
  total: number;
  percent: number;
}

export interface TrainingRoomResult {
  completed: boolean;
  totalQuestions?: number;
  correctCount?: number;
  accuracyRate?: number;
  nextActions: string[];
  actions?: StudentAction[];
}

export interface TrainingRoomViewModel {
  title: string;
  source: TrainingRoomSource;
  sourceLabel: string;
  target: string;
  estimatedMinutes: number | null;
  progress: TrainingRoomProgress | null;
  result: TrainingRoomResult | null;
}

const SOURCE_LABELS: Record<TrainingRoomSource, string> = {
  today_task: '今日任务',
  practice_set: '专项练习',
  stage_assessment: '阶段测评',
  paper: '模拟考试',
  question_bank: '题库训练',
};

function buildProgress(
  questionProgress?: TrainingRoomProgressInput | null,
  sessionProgress?: TrainingRoomSessionProgressInput | null,
): TrainingRoomProgress | null {
  const progress = questionProgress
    ?? (sessionProgress
      ? { current: sessionProgress.currentIndex + 1, total: sessionProgress.totalQuestions }
      : null);
  if (!progress || progress.total <= 0) return null;

  const current = Math.min(progress.total, Math.max(0, progress.current));
  return {
    current,
    total: progress.total,
    percent: Math.round((current / progress.total) * 100),
  };
}

export function buildTrainingRoomViewModel(input: TrainingRoomViewModelInput): TrainingRoomViewModel {
  const result = input.result
    ? {
        completed: input.result.completed,
        ...(input.result.totalQuestions == null ? {} : { totalQuestions: input.result.totalQuestions }),
        ...(input.result.correctCount == null ? {} : { correctCount: input.result.correctCount }),
        ...(input.result.accuracyRate == null ? {} : { accuracyRate: input.result.accuracyRate }),
        nextActions: [...(input.result.nextActions ?? [])],
        ...(input.result.actions == null ? {} : { actions: [...input.result.actions] }),
      }
    : null;

  return {
    title: input.title?.trim() || '训练空间',
    source: input.source,
    sourceLabel: SOURCE_LABELS[input.source],
    target: input.target?.trim() || '暂无数据',
    estimatedMinutes: input.estimatedMinutes ?? null,
    progress: buildProgress(input.questionProgress, input.sessionProgress),
    result,
  };
}
