import type { CatalogAtomicPoint } from './knowledgeCatalog';

export type EvidenceCardTone = 'info' | 'positive' | 'warning' | 'neutral';

export interface KnowledgeEvidenceSource {
  point: Pick<CatalogAtomicPoint, 'id' | 'name' | 'importance' | 'difficulty' | 'evidence'>;
  mastery?: {
    status: 'untouched' | 'weak' | 'review' | 'mastered';
    mastery?: number;
    accuracy?: number;
    attempts?: number;
    correctCount?: number;
    wrongCount?: number;
    nextReviewAt?: string | null;
  } | null;
  examQuestions?: Array<{
    year: number;
    questionNo: number;
    questionType: string;
    score?: number | null;
    summary?: string | null;
  }> | null;
  relatedQuestionsCount?: number;
  prerequisiteCount?: number;
  relatedCount?: number;
}

export interface KnowledgeEvidenceCard {
  title: string;
  value: string;
  note: string;
  tone: EvidenceCardTone;
}

export interface KnowledgeEvidenceSummary {
  whyImportant: string;
  nextStepHint: string;
  cards: KnowledgeEvidenceCard[];
}

function formatTopExamHit(source: KnowledgeEvidenceSource): string | null {
  const item = source.examQuestions?.[0];
  if (!item) return null;
  const scoreText = item.score != null ? ` · ${item.score} 分` : '';
  return `${item.year} 年第 ${item.questionNo} 题 · ${item.questionType}${scoreText}`;
}

export function buildKnowledgeEvidenceSummary(source: KnowledgeEvidenceSource): KnowledgeEvidenceSummary {
  const evidence = source.point.evidence;
  const mastery = source.mastery ?? null;
  const topExamHit = formatTopExamHit(source);
  const recent5 = evidence?.recent5Frequency ?? 0;
  const allTime = evidence?.allTimeEvidence ?? 0;
  const importance = source.point.importance ?? 0;
  const difficulty = source.point.difficulty ?? 0;
  const relatedQuestionCount = source.relatedQuestionsCount ?? 0;
  const prerequisiteCount = source.prerequisiteCount ?? 0;
  const relatedCount = source.relatedCount ?? 0;

  const importanceScore = recent5 * 2 + allTime + importance * 3 + difficulty;
  const evidenceStrength = importanceScore >= 22 ? '强' : importanceScore >= 12 ? '中' : '弱';
  const evidenceTone: EvidenceCardTone = evidenceStrength === '强' ? 'positive' : evidenceStrength === '中' ? 'neutral' : 'warning';

  const masteryValue = mastery
    ? `${Math.round((mastery.mastery ?? 0) * 100)}% · ${mastery.status}`
    : '尚未练习';
  const masteryTone: EvidenceCardTone = !mastery || mastery.status === 'untouched'
    ? 'warning'
    : mastery.status === 'mastered'
      ? 'positive'
      : 'neutral';

  const questionEvidenceValue = relatedQuestionCount > 0
    ? `${relatedQuestionCount} 道题`
    : '暂无题库题';

  const relationValue = prerequisiteCount + relatedCount > 0
    ? `前置 ${prerequisiteCount} · 相关 ${relatedCount}`
    : '暂无扩展关系';

  const whyImportant = evidence
    ? evidenceStrength === '强'
      ? '这个节点属于高频高权重点，优先掌握后更容易稳定拿分。'
      : evidenceStrength === '中'
        ? '这个节点有明确考频与关联题支撑，适合纳入今日主线。'
        : '这个节点更像基础连接点，建议先补概念再看真题。'
    : '先把该节点的基础概念与关联题补齐，再用真题验证。';

  const nextStepHint = mastery
    ? mastery.status === 'mastered'
      ? '继续做同类真题和变式题，保持正确率与速度。'
      : mastery.status === 'review'
        ? '先复盘易错条件，再做一组同考点题巩固。'
        : '先补基础题和前置知识，再回到本节点。'
    : '从前置知识开始学习，再练 3 道关联题确认是否真的会用。';

  const cards: KnowledgeEvidenceCard[] = [
    {
      title: '为什么重要',
      value: whyImportant,
      note: evidence
        ? `考频强度 ${evidenceStrength} · 重要度 ${importance} / 难度 ${difficulty}`
        : `重要度 ${importance} / 难度 ${difficulty}`,
      tone: evidenceTone,
    },
    {
      title: '真题证据',
      value: topExamHit ?? '暂无真题示例',
      note: evidence
        ? `近3年 ${evidence.recent3Frequency} 次 · 近5年 ${evidence.recent5Frequency} 次`
        : '尚未建立真题频次证据',
      tone: topExamHit ? 'positive' : 'neutral',
    },
    {
      title: '我的掌握度',
      value: masteryValue,
      note: mastery
        ? `练习 ${mastery.attempts ?? 0} 次 · 正确 ${mastery.correctCount ?? 0} / 错误 ${mastery.wrongCount ?? 0}`
        : '先完成一次练习再看掌握度',
      tone: masteryTone,
    },
    {
      title: '下一步怎么学',
      value: nextStepHint,
      note: relationValue,
      tone: relatedQuestionCount > 0 || prerequisiteCount > 0 ? 'info' : 'neutral',
    },
    {
      title: '题库支撑',
      value: questionEvidenceValue,
      note: relatedQuestionCount > 0 ? '可直接从题库进入练习' : '先补齐关联题后再做巩固',
      tone: relatedQuestionCount > 0 ? 'positive' : 'warning',
    },
  ];

  return {
    whyImportant,
    nextStepHint,
    cards,
  };
}
