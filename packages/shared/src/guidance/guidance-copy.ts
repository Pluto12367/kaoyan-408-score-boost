/**
 * G1.3 / G1.4 / G1.5 — Student-facing guidance copy.
 *
 * Every string a student reads through this layer carries a *statement kind*, so
 * the UI can never present an inference as a fact or a recommendation as an
 * outcome. The discipline is enforced by type, not by reviewer discipline:
 *
 *   FACT               something the system observed
 *   INFERENCE          what the system thinks that might mean
 *   RECOMMENDATION     what the system suggests doing next
 *   UNVERIFIED         recorded, but not yet proven
 *   INSUFFICIENT_DATA  the system refuses to conclude
 *
 * Product red lines baked into this file (task §20):
 *   • mastery is never phrased as an exam score
 *   • task completion is never phrased as learning success
 *   • a priority score is never phrased as an obligation
 *   • a prediction is never phrased as an expected exam result
 *
 * Pure: constants only, no IO, no clock.
 */

export type GuidanceStatementKind =
  | 'FACT'
  | 'INFERENCE'
  | 'RECOMMENDATION'
  | 'UNVERIFIED'
  | 'INSUFFICIENT_DATA';

export const STATEMENT_KIND_LABEL: Record<GuidanceStatementKind, string> = {
  FACT: '事实',
  INFERENCE: '推断',
  RECOMMENDATION: '建议',
  UNVERIFIED: '尚未验证',
  INSUFFICIENT_DATA: '证据不足',
};

export interface GuidanceStatement {
  readonly kind: GuidanceStatementKind;
  readonly text: string;
}

export function statement(kind: GuidanceStatementKind, text: string): GuidanceStatement {
  return { kind, text };
}

/** The one sentence every mastery surface must carry. */
export const MASTERY_BOUNDARY_NOTE =
  '掌握度是练习证据的强度，不是考试分数；它只说明同源练习的表现。';

/** The one sentence every completion surface must carry. */
export const COMPLETION_BOUNDARY_NOTE =
  '完成 ≠ 学会：系统只承认它观测到的判分作答，完成标记本身不构成能力证据。';

/** The one sentence every prediction surface must carry. */
export const PREDICTION_BOUNDARY_NOTE =
  '这是估算，不是成绩；在系统建立可信分数锚点之前，它不会被当作你的真实水平。';

/** The one sentence every AI surface must carry. */
export const AI_BOUNDARY_NOTE =
  '阅读解释不会自动产生掌握证据；要形成证据，需要一次判分练习。';

/** The one sentence every priority score must carry. */
export const PRIORITY_SCORE_NOTE =
  '学习优先级只表示系统建议的顺序，不表示你必须先学它。';

// ---------------------------------------------------------------- HOW (G1.3)

export type FirstUseFeatureKey =
  | 'first_diagnostic'
  | 'first_practice'
  | 'first_wrong_question'
  | 'first_review'
  | 'first_transfer_probe'
  | 'first_mock_exam';

export interface HowGuidance {
  readonly featureKey: FirstUseFeatureKey;
  readonly title: string;
  /** Why this step exists in the loop. */
  readonly why: string;
  /** How to do it so that it counts. Each line must be self-checkable. */
  readonly how: readonly string[];
  /** What the system gets out of it (and therefore what it can do next). */
  readonly after: string;
}

export const HOW_GUIDANCE: Record<FirstUseFeatureKey, HowGuidance> = {
  first_diagnostic: {
    featureKey: 'first_diagnostic',
    title: '先花 4 分钟填基础信息',
    why: '系统要先知道你的起点、目标和剩余时间，才能排出今天的顺序。填得越诚实，计划越有用。',
    how: [
      '「当前估分」填你最近一次整卷的真实分数；不确定就填保守值。',
      '「最薄弱科目」选你最怕考的那一科，不是最不喜欢的那一科。',
      '「距离考试天数」按真实考试日填，系统后面所有节奏都基于它。',
    ],
    after: '填完后你会立刻得到一条今日学习路线。这不是诊断，是计划输入。',
  },
  first_practice: {
    featureKey: 'first_practice',
    title: '先独立作答，再看解析',
    why: '只有被判分的作答才会形成能力证据。先看解析再答题，系统观测不到你的真实水平。',
    how: [
      '每题先选答案并提交，再打开解析。',
      '综合题写出推导过程并自评，不要留空。',
      '一组结束前，确认每题都有提交记录。',
    ],
    after: '系统会得到一条「观测证据」，并据此判断这个考点要不要继续练。',
  },
  first_wrong_question: {
    featureKey: 'first_wrong_question',
    title: '先记录自己为什么错，再复习',
    why: '错题不是再看一遍解析，而是把错误变成下一次会做的动作。错因会决定系统给你什么类型的练习。',
    how: [
      '在错因弹窗里选最接近的一项（不确定可以跳过，但标了更准）。',
      '不看答案重做一次。',
      '再做一道同考点的变式题。',
    ],
    after: '系统会得到错因类型，并用它替换「同一道题反复刷」的推荐。',
  },
  first_review: {
    featureKey: 'first_review',
    title: '复习是检查保持，不是刷数量',
    why: '复习的目的是看你还记不记得住，而不是把题量堆上去。',
    how: [
      '不看笔记，先自己回想一遍。',
      '再做题验证，而不是直接看答案。',
      '答错就按错题流程处理，不要只标记「已复习」。',
    ],
    after: '复习作答会形成复习证据；只有「标记已复习」不会。',
  },
  first_transfer_probe: {
    featureKey: 'first_transfer_probe',
    title: '迁移复测：一道你没见过的新题',
    why: '这道题是你之前没有见过的同类型题。它不是为了增加刷题数量，而是检查你能不能把刚才学的方法应用到新题。',
    how: [
      '不看解析、一次提交。',
      '约 5 分钟内完成，按真实考试节奏。',
      '答错也不要紧——那正是系统要找的问题。',
    ],
    after: '这次结果会进入你的迁移证据，但不会直接等同于考试分数；没有合格新题时系统会直说。',
  },
  first_mock_exam: {
    featureKey: 'first_mock_exam',
    title: '模考是测量工具，不是普通任务',
    why: '模考的价值是发现真实失分，而不是让分数好看。它不产出练习证据，它产出一张失分清单。',
    how: [
      '整卷一次做完，中途不查资料。',
      '交卷前用「未作答」清单检查一遍。',
      '交卷后先看失分知识点，最后再看分数。',
    ],
    after: '系统会得到一份失分清单和一个恢复计划入口；这是它唯一能用来对准考试的测量。',
  },
};

/** Deterministic order so the UI never shows two competing first-use cards. */
export const FIRST_USE_ORDER: readonly FirstUseFeatureKey[] = [
  'first_diagnostic',
  'first_practice',
  'first_wrong_question',
  'first_review',
  'first_transfer_probe',
  'first_mock_exam',
];

// --------------------------------------------- verification copy (G1.4)

export type VerificationDomain =
  | 'task'
  | 'practice'
  | 'review'
  | 'large_question'
  | 'transfer_probe'
  | 'mock';

export const VERIFICATION_HEADLINE: Record<VerificationDomain, string> = {
  task: '任务完成',
  practice: '练习提交',
  review: '复习提交',
  large_question: '大题自评提交',
  transfer_probe: '迁移复测提交',
  mock: '模考提交',
};

/** Honest sentence for "the activity happened, the ability question is open". */
export const VERIFICATION_PENDING_ABILITY =
  '能力验证：尚未完成——还需要一次能观测到作答的练习。';

export const VERIFICATION_PRACTICE_EVIDENCE =
  '练习证据已增加。';

export const VERIFICATION_NEEDS_TRANSFER =
  '还需要一道陌生新题来验证迁移——同源题做得好不代表新题会做。';

export const VERIFICATION_TRANSFER_PASSED =
  '迁移证据成立：你在一道没见过的新题上做对了。';

export const VERIFICATION_TRANSFER_FAILED =
  '基础练习表现不错，但陌生题迁移仍不足——这是发现，不是失败。';

export const VERIFICATION_TRANSFER_EXPIRED =
  '本次复测窗口已过期。这不是失败，下次学习后还会有新的复测。';

export const VERIFICATION_NO_PROBE_AVAILABLE =
  '暂时没有合格的新题，系统不会拿旧题冒充迁移测试。';

export const VERIFICATION_MOCK_RESULT =
  '这次模考产生了失分清单，可以用来安排下一轮复盘；它不是你的考试成绩。';

// ------------------------------------------------------------ NEXT (G1.5)

export type NextActionId =
  | 'continue_training'
  | 'review_wrong_questions'
  | 'do_transfer_probe'
  | 'take_assessment'
  | 'analyze_mock_loss'
  | 'check_evidence'
  | 'restore_daily_plan'
  | 'none_available';

export interface NextActionSpec {
  readonly id: NextActionId;
  readonly label: string;
  /** Existing student section the action navigates to. */
  readonly section: 'dashboard' | 'question' | 'wrong-book' | 'test' | 'knowledge-catalog' | 'ai';
  /** Why this is the right next step; shown under the button. */
  readonly reason: string;
}

export const NEXT_ACTIONS: Record<NextActionId, NextActionSpec> = {
  continue_training: {
    id: 'continue_training',
    label: '继续训练',
    section: 'question',
    reason: '同考点再练一组，可以让证据更稳。',
  },
  review_wrong_questions: {
    id: 'review_wrong_questions',
    label: '去错题复盘',
    section: 'wrong-book',
    reason: '先把错因处理掉，再练新题才有效。',
  },
  do_transfer_probe: {
    id: 'do_transfer_probe',
    label: '做迁移复测',
    section: 'test',
    reason: '用一道没见过的新题验证方法能不能迁移。',
  },
  take_assessment: {
    id: 'take_assessment',
    label: '做一次阶段测评',
    section: 'test',
    reason: '练习只说明「做过」，测评才说明「会不会」。',
  },
  analyze_mock_loss: {
    id: 'analyze_mock_loss',
    label: '查看失分清单',
    section: 'test',
    reason: '先看丢在哪，再决定学什么。',
  },
  check_evidence: {
    id: 'check_evidence',
    label: '查看学习证据',
    section: 'test',
    reason: '看清哪些行为被系统观测到了、哪些没有。',
  },
  restore_daily_plan: {
    id: 'restore_daily_plan',
    label: '回到今日计划',
    section: 'dashboard',
    reason: '先处理今天到期的事，再考虑加量。',
  },
  none_available: {
    id: 'none_available',
    label: '暂无可靠下一步',
    section: 'dashboard',
    reason: '当前没有足够证据推荐具体动作；系统不会给一个凑数的建议。',
  },
};

// ------------------------------------------------ learning contract (§31)

export interface LearningContractLine {
  readonly kind: GuidanceStatementKind;
  readonly text: string;
  /** Where in the product this claim can be checked. */
  readonly evidenceHint: string;
}

export const LEARNING_CONTRACT: readonly LearningContractLine[] = [
  {
    kind: 'FACT',
    text: '刷题不是最终目标：系统优先让你做「考频高 × 还没掌握」的考点，而不是更多的题。',
    evidenceHint: '今日计划 / 今日提分中心',
  },
  {
    kind: 'FACT',
    text: '任务完成不等于学会：系统只承认它观测到的判分作答。',
    evidenceHint: '学习证据台账 · 任务证据',
  },
  {
    kind: 'FACT',
    text: '熟题做对不等于新题会做：系统会用一道你没见过的新题验证迁移；没有合格新题时会直说。',
    evidenceHint: '迁移复测',
  },
  {
    kind: 'FACT',
    text: '模考用于验证，不是表演：它的价值是找出真实失分。',
    evidenceHint: '模考诊断书',
  },
  {
    kind: 'FACT',
    text: '系统会根据证据调整推荐：证据不足时它会拒绝下结论。',
    evidenceHint: '学习证据台账 · 成绩锚点',
  },
  {
    kind: 'UNVERIFIED',
    text: '系统今天还不能预计你能提高几分：在你录入真实成绩之前，所有分数都是估算。',
    evidenceHint: '成绩锚点（校准状态）',
  },
  {
    kind: 'INSUFFICIENT_DATA',
    text: '系统的判断可能不完整：部分考点还没有节点标注或考频数据，它会标注「证据不足」，而不是猜。',
    evidenceHint: '数据质量 / 证据不足提示',
  },
];

// -------------------------------------------------- frequency control (§16)

export type GuidancePriority = 'P0' | 'P1' | 'P2' | 'P3';

/** Higher priority guidance may win the single slot on a surface. */
export const GUIDANCE_PRIORITY_ORDER: Record<GuidancePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Max items rendered per surface (guidance is heavier than a nudge). */
export const GUIDANCE_PER_SURFACE_CAP = 1;

/** Max items rendered per calendar day across surfaces. */
export const GUIDANCE_DAILY_CAP = 3;

/** Default cooldown per trigger, in days. */
export const GUIDANCE_COOLDOWN_DAYS: Record<string, number> = {
  A_repeat_familiar: 7,
  B_easy_only: 7,
  C_explain_only: 3,
  D_practice_without_verification: 7,
  E_probe_expired: 7,
  F_recommendation_failed: 14,
  G_mastery_without_transfer: 14,
  first_use: 0,
};

/** localStorage key for dismissal memory (delivery state only, never learning state). */
export const GUIDANCE_DISMISS_STORAGE_KEY = 'kaoyan408:guidance.dismissed';
