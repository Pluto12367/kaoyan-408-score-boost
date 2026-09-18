/**
 * PHASE 5 — Training Prescription real PG + HTTP E2E.
 *
 * Verifies the consumption chain the contract demands:
 *   Answer → ErrorPattern → Diagnosis → Prescription (against the REAL bank)
 *
 *   • seeded bank: 3 BASIC + 2 MEDIUM OS_PV questions on one node (bridge map)
 *   • student answers them wrong through the real practice endpoint
 *   • self-reports calculation_error (the mandated target example)
 *   • GET /coach/error-diagnosis → finding exists
 *   • GET /coach/training-prescription → ladder built from the REAL counts:
 *       basic READY(3), same_type READY(2), variant UNAVAILABLE (no AI key),
 *       review dueInDays=1, retest dueInDays=3, dataStatus OK
 *   • explicit selector for an unknown node → EMPTY (honest, no invention)
 *   • student B with no evidence → EMPTY
 *   • 401 unauthenticated
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
const jwtSecret = 'integration-training-prescription-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Training-Prescription-Integration-Password-1';

const ids = {
  admin: `tp-admin-${runId}`,
  node: `tp-node-${runId}`,
  point: `tp-point-${runId}`,
};

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Prescription Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 处方节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  // Bridge-shaped attribution (production reality): point → node map.
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'P5', title: 'PV 处方考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });

  // REAL bank: 3 BASIC + 2 MEDIUM, all OS_PV, all current.
  for (let index = 0; index < 5; index += 1) {
    const id = `tp-q-${runId}-${index}`;
    await prisma.questionFamily.create({ data: { id: `tp-fam-${id}` } });
    await prisma.question.create({
      data: {
        id, familyId: `tp-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
        stem: `P5 fixture ${index}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
        difficulty: index < 3 ? 'BASIC' : 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration',
        expectedTimeSec: 60, questionSubtype: 'OS_PV', maxScore: 2,
      },
    });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  }
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

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function createStudent(tag) {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: `p5 ${tag}`,
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  const email = `tp-${tag}-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: `处方学生${tag}`, inviteCode: invite });
  const userId = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: userId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken;
  return { userId, headers: { authorization: `Bearer ${token}` } };
}

async function verifyAfterBoot() {
  const student = await createStudent('a');
  const studentB = await createStudent('b');
  record('seed', `student A=${student.userId}, B=${studentB.userId}; bank = 3 BASIC + 2 MEDIUM (OS_PV, bridge-mapped)`);

  // Answer four banker questions wrong through the REAL single-question path.
  for (let index = 0; index < 4; index += 1) {
    await postJson(`${apiUrl}/practice-records`, {
      questionId: `tp-q-${runId}-${index}`, knowledgePointId: ids.point,
      selectedAnswer: 'X', timeSpentSec: 60,
    }, { ...student.headers, 'idempotency-key': `tp-practice-${runId}-${index}` });
  }
  record('practice', '4 wrong answers submitted (no-signal → unclassified)');

  await postJson(`${apiUrl}/wrong-questions/tp-q-${runId}-0/reason`, {
    controlledReason: 'calculation_error', redoCorrect: false, timeSpentSec: 60,
    idempotencyKey: `tp-report-${runId}`,
  }, student.headers);
  record('report', 'calculation_error self-report creates the target finding');

  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, student.headers);
  const finding = diagnosis.findings.find((row) => row.reasonCode === 'calculation_error');
  assert.ok(finding, 'diagnosis exposes the OS_PV×calculation_error finding');
  assert.equal(finding.nodeId, ids.node);

  // Mandated consumption: Diagnosis → Prescription against the REAL bank.
  const prescription = await getJson(
    `${apiUrl}/coach/training-prescription?days=7&nodeId=${ids.node}&questionSubtype=OS_PV&reasonCode=calculation_error`,
    student.headers,
  );
  assert.equal(prescription.storeAvailable, true);
  assert.equal(prescription.dataStatus, 'OK');
  assert.equal(prescription.target.reasonCode, 'calculation_error');
  assert.equal(prescription.target.questionSubtype, 'OS_PV');
  assert.equal(prescription.difficultyAnchor, 'BASIC', 'weak mastery anchors at BASIC');

  const step = (stage) => prescription.ladder.find((row) => row.stage === stage);
  assert.equal(step('basic').status, 'READY');
  assert.equal(step('basic').questionCount, 3, 'finds a count of 3 in the real bank');
  assert.equal(step('same_type').questionCount, 2, 'same-type count comes from the real bank');
  assert.equal(step('variant').status, 'UNAVAILABLE', 'no AI key → explicit unavailability');
  assert.ok(step('variant').reason);
  assert.equal(step('review').dueInDays, 1, '24h review from the shared interval constants');
  assert.equal(step('retest').dueInDays, 3, '3d retest from the shared interval constants');
  assert.deepEqual(prescription.ladder.map((row) => row.order), [1, 2, 3, 4, 5]);
  record('prescription', 'ladder: basic 3 → same_type 2 → variant UNAVAILABLE → review 1d → retest 3d');

  // Honest absence: unknown node selector → EMPTY, nothing invented.
  const unknownNode = await getJson(`${apiUrl}/coach/training-prescription?nodeId=no-such-node`, student.headers);
  assert.equal(unknownNode.dataStatus, 'EMPTY');
  assert.deepEqual(unknownNode.ladder, []);

  // Student B without evidence → EMPTY.
  const emptyB = await getJson(`${apiUrl}/coach/training-prescription`, studentB.headers);
  assert.equal(emptyB.dataStatus, 'EMPTY');
  assert.deepEqual(emptyB.ladder, []);
  record('empty', 'unknown selector and evidence-free student both yield EMPTY (no fabrication)');

  const anon = await fetch(`${apiUrl}/coach/training-prescription`);
  assert.equal(anon.status, 401);
  record('guards', 'unauthenticated prescription read → 401');
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
    console.log(`\nPHASE 5 Training Prescription integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nPHASE 5 Training Prescription integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput());
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
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'tp-fam-' } } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort
    }
  }
