import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3200';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let activeApi;

async function main() {
  const schemaResult = spawnSync(npx, [
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (schemaResult.status !== 0) {
    throw new Error(`Prisma migration deploy failed: ${schemaResult.error?.message || schemaResult.stderr || schemaResult.stdout}`);
  }

  activeApi = startApi();
  await waitForHealth(activeApi);

  const credentials = {
    email: `integration.student.${Date.now()}@example.com`,
    password: 'ReliableTestPassword!408',
    name: '集成测试学生',
  };
  const registered = await postJson(`${apiUrl}/auth/register`, credentials);
  assert(registered.user.email === undefined && registered.user.role === 'student', 'registration should return a safe student profile');
  assert(registered.accessToken && registered.refreshToken, 'registration should issue access and refresh tokens');
  const loggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(loggedIn.user.id === registered.user.id, 'password login should return the registered user');
  let studentHeaders = { Authorization: `Bearer ${loggedIn.accessToken}` };
  let initial = await waitForOverview(studentHeaders);
  assert(initial.source === 'postgresql', 'API should report the real PostgreSQL data source');
  const onboardingBefore = await getJson(`${apiUrl}/onboarding/status`, studentHeaders);
  assert(onboardingBefore.completed === false, 'new student should require onboarding');
  const onboarding = await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: new Date().getUTCFullYear() + 1,
    targetScore: 126,
    currentScore: 82,
    remainingDays: 88,
    dailyHours: 3,
    weakestSubject: '计算机组成原理',
  }, studentHeaders);
  assert(onboarding.sevenDayPlan.days.length === 7, 'onboarding should create a seven-day plan');
  assert(onboarding.todayPlan.priorityTasks.length === 3, 'onboarding should return three actionable tasks for today');
  initial = await waitForOverview(studentHeaders, (data) => data.student?.targetScore === 126 && data.plan?.dailyTasks?.length === 3);
  await expectGetStatus(`${apiUrl}/wrong-questions?userId=u-001`, studentHeaders, 403);
  await expectPostStatus(`${apiUrl}/auth/login`, { email: credentials.email, password: 'wrong-password' }, 401);
  await expectGetStatus(`${apiUrl}/teacher/questions`, { Authorization: `Bearer ${loggedIn.accessToken}` }, 403);
  await expectPostStatus(`${apiUrl}/questions`, {
    stem: 'student should not create this question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: 'forbidden',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: 'forbidden',
  }, 403, { Authorization: `Bearer ${loggedIn.accessToken}` });
  const teacherSession = await postJson(`${apiUrl}/auth/demo-login`, { role: 'teacher' });
  const teacherQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'integration teacher protected write question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: 'teacher can create questions',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: 'integration',
  }, { Authorization: `Bearer ${teacherSession.token}` });
  assert(teacherQuestion.id, 'teacher role should create questions');
  const subjectiveQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'Explain the key steps of direct-mapped cache address decomposition.',
    options: ['subjective response', 'self assessment'],
    answer: 'Address is split into tag, line index, and block offset.',
    analysis: 'Scoring points: identify tag, line index, block offset, and explain the mapping rule.',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '综合题',
    source: 'integration subjective',
  }, { Authorization: `Bearer ${teacherSession.token}` });
  assert(subjectiveQuestion.type === '综合题', 'teacher should create a comprehensive question for self assessment');
  const generatedPaper = await postJson(`${apiUrl}/papers/generate`, {
    title: 'PostgreSQL restart paper',
    paperType: '专项卷',
    knowledgePointIds: ['co-cache'],
    questionCount: 2,
    createdBy: teacherSession.user.id,
  }, { Authorization: `Bearer ${teacherSession.token}` });
  const submittedPaper = await postJson(`${apiUrl}/papers/${generatedPaper.id}/submit`, {
    answers: generatedPaper.questions.map((question) => ({
      questionId: question.id,
      selectedAnswer: question.answer,
      timeSpentSec: question.expectedTimeSec,
    })),
  }, studentHeaders);
  assert(submittedPaper.paperId === generatedPaper.id, 'generated paper should be submittable');
  const feedback = await postJson(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'postgres integration',
    message: 'verify feedback persistence across restart',
  }, studentHeaders);
  assert(feedback.id, 'student feedback should be accepted');
  const adminSession = await postJson(`${apiUrl}/auth/demo-login`, { role: 'admin' });
  const config = await postJson(`${apiUrl}/admin/system-config`, {
    recommendation: { stageAssessmentQuestionLimit: 2 },
  }, { Authorization: `Bearer ${adminSession.token}` });
  assert(config.recommendation.stageAssessmentQuestionLimit === 2, 'admin role should update system configuration');
  const refreshed = await postJson(`${apiUrl}/auth/refresh`, { refreshToken: loggedIn.refreshToken });
  assert(refreshed.refreshToken !== loggedIn.refreshToken, 'refresh should rotate the refresh token');
  await expectPostStatus(`${apiUrl}/auth/refresh`, { refreshToken: loggedIn.refreshToken }, 401);
  await postJson(`${apiUrl}/auth/logout`, { refreshToken: refreshed.refreshToken });
  await expectPostStatus(`${apiUrl}/auth/refresh`, { refreshToken: refreshed.refreshToken }, 401);

  const created = await postJson(`${apiUrl}/practice-records`, {
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'integration-test-wrong-answer',
    timeSpentSec: 137,
  }, studentHeaders);
  assert(created.id && created.correct === false && created.userId === registered.user.id, 'practice submission without userId should use the authenticated student');
  await expectPostStatus(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: 'q-002',
    knowledgePointId: 'net-tcp',
    selectedAnswer: 'A',
    timeSpentSec: 88,
  }, 403, studentHeaders);

  const reviewed = await postJson(`${apiUrl}/wrong-questions/q-001/review`, { userId: registered.user.id }, studentHeaders);
  assert(reviewed.reviewStatus === 'reviewed' && reviewed.reviewedAt, 'wrong-question review should be persisted');

  const autoScheduledDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(autoScheduledDetail.reviewSchedule?.stability === 'learning', 'first wrong answer should enter the review schedule automatically');
  assert(autoScheduledDetail.reviewSchedule?.reviewCount === 0, 'automatic scheduling should not count as a completed review');
  const savedNote = await patchJson(`${apiUrl}/wrong-questions/q-001/note`, {
    note: 'Cache mapping: check block number modulo line count before choosing.',
  }, studentHeaders);
  assert(savedNote.note.includes('Cache mapping'), 'wrong-question note should be saved');
  const failedRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: false,
    timeSpentSec: 145,
  }, studentHeaders);
  assert(failedRedo.nextReviewInDays === 1 && failedRedo.stability === 'learning', 'failed redo should return to a one-day interval');
  const firstCorrectRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 95,
  }, studentHeaders);
  assert(firstCorrectRedo.nextReviewInDays === 3 && firstCorrectRedo.consecutiveCorrect === 1, 'first correct redo should advance to three days');
  const secondCorrectRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 82,
  }, studentHeaders);
  assert(secondCorrectRedo.nextReviewInDays === 7 && secondCorrectRedo.consecutiveCorrect === 2, 'second correct redo should advance to seven days');
  const masteredRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 76,
  }, studentHeaders);
  assert(masteredRedo.nextReviewInDays === 14 && masteredRedo.stability === 'mastered', 'third correct redo should reach stable mastery with a fourteen-day interval');

  const todayPlanBeforeTask = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  const taskId = todayPlanBeforeTask.priorityTasks?.[0]?.id;
  assert(taskId, 'dashboard should expose a study task for completion testing');
  const taskKnowledgePointId = todayPlanBeforeTask.priorityTasks[0].knowledgePointId;
  const masteryBeforeTask = await getJson(`${apiUrl}/mastery-map`, studentHeaders);
  const masteryPointBefore = masteryBeforeTask.subjects.flatMap((subject) => subject.points).find((point) => point.knowledgePointId === taskKnowledgePointId);
  const startedTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(taskId)}/start`, {}, studentHeaders);
  assert(startedTask.status === 'in_progress' && startedTask.startedAt, 'today task should enter an in-progress state');
  await expectPostStatus(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {}, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    completedQuestionCount: 5,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  }, 400, studentHeaders);
  const completedTask = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    userId: registered.user.id,
    completedQuestionCount: 8,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  }, studentHeaders);
  assert(completedTask.completed === true, 'study-task completion should be persisted');
  assert(completedTask.nextDayAdjustment?.scheduledDate, 'task completion should adjust the next matching task');
  const masteryAfterTask = await getJson(`${apiUrl}/mastery-map`, studentHeaders);
  const masteryPointAfter = masteryAfterTask.subjects.flatMap((subject) => subject.points).find((point) => point.knowledgePointId === taskKnowledgePointId);
  assert(masteryPointAfter.practiceCount > masteryPointBefore.practiceCount, 'task quality should update mastery evidence');
  const postponeTaskId = todayPlanBeforeTask.priorityTasks.find((task) => task.id !== taskId)?.id;
  assert(postponeTaskId, 'dashboard should expose another task for postponement testing');
  const postponedTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(postponeTaskId)}/postpone`, {}, studentHeaders);
  assert(postponedTask.taskId === postponeTaskId && postponedTask.rescheduledDate, 'study-task postponement should automatically reschedule the task');
  const todayPlanAfterPostpone = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(!todayPlanAfterPostpone.priorityTasks.some((task) => task.id === postponeTaskId), 'rescheduled task should leave today plan');

  await expectPostStatus(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-invalid-exam',
    questionIds: ['question-outside-bank'],
  }, 400, studentHeaders);
  const sessionInput = {
    type: 'paper',
    resourceId: 'integration-traceable-exam',
    questionIds: ['q-001', subjectiveQuestion.id],
  };
  const startedSession = await postJson(`${apiUrl}/sessions/practice/start`, sessionInput, studentHeaders);
  const idempotentSession = await postJson(`${apiUrl}/sessions/practice/start`, sessionInput, studentHeaders);
  assert(idempotentSession.id === startedSession.id, 'starting the same active resource should be idempotent');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    answers: { 'question-outside-session': { selectedAnswer: 'A', timeSpentSec: 10 } },
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    currentIndex: 9,
  }, 400, studentHeaders);
  const savedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    answers: { 'q-001': { selectedAnswer: 'A', timeSpentSec: 73 } },
    currentIndex: 1,
    markedQuestions: [subjectiveQuestion.id],
    totalActiveMs: 1250,
  }, studentHeaders);
  assert(savedSession.currentIndex === 1 && savedSession.markedQuestions.includes(subjectiveQuestion.id), 'session progress should be saved');
  await expectGetStatus(`${apiUrl}/sessions/practice/${startedSession.id}`, { Authorization: `Bearer ${teacherSession.token}` }, 403);

  await stop(activeApi);
  activeApi = startApi();
  await waitForHealth(activeApi);
  const reloggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(reloggedIn.user.id === registered.user.id, 'student should log in again after an API restart');
  studentHeaders = { Authorization: `Bearer ${reloggedIn.accessToken}` };
  const restored = await waitForOverview(studentHeaders, (data) =>
    data.practiceRecords?.some((record) => record.id === created.id)
      && data.wrongQuestions?.some((item) => item.questionId === 'q-001' && item.reviewStatus === 'reviewed')
      && data.plan?.dailyTasks?.some((task) => task.id === taskId && task.completed)
      && data.student?.targetScore === 126
      && data.questions?.some((question) => question.id === teacherQuestion.id),
  );
  const restoredRecord = restored.practiceRecords.find((record) => record.id === created.id);
  assert(restoredRecord.timeSpentSec === 137, 'record should survive an API restart');
  const restoredReview = restored.wrongQuestions.find((item) => item.questionId === 'q-001');
  assert(restoredReview.reviewedAt === masteredRedo.lastReviewedAt, 'latest wrong-question review timestamp should survive an API restart');
  const restoredWrongDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(restoredWrongDetail.note === savedNote.note, 'wrong-question note should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.stability === 'mastered', 'review mastery should survive an API restart');
  assert(restoredWrongDetail.reviewHistory?.length === 4, 'complete review trajectory should survive an API restart');
  assert(restoredWrongDetail.reviewHistory[0].nextIntervalDays === 1, 'review history should retain interval decisions');
  const restoredTask = restored.plan.dailyTasks.find((task) => task.id === taskId);
  assert(restoredTask.completed === true, 'study-task completion should survive an API restart');
  const restoredOnboarding = await getJson(`${apiUrl}/onboarding/status`, studentHeaders);
  assert(restoredOnboarding.completed === true && restoredOnboarding.profile.examYear, 'onboarding profile should survive an API restart');
  const restoredTodayPlan = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(restoredTodayPlan.weekProgress.length === 7, 'seven-day plan should survive an API restart');
  assert(!restoredTodayPlan.priorityTasks.some((task) => task.id === postponeTaskId), 'task rescheduling should survive an API restart');
  const restoredSession = await getJson(`${apiUrl}/sessions/practice/${startedSession.id}`, studentHeaders);
  assert(restoredSession.answers['q-001']?.selectedAnswer === 'A', 'saved answer should survive an API restart');
  assert(restoredSession.currentIndex === 1, 'current question should survive an API restart');
  assert(restoredSession.markedQuestions.includes(subjectiveQuestion.id), 'marked question should survive an API restart');
  assert(restoredSession.totalActiveMs === 1250, 'foreground active time should survive an API restart without adding downtime');
  await expectGetStatus(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders, 400);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'question-outside-session', selectedAnswer: 'A', timeSpentSec: 10 }],
  }, 400, studentHeaders);
  const submittedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [
      { questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 73 },
      { questionId: subjectiveQuestion.id, selectedAnswer: 'tag, line index, block offset', timeSpentSec: 240, selfScore: 7, maxScore: 10 },
    ],
    totalActiveMs: 2500,
  }, studentHeaders);
  assert(submittedSession.completed === true, 'restored session should be submittable');
  assert(submittedSession.records.some((record) => record.questionId === subjectiveQuestion.id && record.gradingMode === 'self_assessed'), 'comprehensive question should use self assessment');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 73 }],
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    currentIndex: 0,
    totalActiveMs: 3000,
  }, 400, studentHeaders);
  const examReport = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(examReport.summary.totalQuestions === 2 && examReport.summary.answeredCount === 2, 'exam report should use the submitted session question set');
  assert(examReport.summary.objectiveQuestionCount === 1 && examReport.summary.objectiveCorrectCount === 1, 'objective question should be graded automatically');
  assert(examReport.summary.subjectiveQuestionCount === 1 && examReport.summary.subjectiveEarnedScore === 7, 'subjective question should retain the student self score');
  assert(examReport.summary.subjectiveMaxScore === 10, 'subjective report should retain the maximum score');
  assert(examReport.subjectBreakdown.reduce((sum, item) => sum + item.totalQuestions, 0) === 2, 'old practice records must not contaminate the exam report');
  const examReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders);
  assert(examReviewPlan.days.length === 3, 'submitted exam should generate a three-day review plan');
  const scoreHistory = await getJson(`${apiUrl}/exam/score-history`, studentHeaders);
  assert(scoreHistory.history.some((item) => item.sessionId === startedSession.id), 'submitted exam should appear in score history');
  assert(restored.student.targetScore === 126, 'diagnostic profile should survive an API restart');
  assert(restored.student.weakestSubject === '计算机组成原理', 'diagnostic weakest subject should survive an API restart');
  assert(restored.questions.some((question) => question.id === teacherQuestion.id), 'teacher-created question should survive an API restart');
  const restoredPapers = await getJson(`${apiUrl}/papers`, { Authorization: `Bearer ${teacherSession.token}` });
  assert(restoredPapers.some((paper) => paper.id === generatedPaper.id), 'generated paper should survive an API restart');
  const restoredHistory = await getJson(`${apiUrl}/assessment-history`, studentHeaders);
  assert(restoredHistory.items.some((item) => item.paperId === generatedPaper.id), 'assessment history should survive an API restart');
  const restoredConfig = await getJson(`${apiUrl}/admin/system-config`, { Authorization: `Bearer ${adminSession.token}` });
  assert(restoredConfig.recommendation.stageAssessmentQuestionLimit === 2, 'system configuration should survive an API restart');
  const restoredFeedback = await getJson(`${apiUrl}/admin/feedback`, { Authorization: `Bearer ${adminSession.token}` });
  assert(restoredFeedback.items.some((item) => item.id === feedback.id), 'feedback should survive an API restart');

  await stop(activeApi);
  activeApi = startApi();
  await waitForHealth(activeApi);
  const twiceRestoredExamReport = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(twiceRestoredExamReport.summary.subjectiveEarnedScore === 7, 'traceable exam report should survive a second API restart');
  const twiceRestoredReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders);
  assert(twiceRestoredReviewPlan.generatedAt === examReviewPlan.generatedAt, 'post-exam review plan should be restored instead of regenerated');

  console.log(JSON.stringify({
    ok: true,
    source: restored.source,
    persistedRecordId: created.id,
    reviewedQuestionId: restoredReview.questionId,
    completedTaskId: restoredTask.id,
    restoredSessionId: restoredSession.id,
    restoredReviewHistoryCount: restoredWrongDetail.reviewHistory.length,
    traceableExamSessionId: startedSession.id,
    persistedExamReviewDays: twiceRestoredReviewPlan.days.length,
    persistedDiagnosticTarget: restored.student.targetScore,
    persistedTeacherQuestionId: teacherQuestion.id,
    persistedPaperId: generatedPaper.id,
    persistedFeedbackId: feedback.id,
    practiceRecordCount: restored.practiceRecords.length,
  }, null, 2));

  await stop(activeApi);
  activeApi = undefined;
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3200',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'integration-test-jwt-secret-with-more-than-32-characters',
      ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(output.trim());
  });
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`PostgreSQL API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.dataSource === 'postgresql' && child.exitCode == null) return;
      }
    } catch {}
    await delay(400);
  }
  throw new Error('Timed out waiting for PostgreSQL API health check');
}

async function waitForOverview(headers, predicate = () => true) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/dashboard/overview`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (predicate(data)) return data;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for PostgreSQL API: ${lastError?.message ?? 'no matching response'}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function patchJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PATCH ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function expectPostStatus(url, body, expectedStatus, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  assert(response.status === expectedStatus, `POST ${url} should return ${expectedStatus}, received ${response.status}`);
}

async function expectGetStatus(url, headers, expectedStatus) {
  const response = await fetch(url, { headers });
  assert(response.status === expectedStatus, `GET ${url} should return ${expectedStatus}, received ${response.status}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill();
  await Promise.race([once(child, 'exit'), delay(2_000)]);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => stop(activeApi));
