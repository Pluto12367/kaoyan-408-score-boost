/**
 * V13-P0-1 Question Scoring & Question Type Foundation — real PG + HTTP E2E.
 *
 * Chain under test (Owner Decision v1.1 + task §16):
 *
 *   POST /questions (subtype + maxScore)      → create path persists both
 *   PATCH /questions/:id (subtype label)      → versioned update keeps them
 *   invalid subtype / negative maxScore       → 400 (never stored)
 *   POST /papers/:id/submit                   → real scoring chain
 *   priced objective wrong                    → OBSERVED loss = maxScore
 *   unpriced wrong                            → counted, maxScore NULL ≠ 0
 *   comprehensive self-scored (legacy path)   → PROXY loss, behavior unchanged
 *   correct answer                            → no loss row
 *   GET /coach/error-patterns                 → subtype fact dimension present
 *   coverage                                  → > 0 with priced content
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
const jwtSecret = 'integration-question-scoring-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Question-Scoring-Integration-Password-1';

const ids = {
  admin: `qs-admin-${runId}`,
  student: null,
  nodeOs: `qs-node-os-${runId}`,
  pointOs: `qs-point-os-${runId}`,
  family: `qs-family-${runId}`,
  paper: `qs-paper-${runId}`,
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
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Question Scoring Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.nodeOs, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointOs, subject: 'OPERATING_SYSTEM', chapter: 'P0-1', title: 'PV 定价考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeOs, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  await prisma.questionFamily.create({ data: { id: ids.family } });

  // Four questions seeded BEFORE boot, all with subtype=NULL / maxScore=NULL —
  // this is the at-rest historical-compatibility state (Owner D5/D6). Pricing
  // happens later through the REAL PATCH path; the paper must exist before boot
  // because the paper repository hydrates once at startup. Each question gets
  // its OWN family (one family = one question lineage, the updateQuestion
  // versioning model).
  const question = (id, overrides = {}) => ({
    id, familyId: `qs-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `P0-1 fixture ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    ...overrides,
  });
  qPriced = `qs-priced-${runId}`;
  qUnpriced = `qs-unpriced-${runId}`;
  qComprehensive = `qs-comprehensive-${runId}`;
  qCorrect = `qs-correct-${runId}`;
  for (const [id, overrides] of [
    [qPriced, {}],
    [qUnpriced, {}],
    [qComprehensive, {
      type: 'COMPREHENSIVE', options: ['作答区', '作答区'], answer: '', analysis: '逐步更新。',
      stem: 'P0-1 算法大题（legacy 自评通道）',
    }],
    [qCorrect, {}],
  ]) {
    await prisma.questionFamily.create({ data: { id: `qs-fam-${id}` } });
    await prisma.question.create({ data: question(id, overrides) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.pointOs } });
  }

  const paperQuestions = [
    { id: qPriced, stem: 'P0-1 信号量定价题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
    { id: qUnpriced, stem: 'P0-1 未定价题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'B', analysis: 'x' },
    { id: qComprehensive, stem: 'P0-1 算法大题（legacy 自评通道）', type: '综合题', options: ['作答区', '作答区'], answer: '', analysis: '逐步更新。' },
    { id: qCorrect, stem: 'P0-1 已定价答对题', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
  ];
  await prisma.paper.create({
    data: {
      id: ids.paper, title: 'P0-1 定价集成卷', paperType: '模拟卷', questionCount: 4,
      knowledgePointIds: [ids.pointOs], questions: paperQuestions, estimatedMinutes: 20, createdBy: ids.admin,
    },
  });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3270',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      ALLOW_DEMO_AUTH: 'true',
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
  throw new Error(`API did not become healthy in time: ${child.getOutput?.().slice(-2000) ?? ''}`);
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

async function postStatus(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function createInvitation(maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6), label: 'v13 p0-1 question scoring integration',
      maxUses, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  return code;
}

async function verifyAfterBoot() {
  const invite = await createInvitation(5);
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: `qs-student-${runId}@integration.test`, password, name: '定价学生', inviteCode: invite,
  });
  const student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  ids.student = student;
  const login = async (email) => (await postJson(`${apiUrl}/auth/login`, { email, password }))?.accessToken;
  const adminHeaders = { authorization: `Bearer ${await login(`${ids.admin}@integration.test`)}` };
  const studentHeaders = { authorization: `Bearer ${await login(`qs-student-${runId}@integration.test`)}` };
  assert.ok(adminHeaders.authorization && studentHeaders.authorization, 'logins must succeed');
  record('seed', `accounts ready (student=${student})`);

  // ---------------------------------------------------------------
  // 1. CREATE path: subtype + maxScore persist; validation rejects.
  // ---------------------------------------------------------------
  const created = await postJson(`${apiUrl}/questions`, {
    stem: 'P0-1 信号量定价题', options: ['A', 'B', 'C', 'D'], answer: 'A',
    analysis: '标准 PV 序列。', knowledgePointIds: [ids.pointOs], difficulty: '中等',
    type: '选择题', source: 'integration', expectedTimeSec: 60,
    questionSubtype: 'OS_PV', maxScore: 2,
  }, adminHeaders);
  ids.createdQuestion = created.id;
  assert.equal(created.questionSubtype, 'OS_PV', 'create returns the canonical subtype code');
  assert.equal(created.maxScore, 2);
  const pricedRow = await prisma.question.findUnique({ where: { id: ids.createdQuestion }, select: { questionSubtype: true, maxScore: true } });
  assert.equal(pricedRow.questionSubtype, 'OS_PV');
  assert.equal(pricedRow.maxScore, 2);
  record('create', 'subtype + maxScore persisted through the real create path');

  const badSubtype = await postStatus(`${apiUrl}/questions`, {
    stem: 'x', options: ['A', 'B'], answer: 'A', analysis: 'x', knowledgePointIds: [ids.pointOs],
    difficulty: '中等', type: '选择题', source: 'integration', questionSubtype: 'BOGUS',
  }, adminHeaders);
  assert.equal(badSubtype.status, 400, `invalid subtype must 400, got ${badSubtype.status}`);
  const negativeScore = await postStatus(`${apiUrl}/questions`, {
    stem: 'x', options: ['A', 'B'], answer: 'A', analysis: 'x', knowledgePointIds: [ids.pointOs],
    difficulty: '中等', type: '选择题', source: 'integration', maxScore: -1,
  }, adminHeaders);
  assert.equal(negativeScore.status, 400, `negative maxScore must 400, got ${negativeScore.status}`);
  record('validation', 'invalid subtype / negative maxScore rejected with 400 (never stored)');

  // ---------------------------------------------------------------
  // 2. PATCH path (versioned) prices the seeded questions. The seeded rows
  //    started NULL/NULL — the historical version PROVES nothing is backfilled.
  // ---------------------------------------------------------------
  const patched = await patchJson(`${apiUrl}/questions/${qPriced}`, {
    questionSubtype: 'OS PV 题', maxScore: 2, // label input → normalized to the frozen code
  }, adminHeaders);
  assert.equal(patched.questionSubtype, 'OS_PV', 'label input normalizes to the frozen code');
  qPriced = patched.id; // update creates a NEW version id
  const versions = await prisma.question.findMany({
    where: { familyId: (await prisma.question.findUnique({ where: { id: qPriced }, select: { familyId: true } })).familyId },
    select: { id: true, isCurrent: true, questionSubtype: true, maxScore: true },
  });
  assert.equal(versions.length, 2, 'PATCH creates a new content version');
  assert.equal(versions.filter((row) => row.isCurrent).length, 1, 'exactly one current version');
  const historical = versions.find((row) => !row.isCurrent);
  assert.equal(historical.questionSubtype, null, 'seeded NULL subtype is never backfilled (Owner D6)');
  assert.equal(historical.maxScore, null, 'seeded NULL maxScore is never backfilled');
  const current = versions.find((row) => row.isCurrent);
  assert.equal(current.questionSubtype, 'OS_PV');
  assert.equal(current.maxScore, 2);
  record('patch', 'versioned pricing through the real PATCH path; historical NULL never rewritten');

  const patchedComprehensive = await patchJson(`${apiUrl}/questions/${qComprehensive}`, {
    questionSubtype: '算法大题', maxScore: 10, // Chinese label input
  }, adminHeaders);
  qComprehensive = patchedComprehensive.id; // versioned update → new id
  const comprehensiveRow = await prisma.question.findUnique({
    where: { id: qComprehensive }, select: { questionSubtype: true, maxScore: true },
  });
  assert.equal(comprehensiveRow.questionSubtype, 'ALGORITHM', 'Chinese label normalizes to ALGORITHM');
  assert.equal(comprehensiveRow.maxScore, 10);

  const patchedCorrect = await patchJson(`${apiUrl}/questions/${qCorrect}`, {
    questionSubtype: 'SINGLE_CHOICE', maxScore: 2,
  }, adminHeaders);
  qCorrect = patchedCorrect.id;
  // qUnpriced is deliberately NEVER patched — it must stay unknown/unpriced.
  const unpricedRow = await prisma.question.findFirst({
    where: { id: { startsWith: 'qs-unpriced-' } }, orderBy: { versionNumber: 'desc' },
    select: { maxScore: true, questionSubtype: true },
  });
  assert.equal(unpricedRow.maxScore, null, 'untouched question stays unpriced (NULL, never 0)');
  assert.equal(unpricedRow.questionSubtype, null);
  record('price', 'qPriced/qComprehensive/qCorrect priced via PATCH; qUnpriced stays unpriced');

  // ---------------------------------------------------------------
  // 3. REAL submission → ScoreLoss derivation.
  // ---------------------------------------------------------------
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qPriced, selectedAnswer: 'X', timeSpentSec: 30 },                                      // wrong, priced → OBSERVED 2
      { questionId: qUnpriced, selectedAnswer: 'X', timeSpentSec: 30 },                                    // wrong, unpriced → counted
      { questionId: qComprehensive, selectedAnswer: '', timeSpentSec: 60, selfScore: 4, maxScore: 10 },    // PROXY lost 6
      { questionId: qCorrect, selectedAnswer: 'A', timeSpentSec: 30 },                                     // correct → no loss
    ],
  }, studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 4);
  assert.equal(submission.accuracyRate, 25, 'legacy comprehensive self-assessed grading unchanged (4/10 < 60% → wrong)');
  record('submit', 'paper submitted through the real endpoint (accuracy 25%)');

  const lossRows = await prisma.scoreLossItem.findMany({ where: { userId: student } });
  const byQuestion = new Map(lossRows.map((row) => [row.questionId, row]));
  const priced = byQuestion.get(qPriced);
  assert.ok(priced && priced.lossKind === 'OBSERVED' && priced.lostScore === 2 && priced.maxScore === 2,
    'priced objective wrong → OBSERVED loss = maxScore');
  const unpricedLoss = byQuestion.get(qUnpriced);
  assert.ok(unpricedLoss && unpricedLoss.maxScore === null && unpricedLoss.lostScore === null,
    'unpriced wrong: counted with NULL (never 0)');
  const proxy = byQuestion.get(qComprehensive);
  assert.ok(proxy && proxy.lossKind === 'PROXY' && proxy.lostScore === 6,
    'comprehensive self-score stays PROXY (legacy path, behavior unchanged)');
  assert.equal(byQuestion.get(qCorrect), undefined, 'correct answer produces no loss row');
  const pricedLossCount = lossRows.filter((row) => row.lostScore != null).length;
  const eligibleLosses = lossRows.length;
  assert.ok(pricedLossCount > 0, 'coverage > 0: priced evidence exists');
  assert.ok(pricedLossCount / eligibleLosses > 0, `coverage ratio ${pricedLossCount}/${eligibleLosses} > 0`);
  record('scoreloss', `coverage = ${pricedLossCount}/${eligibleLosses} > 0; OBSERVED/PROXY/unpriced all separated`);

  // ---------------------------------------------------------------
  // 4. ErrorPattern subtype fact dimension.
  // ---------------------------------------------------------------
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, studentHeaders);
  assert.equal(patterns.storeAvailable, true);
  assert.equal(patterns.totals.wrongCount, 3);
  assert.equal(patterns.totals.bySubtype.OS_PV, 1);
  assert.equal(patterns.totals.bySubtype.ALGORITHM, 1);
  const pvRow = patterns.patterns.find((row) => row.questionSubtype === 'OS_PV');
  assert.ok(pvRow, 'OS+OS_PV wrong evidence is queryable (task §10)');
  const unknownRow = patterns.patterns.find((row) => row.questionSubtype === 'unknown');
  assert.ok(unknownRow, 'unknown-subtype evidence surfaces in its own bucket (never merged, never guessed)');
  assert.equal(unknownRow.count, 1, 'exactly the unpriced wrong attempt sits in the unknown bucket');
  record('errorpatterns', 'subtype fact dimension present: bySubtype {OS_PV:1, ALGORITHM:1}');

  // Guards.
  const anon = await fetch(`${apiUrl}/coach/error-patterns`);
  assert.equal(anon.status, 401);
  record('guards', 'unauthenticated projection read → 401');
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
    console.log(`\nV13-P0-1 Question Scoring integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nV13-P0-1 Question Scoring integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output (full) ---');
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
        // Invitation rows hold FKs to both the redeeming user and the creating
        // admin: they must go first or the user deletes fail silently.
        await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
        await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
        await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { in: [qPriced, qUnpriced, qComprehensive, qCorrect, ids.createdQuestion].filter(Boolean) } } }).catch(() => {});
        await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.pointOs } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: ids.nodeOs } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: ids.family } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort; never masks the run result
    }
  }
