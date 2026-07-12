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
    'db',
    'push',
    '--schema',
    'prisma/schema.prisma',
    '--skip-generate',
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (schemaResult.status !== 0) {
    throw new Error(`Prisma schema push failed: ${schemaResult.error?.message || schemaResult.stderr || schemaResult.stdout}`);
  }

  activeApi = startApi();
  const initial = await waitForOverview();
  assert(initial.source === 'postgresql', 'API should report the real PostgreSQL data source');

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
    userId: 'u-001',
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'integration-test-wrong-answer',
    timeSpentSec: 137,
  });
  assert(created.id && created.correct === false, 'practice submission should be persisted');

  const reviewed = await postJson(`${apiUrl}/wrong-questions/q-001/review`, { userId: 'u-001' });
  assert(reviewed.reviewStatus === 'reviewed' && reviewed.reviewedAt, 'wrong-question review should be persisted');

  const taskId = initial.plan?.dailyTasks?.[0]?.id;
  assert(taskId, 'dashboard should expose a study task for completion testing');
  const completedTask = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    userId: 'u-001',
    completedQuestionCount: 8,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  });
  assert(completedTask.completed === true, 'study-task completion should be persisted');

  await stop(activeApi);
  activeApi = startApi();
  const restored = await waitForOverview((data) =>
    data.practiceRecords?.some((record) => record.id === created.id)
      && data.wrongQuestions?.some((item) => item.questionId === 'q-001' && item.reviewStatus === 'reviewed')
      && data.plan?.dailyTasks?.some((task) => task.id === taskId && task.completed),
  );
  const restoredRecord = restored.practiceRecords.find((record) => record.id === created.id);
  assert(restoredRecord.timeSpentSec === 137, 'record should survive an API restart');
  const restoredReview = restored.wrongQuestions.find((item) => item.questionId === 'q-001');
  assert(restoredReview.reviewedAt === reviewed.reviewedAt, 'wrong-question review should survive an API restart');
  const restoredTask = restored.plan.dailyTasks.find((task) => task.id === taskId);
  assert(restoredTask.completed === true, 'study-task completion should survive an API restart');

  console.log(JSON.stringify({
    ok: true,
    source: restored.source,
    persistedRecordId: created.id,
    reviewedQuestionId: restoredReview.questionId,
    completedTaskId: restoredTask.id,
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

async function waitForOverview(predicate = () => true) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/dashboard/overview`);
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
