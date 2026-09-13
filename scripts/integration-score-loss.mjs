/**
 * S1-P1 Score Loss Evidence — end-to-end over real HTTP + real PostgreSQL.
 *
 * Drives the REAL paper submission path (POST /papers/:id/submit → ledger
 * assessment → automatic per-question loss derivation) and then reads the
 * projection back through the real API:
 *
 *   seed (bridge-shaped attribution, one direct tag, one unpriced question)
 *   → student submits a 5-question paper (objective wrong/correct, unpriced
 *     wrong, subjective partial credit, subjective full credit)
 *   → ScoreLossItem rows derived: OBSERVED vs PROXY, priced vs unpriced,
 *     attributed vs unattributed — exactly the formal design's classes
 *   → conservation holds within the paper's priced point envelope
 *   → GET /coach/score-loss returns the DERIVED projection (401 unauth,
 *     403 cross-student, teacher-with-authorization allowed)
 *   → GET /coach/score-anchor-summary reports anchor availability
 *   → resubmission is idempotent (unique key absorbs the second derivation)
 *   → the ledger's own rows are untouched by the derivation (append-only read
 *     model; zero prediction/outcome/correction writes)
 *
 * Attribution fixtures deliberately use the BRIDGE shape (production's 332-
 * question reality) with one direct-tag row as the对照 — the V12.1 lesson:
 * E2E on cleaner-than-production data shapes hides real resolution paths.
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
const jwtSecret = 'integration-score-loss-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Score-Loss-Integration-Password-1';

let qPriced; let qDirect; let qPartial; let qFull;
const ids = {
  admin: `loss-admin-${runId}`,
  teacher: `loss-teacher-${runId}`,
  studentB: null,
  nodeBridge: `loss-node-bridge-${runId}`,
  nodeBridge2: `loss-node-bridge2-${runId}`,
  nodeBridge3: `loss-node-bridge3-${runId}`,
  nodeDirect: `loss-node-direct-${runId}`,
  pointBridge: `loss-point-bridge-${runId}`,
  pointBridge2: `loss-point-bridge2-${runId}`,
  pointBridge3: `loss-point-bridge3-${runId}`,
  pointEmpty: `loss-point-empty-${runId}`,
  family: `loss-family-${runId}`,
  paper: `loss-paper-${runId}`,
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
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  // ---------------------------------------------------------------------
  // 1. Seed accounts, attribution graph, priced/unpriced questions, paper.
  // ---------------------------------------------------------------------
  for (const [id, role, name] of [
    [ids.admin, 'ADMIN', 'Score Loss Admin'],
    [ids.teacher, 'TEACHER', 'Score Loss Teacher'],
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: { passwordHash: await hashPassword(password), role, accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
      create: {
        id,
        email: `${id}@integration.test`,
        name,
        role,
        passwordHash: await hashPassword(password),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });
  }

  for (const nodeId of [ids.nodeBridge, ids.nodeBridge2, ids.nodeBridge3, ids.nodeDirect]) {
    await prisma.knowledgeNode.create({
      data: { id: nodeId, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: `节点 ${nodeId}`, importance: 3, difficulty: 3, syllabusVersion: 'test' },
    });
  }
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointBridge, subject: 'DATA_STRUCTURE', chapter: 'S1-loss', title: '失分归因考点',
      importance: 3, frequency: 3, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeBridge, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });

  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointEmpty, subject: 'DATA_STRUCTURE', chapter: 'S1-loss', title: '未定价失分考点',
      importance: 2, frequency: 2, prerequisites: [],
      // Deliberately NO node maps: the link exists (practice-record FK) but the
      // canonical resolver finds no node — the unpriced row must stay unattributed.
    },
  });
  for (const [pointId, nodeId] of [[ids.pointBridge2, ids.nodeBridge2], [ids.pointBridge3, ids.nodeBridge3]]) {
    await prisma.knowledgePoint.create({
      data: {
        id: pointId, subject: 'DATA_STRUCTURE', chapter: 'S1-loss', title: `失分归因考点 ${pointId}`,
        importance: 3, frequency: 3, prerequisites: [],
        nodeMaps: { create: { knowledgeNodeId: nodeId, mappingType: 'PRIMARY', confidence: 1 } },
      },
    });
  }
  await prisma.questionFamily.create({ data: { id: ids.family } });

  const question = (id, versionNumber, overrides = {}) => ({
    id,
    familyId: ids.family,
    versionNumber,
    contentFingerprint: `fp-${id}`,
    stem: `S1 loss fixture ${id}`,
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: '',
    difficulty: 'MEDIUM',
    type: 'SINGLE_CHOICE',
    source: 'integration',
    expectedTimeSec: 60,
    ...overrides,
  });

  const questions = [
    question(`q-obj-priced-${runId}`, 1, { answer: 'A', maxScore: 2 }),                       // lost, priced, bridge
    question(`q-obj-direct-${runId}`, 2, { answer: 'B', maxScore: 3 }),                       // lost, priced, DIRECT tag
    question(`q-obj-unpriced-${runId}`, 3, { answer: 'C', maxScore: null }),                  // lost, unpriced, unattributed
    question(`q-subj-partial-${runId}`, 4, { type: 'COMPREHENSIVE', answer: '', maxScore: 10, options: [] }), // PROXY partial
    question(`q-subj-full-${runId}`, 5, { type: 'COMPREHENSIVE', answer: '', maxScore: 10, options: [] }),    // PROXY full credit
  ];
  for (const row of questions) {
    await prisma.question.create({ data: row });
  }
  [qPriced, qDirect, , qPartial, qFull] = questions.map((row) => row.id);

  // Every question needs a KP link (practice-record FK). Bridge shape
  // (production reality): question → knowledge point → node map.
  await prisma.questionKnowledgePoint.create({ data: { questionId: `q-obj-unpriced-${runId}`, knowledgePointId: ids.pointEmpty } });
  await prisma.questionKnowledgePoint.create({ data: { questionId: qPartial, knowledgePointId: ids.pointBridge2 } });
  await prisma.questionKnowledgePoint.create({ data: { questionId: qFull, knowledgePointId: ids.pointBridge3 } });
  for (const questionId of [qPriced, qDirect]) {
    await prisma.questionKnowledgePoint.create({ data: { questionId, knowledgePointId: ids.pointBridge } });
  }
  // One direct tag as the resolver's fast-path对照.
  await prisma.questionKnowledgeNodeTag.create({
    data: { questionId: qDirect, knowledgeNodeId: ids.nodeDirect, role: 'PRIMARY', confidence: 1 },
  });
  // q-unpriced: deliberately NO attribution path at all.

  const paperQuestions = questions.map((row, index) => ({
    id: row.id,
    stem: row.stem,
    type: row.type === 'COMPREHENSIVE' ? '综合题' : '单选题',
    options: row.options,
    answer: index === 4 ? undefined : row.answer, // student papers must not expose answers wholesale
    analysis: '',
  }));
  await prisma.paper.create({
    data: {
      id: ids.paper,
      title: 'S1 失分派生集成卷',
      paperType: '模拟卷',
      questionCount: questions.length,
      knowledgePointIds: [ids.pointBridge],
      questions: paperQuestions,
      estimatedMinutes: 30,
      createdBy: ids.admin,
    },
  });

}

async function verifyAfterBoot() {
  const inviteA = await createInvitation(5);
  const studentAEmail = `loss-student-a-${runId}@integration.test`;
  const registeredA = await postJson(`${apiUrl}/auth/register`, {
    email: studentAEmail, password, name: '失分学生A', inviteCode: inviteA,
  });
  const studentA = registeredA?.user?.id ?? registeredA?.id;
  assert.ok(studentA, 'register must return the created student id');
  await prisma.user.update({ where: { id: studentA }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });

  const inviteB = await createInvitation(5);
  const registeredB = await postJson(`${apiUrl}/auth/register`, {
    email: `loss-student-b-${runId}@integration.test`, password, name: '失分学生B', inviteCode: inviteB,
  });
  const studentB = registeredB?.user?.id ?? registeredB?.id;
  await prisma.user.update({ where: { id: studentB }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  ids.studentB = studentB;
  await prisma.teacherStudentAuthorization.create({ data: { teacherId: ids.teacher, studentId: studentA } });

  const login = async (email) => (await postJson(`${apiUrl}/auth/login`, { email, password }))?.accessToken;
  const studentAToken = await login(studentAEmail);
  const studentBToken = await login(`loss-student-b-${runId}@integration.test`);
  const teacherToken = await login(`${ids.teacher}@integration.test`);
  const adminToken = await login(`${ids.admin}@integration.test`);
  assert.ok(studentAToken && studentBToken && teacherToken && adminToken, 'all logins must succeed');
  const studentAHeaders = { authorization: `Bearer ${studentAToken}` };
  const studentBHeaders = { authorization: `Bearer ${studentBToken}` };
  const teacherHeaders = { authorization: `Bearer ${teacherToken}` };
  const adminHeaders = { authorization: `Bearer ${adminToken}` };
  record('seed', `accounts + attribution graph + 5-question paper ready (A=${studentA})`);

  // ---------------------------------------------------------------------
  // 2. The REAL submission path: POST /papers/:id/submit.
  //    Expected accuracy: only q5 (self 0.9 ≥ 0.6) counts correct → 1/5 = 20%.
  // ---------------------------------------------------------------------
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qPriced, selectedAnswer: 'X', timeSpentSec: 10 },                    // wrong → lost 2 OBSERVED
      { questionId: qDirect, selectedAnswer: 'X', timeSpentSec: 10 },                    // wrong → lost 3 OBSERVED (direct tag)
      { questionId: `q-obj-unpriced-${runId}`, selectedAnswer: 'X', timeSpentSec: 10 },  // wrong → unpriced, no number
      { questionId: qPartial, selectedAnswer: '', timeSpentSec: 10, selfScore: 4, maxScore: 10 },  // PROXY lost 6
      { questionId: qFull, selectedAnswer: '', timeSpentSec: 10, selfScore: 9, maxScore: 10 },     // PROXY lost 1 (still "correct")
    ],
  }, studentAHeaders);
  assert.equal(submission.accuracyRate, 20, `expected 20% accuracy, got ${submission.accuracyRate}`);
  assert.equal(submission.syncedPracticeRecordCount, 5, 'all five answers synced as practice records');
  record('submit', 'paper submitted through the real endpoint (accuracy 20%)');

  // ---------------------------------------------------------------------
  // 3. Derived rows in the store: exact shapes, classes and attribution.
  // ---------------------------------------------------------------------
  const rows = await prisma.scoreLossItem.findMany({ where: { userId: studentA } });
  assert.equal(rows.length, 5, `expected 5 loss rows (full-credit-objective absent), got ${rows.length}`);

  const byQuestion = new Map(rows.map((row) => [row.questionId, row]));
  const priced = byQuestion.get(qPriced);
  assert.equal(priced.lossKind, 'OBSERVED');
  assert.equal(priced.maxScore, 2);
  assert.equal(priced.earnedScore, 0);
  assert.equal(priced.lostScore, 2);
  assert.equal(priced.nodeId, ids.nodeBridge, 'bridge-shaped attribution resolved through the canonical fallback');
  assert.equal(priced.gradingMethod, 'exact_match');

  const direct = byQuestion.get(qDirect);
  assert.equal(direct.lostScore, 3);
  assert.equal(direct.nodeId, ids.nodeDirect, 'direct-tag attribution uses the resolver fast path');

  const unpriced = byQuestion.get(`q-obj-unpriced-${runId}`);
  assert.equal(unpriced.maxScore, null);
  assert.equal(unpriced.lostScore, null, 'unpriced: counted, never zeroed (INV-10)');
  assert.equal(unpriced.nodeId, null);

  const partial = byQuestion.get(qPartial);
  assert.equal(partial.lossKind, 'PROXY');
  assert.equal(partial.gradingMethod, 'self_report');
  assert.equal(partial.earnedScore, 4);
  assert.equal(partial.lostScore, 6);

  const full = byQuestion.get(qFull);
  assert.equal(full.lossKind, 'PROXY');
  assert.equal(full.lostScore, 1, 'self-reported 9/10 still lost 1 point even though it graded "correct"');

  const assessmentRow = await prisma.scoreAssessment.findFirst({ where: { userId: studentA, originId: `paper:${ids.paper}` } });
  assert.ok(assessmentRow, 'the ledger assessment row exists');
  assert.ok(rows.every((row) => row.scoreEntryId === assessmentRow.id && row.scoreEntryKind === 'assessment'), 'every loss row anchors to the ledger entry');
  record('derive', '5 loss rows derived: OBSERVED 2+3 / PROXY 6+1 / unpriced counted with null loss');

  // Conservation within the priced envelope (2+3+10+10 = 25 ≥ 12).
  const lossTotal = rows.reduce((sum, row) => sum + (row.lostScore ?? 0), 0);
  assert.ok(lossTotal <= 25, `conservation: ${lossTotal} ≤ 25`);

  // The derivation never writes the ledger itself.
  const [predictionCount, outcomeCount, correctionCount] = await Promise.all([
    prisma.scorePrediction.count({ where: { userId: studentA } }),
    prisma.scoreOutcome.count({ where: { userId: studentA } }),
    prisma.scoreCorrection.count({ where: { userId: studentA } }),
  ]);
  assert.equal(predictionCount + outcomeCount + correctionCount, 0, 'the loss derivation writes zero ledger rows');
  assert.equal(assessmentRow.rawScore, 20, 'the historical assessment row is untouched by derivation');
  record('conservation', `Σ loss ${lossTotal} ≤ priced envelope 25; ledger untouched (prediction/outcome/correction = 0)`);

  // ---------------------------------------------------------------------
  // 4. The read projection through the real API.
  // ---------------------------------------------------------------------
  const projection = await getJson(`${apiUrl}/coach/score-loss`, studentAHeaders);
  assert.equal(projection.storeAvailable, true);
  assert.equal(projection.kind, 'DERIVED');
  assert.equal(projection.entries.length, 1);
  const entry = projection.entries[0];
  assert.equal(entry.observedLoss, 5);
  assert.equal(entry.proxyLoss, 7, 'OBSERVED and PROXY stay separate (IL-6)');
  assert.equal(entry.lostQuestions, 5);
  assert.equal(entry.pricedLostQuestions, 4);
  assert.equal(entry.unpricedLostQuestions, 1);
  assert.deepEqual(entry.nodeAttributedLoss, {
    [ids.nodeBridge]: 2,
    [ids.nodeDirect]: 3,
    [ids.nodeBridge2]: 6,
    [ids.nodeBridge3]: 1,
  });
  assert.equal(entry.coverageGap.unpricedLostQuestions, 1, 'the coverage gap is reported, never scaled away');
  assert.equal(projection.totals.observedLoss, 5);
  assert.equal(projection.totals.proxyLoss, 7);
  record('projection', 'GET /coach/score-loss: observed 5 / proxy 7 / coverage gap 1 — classes never merged');

  // Rejection paths: unauthenticated, cross-student; authorized teacher allowed.
  const unauth = await fetch(`${apiUrl}/coach/score-loss`);
  assert.equal(unauth.status, 401, 'unauthenticated score-loss read must be 401');
  const cross = await fetch(`${apiUrl}/coach/score-loss?userId=${studentA}`, { headers: studentBHeaders });
  assert.equal(cross.status, 403, 'student B must not read student A’s loss (isolation)');
  const teacherView = await getJson(`${apiUrl}/coach/score-loss?userId=${studentA}`, teacherHeaders);
  assert.equal(teacherView.userId, studentA, 'an authorized teacher reads the student’s loss');
  const adminView = await getJson(`${apiUrl}/coach/score-loss?userId=${studentA}`, adminHeaders);
  assert.equal(adminView.userId, studentA, 'admin reads any student’s loss');
  record('guards', '401 unauth / 403 cross-student / authorized teacher + admin allowed');

  // ---------------------------------------------------------------------
  // 5. The anchor summary (API-2): availability + the canonical timeline.
  // ---------------------------------------------------------------------
  const summary = await getJson(`${apiUrl}/coach/score-anchor-summary`, studentAHeaders);
  assert.equal(summary.storeAvailable, true);
  assert.equal(summary.kind, 'DERIVED');
  assert.ok(summary.anchors.assessment, 'the paper assessment is visible as an anchor');
  assert.equal(summary.anchors.prediction?.kind, undefined, 'no prediction exists — the slot stays null, not fabricated');
  assert.equal(summary.scoreLoss.itemsAvailable, true);
  assert.ok(['exam_date', 'legacy_remaining_days', 'unknown'].includes(summary.examTimeline.basis), 'timeline basis comes from the canonical resolver');
  record('summary', 'GET /coach/score-anchor-summary: assessment anchor present, loss available, timeline basis labelled');

  // ---------------------------------------------------------------------
  // 6. Idempotency: resubmitting the paper must not double-derive.
  // ---------------------------------------------------------------------
  await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qPriced, selectedAnswer: 'X', timeSpentSec: 10 },
      { questionId: qDirect, selectedAnswer: 'X', timeSpentSec: 10 },
      { questionId: `q-obj-unpriced-${runId}`, selectedAnswer: 'X', timeSpentSec: 10 },
      { questionId: qPartial, selectedAnswer: '', timeSpentSec: 10, selfScore: 4, maxScore: 10 },
      { questionId: qFull, selectedAnswer: '', timeSpentSec: 10, selfScore: 9, maxScore: 10 },
    ],
  }, studentAHeaders);
  const rowsAfterResubmit = await prisma.scoreLossItem.count({ where: { userId: studentA } });
  assert.equal(rowsAfterResubmit, 5, `the unique key absorbs the second derivation, got ${rowsAfterResubmit}`);
  record('idempotency', 'resubmission derived nothing new (5 rows stable)');

  // ---------------------------------------------------------------------
  // 7. Historical preservation: the ledger row is byte-identical in its
  //    semantic fields, and no correction rows appeared.
  // ---------------------------------------------------------------------
  const assessmentAfter = await prisma.scoreAssessment.findFirst({ where: { userId: studentA, originId: `paper:${ids.paper}` } });
  assert.equal(assessmentAfter.id, assessmentRow.id);
  assert.equal(assessmentAfter.rawScore, 20);
  assert.equal(assessmentAfter.rawTotalScale, 100);
  assert.equal(assessmentAfter.semantic, 'accuracy_rate');
  assert.equal(await prisma.scoreCorrection.count({ where: { userId: studentA } }), 0);
  record('preservation', 'ledger row semantically identical after derivation + resubmission');
}

// ---------------------------------------------------------------------------
// Harness (mirrors integration-score-anchor.mjs)
// ---------------------------------------------------------------------------

async function createInvitation(maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 's1 score loss integration',
      maxUses,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  return code;
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
    if (child.exitCode != null) {
      throw new Error(`API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy in time: ${child.getOutput?.().slice(-2000) ?? ''}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
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

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    // Content fixtures MUST exist before boot: the service hydrates its paper
    // catalog in OnModuleInit, so a paper seeded after boot is invisible to
    // the submission path.
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    console.log(`\nS1 Score Loss integration PASSED (${steps.length} steps)`);
    process.exit(0);
  } catch (error) {
    console.error('\nS1 Score Loss integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-12000));
    }
    process.exit(1);
  } finally {
    try {
      if (prisma && !process.env.KEEP_FIXTURES) {
        // Cleanup: user deletion cascades loss rows, authorizations and
        // invitations; content fixtures are deleted explicitly.
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher, ids.studentB].filter(Boolean) } } }).catch(() => {});
        await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { startsWith: 'q-loss-' } } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: { in: [ids.pointBridge, ids.pointBridge2, ids.pointBridge3, ids.pointEmpty] } } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.nodeBridge, ids.nodeBridge2, ids.nodeBridge3, ids.nodeDirect] } } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: ids.family } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort; never masks the run result
    }
  }
})();
