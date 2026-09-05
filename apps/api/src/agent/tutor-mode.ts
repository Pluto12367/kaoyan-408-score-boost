/**
 * AI Tutor Mode (Phase PX-4) — pure teaching functions.
 *
 * Socratic teaching: the tutor asks before it tells. Question sequences are
 * built from REAL knowledge-node facts (title, chapter path, misconception
 * patterns) — never invented. Layered explanations produce three register
 * levels (beginner / exam / interview) over the same node facts.
 *
 * Misconception detection maps the student's recorded mistake reasons
 * (5 canonical categories from the grading engine) onto cognitive-pattern
 * hypotheses with evidence counts and a teaching recommendation.
 */

export interface TutorNodeFacts {
  knowledgeNodeId: string;
  title: string;
  subject: string;
  chapterPath: readonly string[];
  mastery?: number | null;
}

// ---- Socratic teaching ----

export interface SocraticQuestion {
  index: number;
  question: string;
  /** What a good answer should touch — for the tutor's own checking, not shown as the answer. */
  expectedDirection: string;
  probes: 'recall' | 'why' | 'apply' | 'contrast';
}

export function buildSocraticSequence(
  facts: TutorNodeFacts,
  misconceptions: readonly string[] = [],
): SocraticQuestion[] {
  const chapter = facts.chapterPath.join(' → ') || facts.subject;
  const confusionHint = misconceptions[0];
  const questions: SocraticQuestion[] = [
    {
      index: 1,
      question: `先用你自己的话说说，「${facts.title}」到底在定义什么？它出现在「${chapter}」这一章，你觉得它解决的是什么问题？`,
      expectedDirection: `能说出 ${facts.title} 的基本定义与它解决的问题背景`,
      probes: 'recall',
    },
    {
      index: 2,
      question: `「${facts.title}」为什么是必要的？如果没有它（或它的条件不满足），会发生什么？`,
      expectedDirection: `能从动机/反面情形说明 ${facts.title} 存在的必要性`,
      probes: 'why',
    },
  ];
  if (confusionHint) {
    questions.push({
      index: 3,
      question: `关于「${facts.title}」，你之前的记录显示在「${confusionHint}」上出过偏差。对照你现在的理解，这两个说法差别在哪里？`,
      expectedDirection: `能主动区分对 ${facts.title} 的正确理解与既往误解的差异`,
      probes: 'contrast',
    });
  }
  questions.push({
    index: questions.length + 1,
    question: `最后试着应用：给一个具体场景（题目或系统例子），指出「${facts.title}」在哪一步起作用？`,
    expectedDirection: '能把概念映射到具体题目步骤或系统场景',
    probes: 'apply',
  });
  return questions;
}

/** Grade a student's reply against the expected direction (rule-based, bounded). */
export function checkUnderstanding(
  reply: string,
  expected: SocraticQuestion,
): { progress: 'on_track' | 'needs_redirect'; hint: string } {
  const text = (reply ?? '').trim();
  if (text.length < 4) {
    return { progress: 'needs_redirect', hint: '试着用一句话先说出关键术语和它作用的对象。' };
  }
  const overlap = /(因为|所以|导致|由于|作用|定义|条件|步骤|区别)/.test(text);
  if (overlap) {
    return { progress: 'on_track', hint: '方向正确——下一步试着举一个具体例子验证你刚才的说法。' };
  }
  return { progress: 'needs_redirect', hint: `换个角度：围绕「${expected.expectedDirection}」，先列出你知道的关键词。` };
}

// ---- Layered explanation ----

export type ExplanationLevel = 'beginner' | 'exam' | 'interview';

export function buildLayeredExplanation(facts: TutorNodeFacts, level: ExplanationLevel): string {
  const chapter = facts.chapterPath.join(' → ') || facts.subject;
  const masteryNote = facts.mastery != null ? `（你当前掌握度约 ${Math.round(facts.mastery * 100)}%）` : '';
  const core = `「${facts.title}」属于 ${facts.subject} · ${chapter}${masteryNote}`;
  if (level === 'beginner') {
    return `${core}。入门理解：先把它当成一条"规则+使用条件"来记——它在什么前提下成立、解决什么问题、不满足条件会怎样。暂时不必关心推导细节，能复述规则并举出一个例子就算过关。`;
  }
  if (level === 'exam') {
    return `${core}。考试视角：该考点常以选择题考定义辨析与条件判断，综合题考过程应用。复习时优先记住适用条件与典型易错点（条件缺一不可、相邻概念混淆），再用 2-3 道同源题验证。`;
  }
  return `${core}。深入视角：从原理出发解释它为什么被设计成这样，与相邻机制做对比（取舍是什么），并尝试说明在真实系统/工程场景中的影响——这是把"会做题"升级为"真理解"的关键。`;
}

// ---- Misconception detection ----

export interface MisconceptionEvidence {
  /** Canonical mistake reasons recorded on practice/review facts. */
  mistakeReasons: readonly string[];
  /** Titles of the wrong questions behind those reasons. */
  questionTitles?: readonly string[];
}

export interface MisconceptionPattern {
  type: 'conceptual_gap' | 'adjacent_confusion' | 'procedural_error' | 'misreading' | 'fluency_gap';
  label: string;
  evidenceCount: number;
  teachingRecommendation: string;
}

const PATTERN_MAP: ReadonlyArray<{
  keywords: readonly string[];
  type: MisconceptionPattern['type'];
  label: string;
  recommendation: string;
}> = [
  { keywords: ['概念不清', '概念'], type: 'conceptual_gap', label: '概念性误解', recommendation: '回到定义与适用条件，先复述再做题；用 Socratic 提问逐条核对条件。' },
  { keywords: ['知识点混淆', '混淆'], type: 'adjacent_confusion', label: '邻近概念混淆', recommendation: '建立对比表：把两个易混概念按条件/结果/场景三列对比记忆。' },
  { keywords: ['计算失误', '计算'], type: 'procedural_error', label: '过程性错误', recommendation: '固定解题步骤模板，慢写关键步骤并逐步验算。' },
  { keywords: ['审题', '题干'], type: 'misreading', label: '题干理解偏差', recommendation: '读题时圈出限定词与问句目标，先复述题意再动笔。' },
  { keywords: ['速度偏慢', '速度'], type: 'fluency_gap', label: '熟练度不足', recommendation: '限时重做同类题，把正确率稳定后再压缩用时。' },
];

export function detectMisconceptions(evidence: MisconceptionEvidence): {
  patterns: MisconceptionPattern[];
  dominant: MisconceptionPattern | null;
} {
  const counters = new Map<MisconceptionPattern['type'], MisconceptionPattern & { _evidence: string[] }>();
  for (const reason of evidence.mistakeReasons) {
    if (!reason) continue;
    for (const rule of PATTERN_MAP) {
      if (rule.keywords.some((keyword) => reason.includes(keyword))) {
        const existing = counters.get(rule.type);
        const sample = evidence.questionTitles?.[counters.size] ?? reason;
        if (existing) existing._evidence.push(sample);
        else counters.set(rule.type, {
          type: rule.type, label: rule.label, evidenceCount: 0,
          teachingRecommendation: rule.recommendation, _evidence: [sample],
        });
        break;
      }
    }
  }
  const patterns = [...counters.values()]
    .map((entry) => ({ type: entry.type, label: entry.label, evidenceCount: entry._evidence.length, teachingRecommendation: entry.teachingRecommendation }))
    .sort((left, right) => right.evidenceCount - left.evidenceCount);
  return { patterns, dominant: patterns[0] ?? null };
}