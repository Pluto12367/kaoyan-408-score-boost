/**
 * V13-A2 ErrorPattern → Diagnosis — real PostgreSQL + HTTP E2E.
 *
 * Chain: paper submission (priced/unpriced/comprehensive) + a controlled
 * self-report → ScoreLoss ledger rows + wrong-attempt facts →
 * GET /coach/error-diagnosis prioritized rows.
 *
 * Bucket semantics verified:
 *   • priced objective wrong  → OBSERVED loss = maxScore in its bucket
 *   • comprehensive self-score→ PROXY loss, separate field (never merged)
 *   • unpriced wrong          → counted, zero loss value (NULL ≠ 0)
 *   • the same question seen through its auto label AND its self-report lands
 *     in two buckets (each reports the question's loss honestly) while the
 *     summary dedupes by question (2, not 4).
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
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
const jwtSecret = 'integration-error-diagnosis-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Error-Diagnosis-Integration-Password-1';

const ids = {
  admin: `ed-admin-${runId}`,
  student: null,
  nodeOs: `ed-node-os-${runId}`,
  pointOs: `ed-point-os-${runId}`,
  paper: `ed-paper-${runId}`,
  createdQuestion: null,
};
let qPriced; let qUnpriced; let qComprehensive; let qCorrect;

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;
let prisma = null;

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Error Diagnosis Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.nodeOs, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 诊断节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointOs, subject: 'OPERATING_SYSTEM', chapter: 'A2', title: 'PV 诊断考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeOs, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });

  const question = (id, overrides = {}) => ({
    id, familyId: `ed-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `A2 fixture ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    ...overrides,
  });
  qPriced = `ed-priced-${runId}`;
  qUnpriced = `ed-unpriced-${runId}`;
  qComprehensive = `ed-comprehensive-${runId}`;
  qCorrect = `ed-correct-${runId}`;
  for (const [id, overrides] of [
    [qPriced, {}],
    [qUnpriced, {}],
    [qComprehensive, { type: 'COMPREHENSIVE', options: ['作答区', '作答区'], answer: '', analysis: '逐步更新。' }],
    [qCorrect, {}],
  ]) {
    await prisma.questionFamily.create({ data: { id: `ed-fam-${id}` } });
    await prisma.question.create({ data: question(id, overrides) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.pointOs } });
  }

  await prisma.paper.create({
    data: {
      id: ids.paper, title: 'A2 诊断集成卷', paperType: '模拟卷', questionCount: 4,
      knowledgePointIds: [ids.pointOs],
      questions: [
        { id: qPriced, stem: 'A2 定价题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
        { id: qUnpriced, stem: 'A2 未定价题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'B', analysis: 'x' },
        { id: qComprehensive, stem: 'A2 大题（自评）', type: '综合题', options: ['作答区', '作答区'], answer: '', analysis: '逐步更新。' },
        { id: qCorrect, stem: 'A2 答对题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
      ],
      estimatedMinutes: 20, createdBy: ids.admin,
    },
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
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy in time`);
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
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'v13 a2 error diagnosis integration',
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: `ed-student-${runId}@integration.test`, password, name: '诊断学生', inviteCode: invite,
  });
  const student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  ids.student = student;
  const studentHeaders = { authorization: `Bearer ${await postJson(`${apiUrl}/auth/login`, { email: `ed-student-${runId}@integration.test`, password }).then((r) => r.accessToken)}` };
  const adminHeaders = { authorization: `Bearer ${await postJson(`${apiUrl}/auth/login`, { email: `${ids.admin}@integration.test`, password }).then((r) => r.accessToken)}` };
  record('seed', `accounts ready (student=${student})`);

  // Price two questions through the REAL PATCH path (qUnpriced stays NULL).
  await patchJson(`${apiUrl}/questions/${qPriced}`, { questionSubtype: 'OS_PV', maxScore: 2 }, adminHeaders);
  qPriced = (await prisma.question.findFirst({ where: { familyId: `ed-fam-${qPriced}` }, orderBy: { versionNumber: 'desc' }, select: { id: true } })).id;
  await patchJson(`${apiUrl}/questions/${qComprehensive}`, { questionSubtype: 'ALGORITHM', maxScore: 10 }, adminHeaders);
  qComprehensive = (await prisma.question.findFirst({ where: { familyId: `ed-fam-${qComprehensive}` }, orderBy: { versionNumber: 'desc' }, select: { id: true } })).id;
  record('price', 'qPriced → OS_PV/2, qComprehensive → ALGORITHM/10 via PATCH; qUnpriced stays NULL');

  // A CREATE-path question priced too (proves both write entrances).
  const created = await postJson(`${apiUrl}/questions`, {
    stem: 'A2 创建即定价题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    knowledgePointIds: [ids.pointOs], difficulty: '中等', type: '选择题', source: 'integration',
    questionSubtype: 'CN_ROUTING', maxScore: 2,
  }, adminHeaders);
  ids.createdQuestion = created.id;
  assert.equal(created.questionSubtype, 'CN_ROUTING');

  // Submit the paper: priced wrong / unpriced wrong / comprehensive self 4/10 / correct.
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qPriced, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qUnpriced, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qComprehensive, selectedAnswer: '', timeSpentSec: 60, selfScore: 4, maxScore: 10 },
      { questionId: qCorrect, selectedAnswer: 'A', timeSpentSec: 30 },
    ],
  }, studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 4);
  record('submit', 'paper submitted (1 correct, 3 wrong: priced/unpriced/self-scored)');

  // Controlled self-report on the SAME priced question → a second bucket
  // (method_error) whose loss joins by question.
  await postJson(`${apiUrl}/wrong-questions/${qPriced}/reason`, {
    controlledReason: 'calculation_error', redoCorrect: false, timeSpentSec: 20,
    idempotencyKey: `ed-report-${runId}`,
  }, studentHeaders);
  record('report', 'self-reported calculation_error on the priced question (task §21 mandated example)');

  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, studentHeaders);
  assert.equal(diagnosis.storeAvailable, true);
  assert.equal(diagnosis.dataStatus, 'OK');
  assert.equal(diagnosis.summary.wrongCount, 4);
  assert.equal(diagnosis.summary.observedLostScore, 2, 'summary dedupes loss by question (2, not 4 across buckets)');
  assert.equal(diagnosis.summary.proxyLostScore, 6);
  assert.equal(diagnosis.summary.pricedQuestions, 2);
  assert.equal(diagnosis.summary.unpricedQuestions, 1);

  const findings = diagnosis.findings;
  const bucket = (subtype, reason) => findings.find((row) => row.questionSubtype === subtype && row.reasonCode === reason);
  // 30s on a 60s question is "too fast" → auto label reading_error (审题错误 heuristic).
  const priced = bucket('OS_PV', 'reading_error');
  assert.ok(priced && priced.observedLostScore === 2 && priced.pricedCount === 1, 'priced bucket: OBSERVED loss 2');
  // Task §21 mandated example: OS + OS_PV + calculation_error as its OWN finding.
  const calculation = bucket('OS_PV', 'calculation_error');
  assert.ok(calculation && calculation.observedLostScore === 2 && calculation.sources.includes('self_reported'),
    'self-reported calculation_error forms an independent OS_PV finding');
  assert.notEqual(calculation.priorityRank, priced.priorityRank, 'same subtype, different reason → separate findings');
  const algoProxy = bucket('ALGORITHM', 'time_insufficient');
  assert.ok(algoProxy && algoProxy.proxyLostScore === 6 && algoProxy.observedLostScore === 0,
    'comprehensive self-score stays PROXY and separate');
  // Unknown subtype must NOT pollute the known OS_PV findings.
  const unknownBucket = findings.find((row) => row.questionSubtype === 'unknown');
  assert.ok(unknownBucket && unknownBucket.count === 1 && unknownBucket.observedLostScore === 0,
    'unpriced wrong counted with zero loss value (NULL ≠ 0), isolated from OS_PV rows');
  assert.equal(findings[0].priorityRank, 1);
  assert.deepEqual(findings.map((row) => row.priorityRank), findings.map((_, index) => index + 1));
  assert.equal(findings[0].dataStatus, undefined, 'dataStatus lives on the envelope, not per finding');
  record('diagnosis', `${findings.length} findings incl. OS_PV×calculation_error; unknown isolated; summary deduped`);

  const anon = await fetch(`${apiUrl}/coach/error-diagnosis`);
  assert.equal(anon.status, 401);
  record('guards', 'unauthenticated diagnosis read → 401');
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
    console.log(`\nV13-A2 Error Diagnosis integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nV13-A2 Error Diagnosis integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output ---');
      console.error(activeApi.getOutput());
    }
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
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        // Versioned updates mint sequential ids (q-NNN) that the run-id match
        // cannot catch: delete the whole fixture families first, then any
        // run-id leftovers, then the (now unreferenced) families.
        await prisma.question.deleteMany({ where: { family: { id: { startsWith: 'ed-fam-' } } } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: ids.createdQuestion } }).catch(() => {});
        await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.pointOs } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: ids.nodeOs } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'ed-fam-' } } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort
    }
  }
