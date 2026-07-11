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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
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
