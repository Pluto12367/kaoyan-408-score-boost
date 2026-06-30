import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3100';
const webUrl = 'http://127.0.0.1:5174';
const processes = [];

async function main() {
  const api = start('api', process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3100',
      WEB_ORIGIN: webUrl,
      DATABASE_URL: '',
    },
  });

  await waitForJson(`${apiUrl}/health`, (data) => data.status === 'ok');
  const studentSession = await postJson(`${apiUrl}/auth/login`, {
    role: 'student',
  });
  assert(studentSession.token && studentSession.user.role === 'student', 'student login should return a student session');
  const teacherSession = await postJson(`${apiUrl}/auth/login`, {
    role: 'teacher',
  });
  assert(teacherSession.token && teacherSession.user.role === 'teacher', 'teacher login should return a teacher session');
  const teacherOnlyQuestions = await waitForJson(`${apiUrl}/teacher/questions`, (data) =>
    Array.isArray(data) && data.length > 0,
    { Authorization: `Bearer ${teacherSession.token}` },
  );
  assert(teacherOnlyQuestions.every((question) => question.knowledgePointIds?.length > 0), 'teacher question management should return knowledge-bound questions');
  await expectForbidden(`${apiUrl}/teacher/questions`, {
    Authorization: `Bearer ${studentSession.token}`,
  }, 'student session should not access teacher question management');
  const overview = await waitForJson(`${apiUrl}/dashboard/overview`, (data) => data.source === 'memory-api');
  assert(overview.report?.weakPoints?.length > 0, 'dashboard overview should include weak points');
  assert(overview.plan?.dailyTasks?.length > 0, 'dashboard overview should include daily tasks');
  assert(overview.plan.dailyTasks.every((task) => task.priority && task.reason && task.nextAction), 'daily tasks should include priority, reason and next action');
  const diagnosticProfile = await postJson(`${apiUrl}/diagnostics/profile`, {
    targetScore: 118,
    currentScore: 58,
    remainingDays: 120,
    dailyHours: 2.5,
    weakestSubject: '操作系统',
  });
  assert(diagnosticProfile.stage === '基础', 'diagnostic profile should classify low score students into foundation stage');
  assert(diagnosticProfile.diagnosis.includes('操作系统'), 'diagnostic profile should mention weakest subject');
  const overviewAfterDiagnostic = await waitForJson(`${apiUrl}/dashboard/overview`, (data) =>
    data.student?.stage === '基础' && data.plan?.phase === '基础补强',
  );
  assert(overviewAfterDiagnostic.student.targetScore === 118, 'dashboard should reflect diagnostic target score');
  assert(overviewAfterDiagnostic.student.remainingDays === 120, 'dashboard should reflect diagnostic remaining days');
  const createdKnowledgePoint = await postJson(`${apiUrl}/knowledge-points`, {
    id: 'os-memory',
    subject: '操作系统',
    chapter: '内存管理',
    title: '分页与地址转换',
    importance: 5,
    frequency: 4,
    prerequisites: ['进程地址空间'],
  });
  assert(createdKnowledgePoint.id === 'os-memory', 'knowledge point creation should return the created point');
  const knowledgePointsAfterCreate = await waitForJson(`${apiUrl}/knowledge-points`, (data) =>
    Array.isArray(data) && data.some((point) => point.id === createdKnowledgePoint.id),
  );
  assert(knowledgePointsAfterCreate.some((point) => point.title === '分页与地址转换'), 'knowledge point list should include teacher-created point');
  const knowledgePointQuestion = await postJson(`${apiUrl}/questions`, {
    stem: '分页存储管理中，页号和页内偏移通常由什么共同确定？',
    options: ['逻辑地址', '物理地址', '页表长度', '外存块号'],
    answer: 'A',
    analysis: '逻辑地址按页面大小拆分后得到页号和页内偏移。',
    knowledgePointIds: [createdKnowledgePoint.id],
    difficulty: '中等',
    type: '选择题',
    source: '教研新增',
    year: 2026,
    expectedTimeSec: 95,
  });
  const osMemoryQuery = new URLSearchParams({
    subject: createdKnowledgePoint.subject,
    chapter: createdKnowledgePoint.chapter,
  });
  const osMemoryQuestions = await waitForJson(`${apiUrl}/questions?${osMemoryQuery}`, (data) =>
    Array.isArray(data) && data.some((question) => question.id === knowledgePointQuestion.id),
  );
  assert(osMemoryQuestions.every((question) => question.knowledgePointIds.includes(createdKnowledgePoint.id)), 'question search should use teacher-created knowledge point metadata');
  const createdTeacherQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？',
    options: ['增大', '不变', '减小', '无法判断'],
    answer: 'C',
    analysis: '命中率提高后，访问更多落在高速 Cache 中，平均访存时间通常减小。',
    knowledgePointIds: ['co-cache'],
    difficulty: overview.questions[0].difficulty,
    type: overview.questions[0].type,
    source: '教师新增',
    year: 2026,
    expectedTimeSec: 90,
  });
  assert(createdTeacherQuestion.knowledgePointIds.includes('co-cache'), 'teacher question should keep knowledge point binding');
  const filteredQuestions = await waitForJson(`${apiUrl}/questions?knowledgePointId=co-cache`, (data) =>
    Array.isArray(data) && data.some((question) => question.id === createdTeacherQuestion.id),
  );
  assert(filteredQuestions.every((question) => question.knowledgePointIds.includes('co-cache')), 'question search should filter by knowledge point');
  const overviewAfterTeacherQuestion = await waitForJson(`${apiUrl}/dashboard/overview`, (data) =>
    data.questions?.some((question) => question.id === createdTeacherQuestion.id),
  );
  assert(overviewAfterTeacherQuestion.questions.some((question) => question.id === createdTeacherQuestion.id), 'student dashboard should include teacher-created questions');
  const teacherQuestionPractice = await postJson(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: createdTeacherQuestion.id,
    knowledgePointId: 'co-cache',
    selectedAnswer: 'A',
    timeSpentSec: 120,
    expectedTimeSec: 90,
  });
  assert(teacherQuestionPractice.questionId === createdTeacherQuestion.id, 'student practice should accept teacher-created questions');
  const generatedPaper = await postJson(`${apiUrl}/papers/generate`, {
    title: '存储系统专项卷',
    paperType: '专项卷',
    knowledgePointIds: ['co-cache'],
    questionCount: 2,
    createdBy: 'teacher-001',
  });
  assert(generatedPaper.title === '存储系统专项卷', 'paper generation should return the requested title');
  assert(generatedPaper.questions.length > 0 && generatedPaper.questions.length <= 2, 'paper generation should select bounded questions');
  assert(generatedPaper.questions.every((question) => question.knowledgePointIds.includes('co-cache')), 'special paper should only include requested knowledge points');
  assert(generatedPaper.estimatedMinutes > 0, 'paper generation should include estimated minutes');
  const papers = await waitForJson(`${apiUrl}/papers`, (data) =>
    Array.isArray(data) && data.some((paper) => paper.id === generatedPaper.id),
  );
  assert(papers.some((paper) => paper.paperType === '专项卷'), 'paper list should include generated special paper');
  const firstTaskId = overview.plan.dailyTasks[0].id;
  const completedTask = await postJson(`${apiUrl}/study-tasks/${firstTaskId}/complete`, {
    userId: 'u-001',
  });
  assert(completedTask.completed === true, 'completed task endpoint should mark the task as completed');
  assert(completedTask.feedback?.nextAction, 'completed task endpoint should return next action feedback');
  const overviewAfterTask = await waitForJson(`${apiUrl}/dashboard/overview`, (data) => {
    const task = data.plan?.dailyTasks?.find((item) => item.id === firstTaskId);
    return task?.completed === true && data.plan?.completedTaskCount === 1;
  });
  assert(overviewAfterTask.plan.completionRate > 0, 'study plan should expose today completion rate');

  const previousRecordCount = overview.practiceRecords.length + 1;
  const submitted = await postJson(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'A',
    timeSpentSec: 210,
    expectedTimeSec: 100,
  });
  assert(submitted.questionId === 'q-001', 'practice submission should return the created record');
  assert(submitted.correct === false, 'practice submission should be graded by the API');
  assert(submitted.mistakeReason === '概念不清', 'practice submission should be attributed by the API');
  const updatedOverview = await waitForJson(`${apiUrl}/dashboard/overview`, (data) => data.practiceRecords?.length === previousRecordCount + 1);
  assert(updatedOverview.report.weakPoints[0].knowledgePointId === 'co-cache', 'updated report should reflect the submitted weak point');
  const practiceSet = await waitForJson(`${apiUrl}/practice-sets/recommended?userId=u-001`, (data) => data.questions?.length > 0);
  assert(practiceSet.title && practiceSet.focus, 'recommended practice set should include title and focus');
  assert(practiceSet.knowledgePointIds.includes('co-cache'), 'recommended practice set should focus on the current weak point');
  assert(practiceSet.questions.every((question) => question.knowledgePointIds.some((id) => practiceSet.knowledgePointIds.includes(id))), 'recommended practice set should return matching questions');
  const practiceSetResult = await postJson(`${apiUrl}/practice-sets/${practiceSet.id}/submit`, {
    userId: 'u-001',
    answers: practiceSet.questions.slice(0, 2).map((question, index) => ({
      questionId: question.id,
      selectedAnswer: index === 0 ? question.answer : 'A',
      timeSpentSec: question.expectedTimeSec + 10,
    })),
  });
  assert(practiceSetResult.totalQuestions === Math.min(2, practiceSet.questions.length), 'practice set submission should score submitted answers');
  assert(practiceSetResult.results.length === practiceSetResult.totalQuestions, 'practice set submission should include per-question results');
  assert(practiceSetResult.accuracyRate >= 0 && practiceSetResult.accuracyRate <= 100, 'practice set submission should expose accuracy rate');
  const calendar = await waitForJson(`${apiUrl}/learning-calendar?userId=u-001`, (data) => data.today?.isActive === true);
  assert(calendar.days.length === 7, 'learning calendar should return a 7-day window');
  assert(calendar.today.completedTaskCount >= 1, 'learning calendar should include completed task count for today');
  assert(calendar.today.practiceCount >= 1, 'learning calendar should include practice count for today');
  assert(calendar.streakDays >= 1, 'learning calendar should include active streak days');
  const systemConfig = await waitForJson(`${apiUrl}/admin/system-config`, (data) => data.recommendation?.stageAssessmentQuestionLimit >= 2);
  assert(systemConfig.recommendation.dailyTargetQuestionCount > 0, 'system config should include daily target question count');
  const updatedSystemConfig = await postJson(`${apiUrl}/admin/system-config`, {
    recommendation: {
      stageAssessmentQuestionLimit: 2,
      dailyTargetQuestionCount: 35,
      speedRiskMultiplier: 1.25,
    },
  });
  assert(updatedSystemConfig.recommendation.stageAssessmentQuestionLimit === 2, 'system config should persist assessment question limit');
  assert(updatedSystemConfig.updatedBy === 'admin-001', 'system config should track updater');
  const stageAssessment = await waitForJson(`${apiUrl}/assessments/stage?userId=u-001`, (data) => data.questions?.length >= 2);
  assert(stageAssessment.questions.length <= 2, 'stage assessment should respect configured question limit');
  assert(stageAssessment.focusKnowledgePoints.length > 0, 'stage assessment should include focused weak knowledge points');
  assert(stageAssessment.estimatedMinutes > 0, 'stage assessment should include estimated minutes');
  const stageResult = await postJson(`${apiUrl}/assessments/stage/submit`, {
    userId: 'u-001',
    answers: stageAssessment.questions.map((question, index) => ({
      questionId: question.id,
      selectedAnswer: index === 0 ? (question.answer === 'A' ? 'B' : 'A') : question.answer,
      timeSpentSec: question.expectedTimeSec + 20,
    })),
  });
  assert(stageResult.totalQuestions === stageAssessment.questions.length, 'stage result should score all assessment questions');
  assert(stageResult.score >= 0 && stageResult.score <= 100, 'stage result should expose a percentage score');
  assert(stageResult.reviewItems.length > 0, 'stage result should include review items');
  assert(stageResult.nextActions.length > 0, 'stage result should include next actions');
  assert(stageResult.adjustment?.stage === '基础', 'low stage assessment score should keep the student in foundation stage');
  assert(stageResult.adjustment?.planPhase === '基础补强', 'stage assessment adjustment should expose the next plan phase');
  const overviewAfterStageAssessment = await waitForJson(`${apiUrl}/dashboard/overview`, (data) =>
    data.student?.stage === stageResult.adjustment.stage && data.plan?.phase === stageResult.adjustment.planPhase,
  );
  assert(overviewAfterStageAssessment.plan.dailyTasks[0].reason, 'adjusted plan should keep task recommendation reasons');
  const tutorReply = await postJson(`${apiUrl}/ai/tutor-reply`, {
    userId: 'u-001',
    questionId: 'q-001',
    selectedAnswer: 'A',
    prompt: '为什么这题不是选 A？',
  });
  assert(tutorReply.questionId === 'q-001', 'AI tutor reply should be tied to the requested question');
  assert(tutorReply.knowledgePointTitle, 'AI tutor reply should include the knowledge point title');
  assert(tutorReply.answerCheck.includes('B'), 'AI tutor reply should include the correct answer');
  assert(tutorReply.explanationSteps.length >= 2, 'AI tutor reply should break explanation into steps');
  assert(tutorReply.similarQuestions.length > 0, 'AI tutor reply should recommend similar questions');
  assert(tutorReply.nextActions.length > 0, 'AI tutor reply should include next actions');
  const followUpReply = await postJson(`${apiUrl}/ai/follow-up`, {
    userId: 'u-001',
    questionId: 'q-001',
    message: '为什么我选 A 不对？请整理成复习卡片。',
  });
  assert(followUpReply.replySteps.length >= 2, 'AI follow-up should return step-by-step explanation');
  assert(followUpReply.reviewCards.length >= 2, 'AI follow-up should return review cards');
  assert(followUpReply.reviewCards.every((card) => card.title && card.type && card.content && card.nextAction), 'AI follow-up review cards should include title, type, content and next action');
  const reviewQueue = await waitForJson(`${apiUrl}/admin/review-queue`, (data) =>
    Array.isArray(data?.items) && data.items.length >= 2,
  );
  assert(reviewQueue.pendingCount >= 2, 'review queue should include pending content');
  assert(reviewQueue.items.some((item) => item.contentType === 'question' && item.relatedId === createdTeacherQuestion.id), 'review queue should include teacher-created question');
  assert(reviewQueue.items.some((item) => item.contentType === 'ai_reply' && item.relatedId === tutorReply.id), 'review queue should include AI tutor reply');
  const approvedReviewItem = await postJson(`${apiUrl}/admin/review-queue/${reviewQueue.items[0].id}/approve`, {
    reviewerId: 'admin-001',
  });
  assert(approvedReviewItem.status === 'approved', 'review approval should mark the item as approved');
  const reviewQueueAfterApproval = await waitForJson(`${apiUrl}/admin/review-queue`, (data) =>
    Array.isArray(data?.items) && data.items.some((item) => item.id === approvedReviewItem.id && item.status === 'approved'),
  );
  assert(reviewQueueAfterApproval.pendingCount === reviewQueue.pendingCount - 1, 'review queue pending count should decrease after approval');
  const feedback = await postJson(`${apiUrl}/feedback`, {
    userId: 'u-001',
    rating: 4,
    scene: '试用体验',
    message: '希望推荐题组能更贴合冲刺阶段。',
    surveyUrl: 'https://wj.qq.com/s2/27160624/40fe/',
  });
  assert(feedback.id && feedback.status === 'new', 'feedback submission should return a new feedback item');
  const feedbackList = await waitForJson(`${apiUrl}/admin/feedback`, (data) =>
    data.totalCount >= 1 && data.items?.some((item) => item.id === feedback.id),
  );
  assert(feedbackList.averageRating >= 4, 'feedback admin list should expose average rating');
  const adminMetrics = await waitForJson(`${apiUrl}/admin/metrics`, (data) => data.questionCount >= overviewAfterTeacherQuestion.questions.length);
  assert(adminMetrics.activeStudentCount >= 1, 'admin metrics should include active student count');
  assert(adminMetrics.practiceRecordCount >= updatedOverview.practiceRecords.length, 'admin metrics should include practice record count');
  assert(adminMetrics.accuracyRate >= 0 && adminMetrics.accuracyRate <= 100, 'admin metrics should expose accuracy rate');
  assert(adminMetrics.todayPracticeCount >= 1, 'admin metrics should include today practice count');
  assert(adminMetrics.weakPointCount >= 1, 'admin metrics should include weak point count');
  assert(adminMetrics.pendingWrongQuestionCount >= 1, 'admin metrics should include pending wrong question count');
  const wrongQuestions = await waitForJson(`${apiUrl}/wrong-questions?userId=u-001`, (data) => Array.isArray(data) && data.length > 0);
  const cacheWrongQuestion = wrongQuestions.find((item) => item.questionId === 'q-001');
  assert(cacheWrongQuestion, 'wrong question book should include the submitted wrong question');
  assert(cacheWrongQuestion.knowledgePointId === 'co-cache', 'wrong question should include its knowledge point');
  assert(cacheWrongQuestion.wrongCount >= 1, 'wrong question should track wrong attempt count');
  assert(cacheWrongQuestion.latestMistakeReason, 'wrong question should expose latest mistake reason');
  assert(cacheWrongQuestion.reviewStatus === 'pending', 'wrong question should start as pending review');
  const reviewedWrongQuestion = await postJson(`${apiUrl}/wrong-questions/${cacheWrongQuestion.questionId}/review`, {
    userId: 'u-001',
  });
  assert(reviewedWrongQuestion.reviewStatus === 'reviewed', 'wrong question review should mark the item as reviewed');
  assert(reviewedWrongQuestion.nextAction, 'wrong question review should include a next action');
  assert(reviewedWrongQuestion.similarQuestions.length > 0, 'wrong question review should recommend similar questions');
  const wrongQuestionSummary = await waitForJson(`${apiUrl}/wrong-questions/summary?userId=u-001`, (data) => Number.isFinite(data.pendingCount));
  assert(Number.isFinite(wrongQuestionSummary.reviewedCount) && Number.isFinite(wrongQuestionSummary.resolvedCount), 'wrong question summary should expose reviewed and resolved counts');
  assert(wrongQuestionSummary.mistakeReasonStats.length > 0, 'wrong question summary should include mistake reason stats');
  assert(wrongQuestionSummary.nextReviewActions.length > 0, 'wrong question summary should include next review actions');
  const learningProfile = await waitForJson(`${apiUrl}/students/u-001/profile`, (data) => data.timeline?.length >= 4);
  assert(learningProfile.summary.currentStage === '基础', 'learning profile should include the adjusted current stage');
  assert(learningProfile.loopStats.practiceSetCount >= 1, 'learning profile should count submitted practice sets');
  assert(learningProfile.loopStats.reviewedWrongQuestionCount >= 1, 'learning profile should count reviewed wrong questions');
  assert(learningProfile.timeline.some((item) => item.type === 'diagnostic'), 'learning profile should include diagnostic timeline event');
  assert(learningProfile.timeline.some((item) => item.type === 'stage_assessment'), 'learning profile should include stage assessment timeline event');
  const trialProgress = await waitForJson(`${apiUrl}/trial-progress?userId=u-001`, (data) => data.items?.length === 5);
  assert(trialProgress.completedCount === 5, 'trial progress should mark all guided trial tasks complete after smoke actions');
  assert(trialProgress.completionRate === 100, 'trial progress should expose full completion rate');
  assert(trialProgress.items.some((item) => item.id === 'feedback' && item.completed), 'trial progress should include feedback completion');
  const studyReminders = await waitForJson(`${apiUrl}/study-reminders?userId=u-001`, (data) => data.items?.length >= 3);
  assert(studyReminders.items.every((item) => item.priority && item.reason && item.actionAnchor), 'study reminders should include priority, reason and action anchor');
  assert(studyReminders.items.some((item) => item.type === 'weakness' || item.type === 'wrong-question'), 'study reminders should include an actionable weak point or wrong question suggestion');
  const sprintPlan = await waitForJson(`${apiUrl}/sprint-plan?userId=u-001`, (data) => data.days?.length === 7);
  assert(sprintPlan.scoreGap > 0, 'sprint plan should expose the score gap to target');
  assert(sprintPlan.days.every((day) => day.focus && day.questionTarget > 0 && day.reviewTarget >= 0 && day.reason), 'sprint plan days should include focus, question target, review target and reason');
  assert(sprintPlan.risks.length > 0, 'sprint plan should include at least one risk signal');
  const masteryMap = await waitForJson(`${apiUrl}/mastery-map?userId=u-001`, (data) => data.subjects?.length === 4);
  assert(masteryMap.subjects.every((subject) => subject.points?.every((point) => Number.isFinite(point.masteryRate) && point.status && point.nextAction)), 'mastery map should expose point mastery, status and next action');
  assert(masteryMap.subjects.some((subject) => subject.points.some((point) => point.status === 'weak')), 'mastery map should identify at least one weak point');
  const redoSubmitted = await postJson(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'B',
    timeSpentSec: 80,
  });
  assert(redoSubmitted.correct === true, 'redo submission should be graded as correct by the API');
  const resolvedWrongQuestions = await waitForJson(`${apiUrl}/wrong-questions?userId=u-001`, (data) => Array.isArray(data));
  assert(!resolvedWrongQuestions.some((item) => item.questionId === 'q-001'), 'correct redo should remove the question from the wrong question book');

  const web = start('web', process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    cwd: `${root}/apps/web`,
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiUrl,
    },
  });

  const html = await waitForText(webUrl, (text) => text.includes('<div id="root">'));
  assert(html.includes('/src/main.tsx'), 'web entry should point at the React app');

  console.log(JSON.stringify({
    ok: true,
    api: `${apiUrl}/dashboard/overview`,
    web: webUrl,
    weakPoint: updatedOverview.report.weakPoints[0].title,
    practiceRecords: updatedOverview.practiceRecords.length,
    wrongQuestionsAfterRedo: resolvedWrongQuestions.length,
    completedTasks: overviewAfterTask.plan.completedTaskCount,
    streakDays: calendar.streakDays,
    stageAssessmentScore: stageResult.score,
    tutorReply: tutorReply.knowledgePointTitle,
    teacherQuestion: createdTeacherQuestion.id,
    knowledgePoint: createdKnowledgePoint.id,
    paper: generatedPaper.id,
    adminAccuracyRate: adminMetrics.accuracyRate,
    reviewPendingCount: reviewQueueAfterApproval.pendingCount,
    stageAssessmentQuestionLimit: updatedSystemConfig.recommendation.stageAssessmentQuestionLimit,
    processIds: {
      api: api.pid,
      web: web.pid,
    },
  }, null, 2));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function start(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
      console.error(output.trim());
    }
  });

  return child;
}

async function expectForbidden(url, headers, message) {
  const response = await fetch(url, { headers });
  assert(response.status === 403, message);
}

async function waitForJson(url, predicate, headers = {}) {
  const response = await waitForResponse(url, async (res) => {
    if (!res.ok) return null;
    const data = await res.json();
    return predicate(data) ? data : null;
  }, headers);
  return response;
}

async function waitForText(url, predicate, headers = {}) {
  return waitForResponse(url, async (res) => {
    if (!res.ok) return null;
    const text = await res.text();
    return predicate(text) ? text : null;
  }, headers);
}

async function waitForResponse(url, mapper, headers = {}) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await mapper(await fetch(url, { headers }));
      if (result) return result;
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no matching response'}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null || child.killed) return;
    child.kill();
    await Promise.race([once(child, 'exit'), delay(1500)]);
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }));
}

process.on('SIGINT', () => {
  void cleanup().then(() => process.exit(130));
});

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => cleanup());
