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
  await waitForHealth();

  const credentials = {
    email: 'integration.student@example.com',
    password: 'ReliableTestPassword!408',
    name: '集成测试学生',
  };
  const registered = await postJson(`${apiUrl}/auth/register`, credentials);
  assert(registered.user.email === undefined && registered.user.role === 'student', 'registration should return a safe student profile');
  assert(registered.accessToken && registered.refreshToken, 'registration should issue access and refresh tokens');
  const loggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(loggedIn.user.id === registered.user.id, 'password login should return the registered user');
  const studentHeaders = { Authorization: `Bearer ${loggedIn.accessToken}` };
  const initial = await waitForOverview(studentHeaders);
  assert(initial.source === 'postgresql', 'API should report the real PostgreSQL data source');
  const diagnostic = await postJson(`${apiUrl}/diagnostics/profile`, {
    targetScore: 126,
    currentScore: 82,
    remainingDays: 88,
    dailyHours: 3,
    weakestSubject: '计算机组成原理',
  }, studentHeaders);
  assert(diagnostic.targetScore === 126, 'diagnostic profile should be accepted for the authenticated student');
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
    userId: registered.user.id,
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'integration-test-wrong-answer',
    timeSpentSec: 137,
  }, studentHeaders);
  assert(created.id && created.correct === false, 'practice submission should be persisted');

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

  const taskId = initial.plan?.dailyTasks?.[0]?.id;
  assert(taskId, 'dashboard should expose a study task for completion testing');
  const completedTask = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    userId: registered.user.id,
    completedQuestionCount: 8,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  }, studentHeaders);
  assert(completedTask.completed === true, 'study-task completion should be persisted');
  const postponeTaskId = initial.plan.dailyTasks.find((task) => task.id !== taskId)?.id;
  assert(postponeTaskId, 'dashboard should expose another task for postponement testing');
  const postponedTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(postponeTaskId)}/postpone`, {}, studentHeaders);
  assert(postponedTask.taskId === postponeTaskId && postponedTask.nextAvailableAt, 'study-task postponement should be accepted');

  const startedSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'practice_set',
    resourceId: 'integration-resume-set',
    questionIds: ['q-001', 'q-002'],
  }, studentHeaders);
  const savedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    answers: { 'q-001': { selectedAnswer: 'A', timeSpentSec: 73 } },
    currentIndex: 1,
    markedQuestions: ['q-002'],
    idleSince: Date.now() - 500,
  }, studentHeaders);
  assert(savedSession.currentIndex === 1 && savedSession.markedQuestions.includes('q-002'), 'session progress should be saved');
  await expectGetStatus(`${apiUrl}/sessions/practice/${startedSession.id}`, { Authorization: `Bearer ${teacherSession.token}` }, 403);

  await stop(activeApi);
  activeApi = startApi();
  await waitForHealth();
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
  const restoredSession = await getJson(`${apiUrl}/sessions/practice/${startedSession.id}`, studentHeaders);
  assert(restoredSession.answers['q-001']?.selectedAnswer === 'A', 'saved answer should survive an API restart');
  assert(restoredSession.currentIndex === 1, 'current question should survive an API restart');
  assert(restoredSession.markedQuestions.includes('q-002'), 'marked question should survive an API restart');
  assert(restoredSession.totalActiveMs >= 0, 'active time should survive an API restart');
  const submittedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'A', timeSpentSec: 73 }],
  }, studentHeaders);
  assert(submittedSession.completed === true, 'restored session should be submittable');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'A', timeSpentSec: 73 }],
  }, 400, studentHeaders);
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

  console.log(JSON.stringify({
    ok: true,
    source: restored.source,
    persistedRecordId: created.id,
    reviewedQuestionId: restoredReview.questionId,
    completedTaskId: restoredTask.id,
    restoredSessionId: restoredSession.id,
    restoredReviewHistoryCount: restoredWrongDetail.reviewHistory.length,
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
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(output.trim());
  });
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
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
