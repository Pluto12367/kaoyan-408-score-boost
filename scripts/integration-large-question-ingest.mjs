/**
 * PHASE 8 — large-question rubric INGEST end-to-end (real PG + HTTP).
 *
 * Proves the newly added write path that the content track needs:
 *
 *   POST /questions (type 综合题 + subtype + maxScore + rubric)
 *     → persisted, served back validated with a content hash
 *     → POST /questions/:id/subjective-attempt scores it offline against the
 *       SAME rubric (the existing F4 chain) and records the evidence
 *     → PATCH update carries the rubric forward to the new version
 *   invalid rubric (semantic) → 400, never stored
 *   anonymous rubric read → 401
 *
 * Fixture rubrics here are INTEGRATION TEST DATA, not claimed real exam
 * content (contract §13: real content sources stay with Owner/教研).
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3270';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-large-question-ingest-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const password = 'Large-Question-Ingest-Password-1';

const ids = {
  admin: `lqi-admin-${runId}`,
  point: `lqi-point-${runId}`,
};

const RUBRIC = {
  version: 1,
  totalPoints: 6,
  criteria: [
    { id: 'c1', description: '写出信号量定义', points: 2, evidenceHint: '出现信号量定义', matchAny: ['信号量', 'semaphore'] },
    { id: 'c2', description: '给出 P/V 顺序', points: 4, evidenceHint: 'P/V 次序正确', matchAny: ['P(', 'V('] },
  ],
};

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;
let prisma = null;
// API-created questions get sequential ids (q-NNN), so cleanup must track the
// family explicitly instead of matching the run id against the question id.
let ingestFamilyId = null;

async function seedBeforeBoot() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'LQ Ingest Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgePoint.create({
    data: { id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'P8', title: 'PV ingres 考点', importance: 4, frequency: 4, prerequisites: [] },
  });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env, PORT: '3270', WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API did not become healthy in time');
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function postStatus(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function patchJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PATCH ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function verifyAfterBoot() {
  const adminHeaders = { authorization: `Bearer ${await postJson(`${apiUrl}/auth/login`, { email: `${ids.admin}@integration.test`, password }).then((r) => r.accessToken)}` };
  record('seed', 'admin ready');

  // 1. INGEST: a large question with rubric through the real create path.
  const created = await postJson(`${apiUrl}/questions`, {
    stem: 'P8 大题：生产者-消费者 PV 设计', options: ['作答区', '作答区'], answer: 'semWait/Signal 序列',
    analysis: '先定义信号量，再给出 P/V 次序。', knowledgePointIds: [ids.point], difficulty: '中等',
    type: '综合题', source: 'integration-fixture', expectedTimeSec: 300,
    questionSubtype: 'OS_PV', maxScore: 6, rubric: RUBRIC,
  }, adminHeaders);
  assert.equal(created.questionSubtype, 'OS_PV');
  assert.equal(created.maxScore, 6);
  const questionId = created.id;
  const stored = await prisma.question.findUnique({ where: { id: questionId }, select: { rubric: true, familyId: true } });
  assert.ok(stored.rubric, 'rubric persisted to the database');
  ingestFamilyId = stored.familyId;
  record('ingest', `rubric stored (${stored.rubric.criteria.length} criteria, ${stored.rubric.totalPoints} points)`);

  // 2. SERVE: read it back validated, with the content hash.
  const rubricView = await getJson(`${apiUrl}/questions/${questionId}/rubric`, adminHeaders);
  assert.equal(rubricView.hasRubric, true);
  assert.equal(rubricView.validation.valid, true);
  assert.ok(rubricView.rubricHash, 'content hash present (score revisions stay explainable)');
  assert.equal(rubricView.rubric.criteria.length, 2);
  record('serve', `GET rubric → valid, hash=${rubricView.rubricHash.slice(0, 12)}…`);

  // 3. SCORE: the existing F4 offline chain consumes the ingested rubric.
  const attempt = await postJson(`${apiUrl}/questions/${questionId}/subjective-attempt`, {
    answerText: '信号量 semaphore 定义为整型变量；先 P(S) 再 V(S)，顺序为 P(mutex) V(mutex)。',
  }, adminHeaders);
  assert.equal(attempt.questionId, questionId);
  assert.equal(attempt.score.verdict, 'perfect', `expected perfect, got ${attempt.score.verdict}`);
  assert.equal(attempt.score.score, 6);
  assert.equal(attempt.score.maxScore, 6);
  assert.equal(attempt.score.rubricVersion, 1);
  assert.ok(attempt.nextStep && attempt.nextStep.length > 0, 'the result states the human-confirmation boundary');
  record('score', `offline rubric scoring on ingested content: ${attempt.score.score}/${attempt.score.maxScore} (${attempt.score.verdict})`);

  // 4. REJECT: a semantically invalid rubric never enters the system.
  const invalid = await postStatus(`${apiUrl}/questions`, {
    stem: 'x', options: ['a', 'b'], answer: 'a', analysis: 'x', knowledgePointIds: [ids.point],
    difficulty: '中等', type: '综合题', source: 'integration-fixture',
    rubric: { ...RUBRIC, totalPoints: 99 },
  }, adminHeaders);
  assert.equal(invalid.status, 400, `invalid rubric must 400, got ${invalid.status}`);
  record('reject', 'invalid rubric (totalPoints mismatch) → 400, nothing stored');

  // 5. UPDATE: versioned update carries the rubric forward.
  const patched = await patchJson(`${apiUrl}/questions/${questionId}`, { stem: 'P8 大题（修订版）：生产者-消费者 PV 设计' }, adminHeaders);
  const patchedRubric = await getJson(`${apiUrl}/questions/${patched.id}/rubric`, adminHeaders);
  assert.equal(patchedRubric.hasRubric, true, 'rubric survives a versioned update when omitted');
  assert.equal(patchedRubric.rubric.totalPoints, 6);
  record('update', 'omitted rubric carries forward to the new version (never silently dropped)');

  const anon = await fetch(`${apiUrl}/questions/${questionId}/rubric`);
  assert.equal(anon.status, 401);
  record('guards', 'anonymous rubric read → 401');
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    console.log(`\nPHASE 8 Large-question rubric ingest integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nPHASE 8 Large-question rubric ingest integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    await runCleanup();
    process.exit(1);
  } finally {
    // Cleanup runs explicitly before each process.exit: process.exit()
    // terminates the process synchronously and never executes finally.
  }

})();

async function runCleanup() {
    try {
      if (prisma && !process.env.KEEP_FIXTURES) {
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        if (ingestFamilyId) await prisma.question.deleteMany({ where: { familyId: ingestFamilyId } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort
    }
  }
