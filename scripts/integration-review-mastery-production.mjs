/**
 * V12-M3 — Review → Mastery PRODUCTION integration E2E.
 *
 * Real PostgreSQL + real HTTP. Every review goes through
 * `POST /wrong-questions/:questionId/reason`, so production itself writes the
 * attempt, its V12-M3-B metadata, the V12-M3-A occurrence-keyed evidence receipt,
 * the exactly-once claim and the authoritative mastery update.
 *
 * Cases
 *   A  review correct              — authoritative mastery must move up
 *   B  review incorrect            — authoritative mastery must move down
 *   C  repeated review             — three observations, three receipts, three steps
 *   D  duplicate HTTP request      — one attempt, one receipt, applied exactly once
 *   E  two students, same node     — both move, independently, no leakage
 *   F  different nodes, same student — only the reviewed node moves
 *
 * Also verified:
 *   • full downstream before/after (mastery → priority → opportunity → rank);
 *   • the transition is the LEGACY production model (C1 stays OFF);
 *   • pre-migration rows (NULL metadata, day-scoped evidence) stay readable and
 *     their mastery is never rewritten;
 *   • the migration is additive/nullable, so rollback is a column drop.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');
const {
  updateMasteryAfterAttempt,
  buildLearningEvidence,
  learningEvidenceKey,
} = require('../packages/shared/dist/index.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3250';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-review-mastery-prod-secret-0123456789';
const adminPassword = 'Review-Mastery-Prod-Admin-1';
const studentPassword = 'Review-Mastery-Prod-Student-1';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const CONTEXT_NODES = 2;

let activeApi = null;
let adminHeaders = null;
/** Production log lines, so the projection verdict can be observed. */
let apiOutput = '';
const transcript = {};

const LOGIN_WINDOW = { limit: 9, used: 0 };

async function login(email, password) {
  if (LOGIN_WINDOW.used >= LOGIN_WINDOW.limit) {
    console.log('[m3-prod] waiting out the login throttle window (10/60s is a production guard)');
    await delay(62_000);
    LOGIN_WINDOW.used = 0;
  }
  LOGIN_WINDOW.used += 1;
  const payload = await postJson(`${apiUrl}/auth/login`, { email, password });
  const token = payload?.accessToken ?? payload?.token;
  assert.ok(token, `${email} must be able to log in`);
  return token;
}

async function main() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const cohort = { students: [], sharedNodeId: null, adminId: null };
  try {
    await assertMigrationShape(prisma);

    // -------------------------------------------------------------------
    // Seed
    // -------------------------------------------------------------------
    const adminId = `m3p-admin-${runId}`;
    cohort.adminId = adminId;
    await prisma.user.create({
      data: {
        id: adminId,
        email: emailOf(adminId),
        name: 'M3 Prod Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(adminPassword),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });

    // A node shared by two students (case E). Created once, on purpose.
    const sharedNodeId = `m3p-node-shared-${runId}`;
    cohort.sharedNodeId = sharedNodeId;
    await createNode(prisma, sharedNodeId, 3);

    const plan = [
      { key: 'A', label: 'review correct', mastery: 0.6, difficulty: 3, nodes: [{ role: 'reviewed', reviews: [{ correct: true }] }] },
      { key: 'B', label: 'review incorrect', mastery: 0.6, difficulty: 3, nodes: [{ role: 'reviewed', reviews: [{ correct: false }] }] },
      {
        key: 'C',
        label: 'repeated review (correct / incorrect / correct)',
        mastery: 0.4,
        difficulty: 3,
        nodes: [{ role: 'reviewed', reviews: [{ correct: true }, { correct: false }, { correct: true }] }],
      },
      { key: 'D', label: 'duplicate HTTP request', mastery: 0.5, difficulty: 3, nodes: [{ role: 'reviewed', reviews: [{ correct: true }], idempotent: true }] },
      { key: 'E1', label: 'two students, same node (correct)', mastery: 0.5, difficulty: 3, shared: true, nodes: [{ role: 'reviewed', reviews: [{ correct: true }] }] },
      { key: 'E2', label: 'two students, same node (incorrect)', mastery: 0.5, difficulty: 3, shared: true, nodes: [{ role: 'reviewed', reviews: [{ correct: false }] }] },
      {
        key: 'F',
        label: 'two nodes, one student',
        mastery: 0.5,
        difficulty: 3,
        nodes: [
          { role: 'reviewed', reviews: [{ correct: true }] },
          { role: 'reviewed2', reviews: [{ correct: false }] },
        ],
      },
    ];

    for (const spec of plan) {
      cohort.students.push(await seedStudent(prisma, spec, sharedNodeId));
    }

    // Pre-migration data: an attempt with NULL metadata and a legacy day-scoped
    // receipt. Nothing may rewrite it or crash on it.
    const legacy = await seedLegacyRows(prisma, cohort.students[0]);
    cohort.legacy = legacy;

    activeApi = startApi();
    await waitForHealth(activeApi);

    const adminToken = await login(emailOf(adminId), adminPassword);
    adminHeaders = { authorization: `Bearer ${adminToken}` };

    console.log('');
    console.log('[m3-prod] === Cases A–F: review → mastery on the authoritative path ===');
    const results = [];
    for (const student of cohort.students) {
      results.push(await runStudent(prisma, student));
    }

    // -------------------------------------------------------------------
    // Case D — duplicate HTTP request
    // -------------------------------------------------------------------
    const duplicate = await runDuplicateCase(prisma, cohort.students.find((s) => s.key === 'D'));
    results.push(duplicate);

    // -------------------------------------------------------------------
    // Evidence ledger fidelity (M3-A)
    // -------------------------------------------------------------------
    const fidelity = await evidenceFidelity(prisma, cohort.students, legacy);
    reportFidelity(fidelity);

    // -------------------------------------------------------------------
    // Isolation (case E) and independence (case F)
    // -------------------------------------------------------------------
    reportIsolation(results, cohort);

    // -------------------------------------------------------------------
    // Legacy rows: readable, untouched
    // -------------------------------------------------------------------
    await assertLegacyUntouched(prisma, legacy);

    // -------------------------------------------------------------------
    // C1 stays OFF
    // -------------------------------------------------------------------
    assert.equal(process.env.MASTERY_SEMANTICS, undefined, 'the switch must not be set for this run');
    assert.ok(!/MASTERY_SEMANTICS/.test(apiOutput), 'the API env must not have enabled the candidate');
    assert.match(apiOutput, /Mastery semantics: legacy/, 'startup must report the legacy semantics');
    for (const row of fidelity.markers) {
      assert.equal(row.payload.semantics, 'legacy', 'every application must record the legacy semantics');
    }
    console.log('');
    console.log('[m3-prod] C1 = OFF (startup reported legacy; every marker recorded semantics=legacy)');

    console.log('');
    console.log('[m3-prod] PASS — Review → Mastery is live on the authoritative path');
  } catch (error) {
    transcript.error = error.message;
    throw error;
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    await cleanup(prisma, cohort).catch(() => {});
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// One student: pre-read → review(s) → post-read, incl. full downstream
// ---------------------------------------------------------------------------

async function runStudent(prisma, student) {
  const token = await login(emailOf(student.userId), studentPassword);
  const headers = { authorization: `Bearer ${token}` };

  const before = await readState(prisma, student);
  const expected = [];

  for (const target of student.reviewTargets) {
    for (const review of target.reviews) {
      await postJson(
        `${apiUrl}/wrong-questions/${target.questionId}/reason`,
        {
          selfReportedReason: 'm3 production integration',
          redoCorrect: review.correct,
          timeSpentSec: 45,
          isReview: true,
          ...(target.idempotent ? { idempotencyKey: `m3p-${student.key}-${runId}` } : {}),
        },
        headers,
      );
    }
    expected.push({ nodeId: target.nodeId, reviews: target.reviews });
  }

  const after = await readState(prisma, student);
  const caseRow = verifyCase(student, before, after, expected);
  transcript[student.key] = caseRow;
  reportCase(caseRow);
  return { student, before, after, caseRow, headers };
}

/** The full chain, before and after: mastery → priority → opportunity → rank. */
async function readState(prisma, student) {
  const masteryRows = await prisma.userKnowledgeMastery.findMany({
    where: { userId: student.userId },
    select: { knowledgeNodeId: true, mastery: true, attempts: true, version: true },
  });
  const chain = await getJson(
    `${apiUrl}/coach/shadow-decision-chain?userId=${student.userId}&windowDays=365`,
    adminHeaders,
  );
  const byNode = new Map((chain.rows ?? []).map((row) => [row.knowledgeNodeId, row]));
  return {
    mastery: new Map(masteryRows.map((row) => [row.knowledgeNodeId, row.mastery])),
    attempts: new Map(masteryRows.map((row) => [row.knowledgeNodeId, row.attempts])),
    // The OCC version is the evidence that a duplicate did not write at all.
    version: new Map(masteryRows.map((row) => [row.knowledgeNodeId, row.version])),
    downstream: byNode,
  };
}

function verifyCase(student, before, after, expected) {
  const row = {
    key: student.key,
    label: student.label,
    nodes: [],
    idempotency: null,
  };
  for (const target of expected) {
    const startMastery = before.mastery.get(target.nodeId);
    const endMastery = after.mastery.get(target.nodeId);
    assert.equal(typeof startMastery, 'number', `${student.key}: the seeded mastery must exist`);

    // The expected value is computed from the SHARED production model, with the
    // C1 guard OFF — one assertion that both "review integration works" and
    // "C1 remains disabled".
    let model = {
      mastery: startMastery,
      accuracy: 0,
      recentAccuracy: 0,
      attempts: 0,
      correctCount: 0,
      wrongCount: 0,
      confidence: 0,
    };
    for (const review of target.reviews) {
      model = updateMasteryAfterAttempt(model, {
        isCorrect: review.correct,
        difficulty: student.difficulty,
        role: 'PRIMARY',
      });
    }
    const expectedMastery = Math.round(model.mastery * 1e6) / 1e6;
    const actualMastery = Math.round(endMastery * 1e6) / 1e6;
    assert.equal(
      actualMastery,
      expectedMastery,
      `${student.key}/${target.nodeId}: authoritative mastery must equal the legacy production model`,
    );
    assert.ok(
      Math.abs(endMastery - startMastery) > 1e-9,
      `${student.key}/${target.nodeId}: a review MUST now move authoritative mastery (the M3 gap)`,
    );

    const beforeChain = before.downstream.get(target.nodeId) ?? null;
    const afterChain = after.downstream.get(target.nodeId) ?? null;
    assert.ok(afterChain, `${student.key}: the node must appear in the downstream chain`);
    // The chain publishes mastery at 4 dp by design, so the comparison is made at
    // that precision rather than pretending the endpoint reports full floats.
    assert.equal(
      round4(afterChain.observedMastery),
      round4(actualMastery),
      `${student.key}: the downstream read path must consume the new authoritative mastery`,
    );

    row.nodes.push({
      nodeId: target.nodeId,
      reviews: target.reviews.length,
      masteryBefore: startMastery,
      masteryAfter: endMastery,
      masteryDelta: round4(endMastery - startMastery),
      masteryDirection: endMastery > startMastery ? 'up' : 'down',
      priorityBefore: beforeChain?.observedPriority ?? null,
      priorityAfter: afterChain.observedPriority,
      priorityDelta: subtract(afterChain.observedPriority, beforeChain?.observedPriority),
      opportunityBefore: beforeChain?.observedOpportunity ?? null,
      opportunityAfter: afterChain.observedOpportunity,
      opportunityDelta: subtract(afterChain.observedOpportunity, beforeChain?.observedOpportunity),
      rankBefore: beforeChain?.observedRank ?? null,
      rankAfter: afterChain.observedRank,
      rankDelta: subtract(afterChain.observedRank, beforeChain?.observedRank),
    });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Case D — the same HTTP request twice
// ---------------------------------------------------------------------------

async function runDuplicateCase(prisma, student) {
  assert.ok(student, 'case D student must exist');
  const token = await login(emailOf(student.userId), studentPassword);
  const headers = { authorization: `Bearer ${token}` };
  const target = student.reviewTargets[0];
  // The SAME key the original review used, so these are genuinely duplicate
  // deliveries of one review event — across separate HTTP requests, which is
  // exactly what a client retry looks like.
  const idempotencyKey = `m3p-${student.key}-${runId}`;
  const body = {
    selfReportedReason: 'm3 duplicate request',
    redoCorrect: true,
    timeSpentSec: 45,
    isReview: true,
    idempotencyKey,
  };

  const before = await readState(prisma, student);
  const first = await postJson(`${apiUrl}/wrong-questions/${target.questionId}/reason`, body, headers);
  const second = await postJson(`${apiUrl}/wrong-questions/${target.questionId}/reason`, body, headers);
  const after = await readState(prisma, student);

  const attempts = await prisma.reviewAttempt.findMany({
    where: { schedule: { userId: student.userId }, idempotencyKey },
    select: { id: true },
  });
  assert.equal(attempts.length, 1, 'a duplicate request must not create a second attempt');
  const attemptId = attempts[0].id;

  const receipts = (await evidenceRows(prisma, student.userId))
    .filter((row) => row.payload.occurrence === attemptId);
  assert.equal(receipts.length, 1, 'a duplicate request must produce exactly one evidence event');

  const markers = (await markerRows(prisma, student.userId))
    .filter((row) => row.payload.evidenceEventKey === receipts[0].eventKey);
  assert.equal(markers.length, 1, 'a duplicate request must be projected exactly once');

  const startMastery = before.mastery.get(target.nodeId);
  const endMastery = after.mastery.get(target.nodeId);
  const startVersion = before.version.get(target.nodeId);
  const endVersion = after.version.get(target.nodeId);
  assert.equal(
    round6(endMastery),
    round6(startMastery),
    'a duplicate request must not move mastery a second time',
  );
  assert.equal(endVersion, startVersion, 'a duplicate request must not bump the mastery version');

  const row = {
    key: 'D',
    label: 'duplicate delivery of the same review event (mastery must NOT move again)',
    nodes: [{
      nodeId: target.nodeId,
      reviews: 1,
      masteryBefore: startMastery,
      masteryAfter: endMastery,
      masteryDelta: round4(endMastery - startMastery),
      masteryDirection: 'unchanged',
      priorityBefore: before.downstream.get(target.nodeId)?.observedPriority ?? null,
      priorityAfter: after.downstream.get(target.nodeId)?.observedPriority ?? null,
      priorityDelta: subtract(after.downstream.get(target.nodeId)?.observedPriority, before.downstream.get(target.nodeId)?.observedPriority),
      opportunityBefore: before.downstream.get(target.nodeId)?.observedOpportunity ?? null,
      opportunityAfter: after.downstream.get(target.nodeId)?.observedOpportunity ?? null,
      opportunityDelta: subtract(after.downstream.get(target.nodeId)?.observedOpportunity, before.downstream.get(target.nodeId)?.observedOpportunity),
      rankBefore: before.downstream.get(target.nodeId)?.observedRank ?? null,
      rankAfter: after.downstream.get(target.nodeId)?.observedRank ?? null,
      rankDelta: subtract(after.downstream.get(target.nodeId)?.observedRank, before.downstream.get(target.nodeId)?.observedRank),
    }],
    idempotency: {
      attempts: attempts.length,
      receipts: receipts.length,
      markers: markers.length,
      masteryVersionBefore: startVersion,
      masteryVersionAfter: endVersion,
    },
  };
  transcript.D = row;
  reportCase(row);
  console.log(
    `  idempotency: attempts=${row.idempotency.attempts} receipts=${row.idempotency.receipts} `
    + `markers=${row.idempotency.markers} masteryVersion ${startVersion}→${endVersion} (unchanged)`,
  );
  void first;
  void second;
  return { student, row };
}

// ---------------------------------------------------------------------------
// Evidence fidelity (M3-A)
// ---------------------------------------------------------------------------

async function evidenceFidelity(prisma, students, legacy) {
  const attempts = await prisma.reviewAttempt.findMany({
    where: { schedule: { userId: { in: students.map((s) => s.userId) } } },
    select: {
      id: true, redoCorrect: true, reviewedAt: true, scheduleId: true,
      isReview: true, scheduleDriven: true, source: true, dueAt: true, idempotencyKey: true,
      schedule: { select: { userId: true } },
    },
    orderBy: { reviewedAt: 'asc' },
  });
  const receipts = [];
  const markers = [];
  for (const student of students) {
    receipts.push(...await evidenceRows(prisma, student.userId));
    markers.push(...await markerRows(prisma, student.userId));
  }

  const recallReceipts = receipts.filter((row) => row.payload.action === 'review.recalled');
  const occurrenceReceipts = recallReceipts.filter((row) => typeof row.payload.occurrence === 'string' && row.payload.occurrence);
  const legacyReceipts = recallReceipts.filter((row) => row.payload.occurrence == null);

  // The seeded pre-migration attempt is history: it legitimately has no
  // occurrence identity and NULL metadata, and must be judged separately rather
  // than being allowed to weaken the requirement for new rows.
  const legacyAttempts = attempts.filter((row) => row.id === legacy.attemptId);
  const newAttempts = attempts.filter((row) => row.id !== legacy.attemptId);
  assert.equal(legacyAttempts.length, 1, 'positive control: the pre-migration attempt is in this cohort');
  assert.equal(legacyAttempts[0].isReview, null, 'the pre-migration attempt must keep NULL metadata');

  const mismatches = [];
  for (const attempt of newAttempts) {
    const own = recallReceipts.filter((row) => row.payload.occurrence === attempt.id);
    if (own.length !== 1) mismatches.push({ attemptId: attempt.id, receipts: own.length });
  }
  // No new row may be missing its occurrence identity, and no legacy receipt may
  // be silently re-keyed.
  const missingOccurrence = newAttempts.filter(
    (attempt) => !recallReceipts.some((row) => row.payload.occurrence === attempt.id),
  );

  // Metadata completeness for NEW rows only.
  const metadataMissing = newAttempts.filter(
    (row) => row.isReview !== true || typeof row.source !== 'string' || typeof row.scheduleDriven !== 'boolean',
  );

  assert.equal(mismatches.length, 0, `every new attempt needs exactly one occurrence-keyed receipt: ${JSON.stringify(mismatches.slice(0, 3))}`);
  assert.equal(missingOccurrence.length, 0, 'no new review may lack a per-occurrence evidence identity');
  assert.equal(metadataMissing.length, 0, 'every new attempt must carry the M3-B facts');
  assert.equal(
    occurrenceReceipts.length,
    recallReceipts.length - legacyReceipts.length,
    'every non-legacy recall receipt must be occurrence-scoped',
  );
  assert.equal(legacyReceipts.length, legacy.count, 'only the deliberately seeded pre-migration row lacks an occurrence');
  assert.equal(
    newAttempts.length,
    occurrenceReceipts.length,
    'M3-A: the count of new review attempts must EQUAL the count of occurrence-keyed receipts (this was 31 → 15 before the fix)',
  );

  // Exactly one application marker per receipt.
  const markerKeys = markers.map((row) => row.eventKey);
  assert.equal(new Set(markerKeys).size, markerKeys.length, 'no marker may be written twice');
  for (const receipt of recallReceipts) {
    const own = markers.filter((row) => row.payload.evidenceEventKey === receipt.eventKey);
    if (receipt.payload.occurrence == null) {
      assert.equal(own.length, 0, 'a pre-migration receipt must not be retro-applied to mastery');
      continue;
    }
    assert.equal(own.length, 1, `receipt ${receipt.eventKey} must be applied exactly once`);
  }

  return { attempts, newAttempts, receipts, recallReceipts, occurrenceReceipts, legacyReceipts, markers };
}

function reportFidelity(fidelity) {
  console.log('');
  console.log('[m3-prod] M3-A evidence fidelity');
  console.log(`  review attempts (new) ......... ${fidelity.newAttempts.length}`);
  console.log(`  review attempts (pre-migration)  ${fidelity.attempts.length - fidelity.newAttempts.length}`);
  console.log(`  review.recalled receipts ...... ${fidelity.recallReceipts.length}`);
  console.log(`  ...occurrence-scoped (new) .... ${fidelity.occurrenceReceipts.length}`);
  console.log(`  ...day-scoped (pre-migration).. ${fidelity.legacyReceipts.length}`);
  console.log(`  mastery application markers ... ${fidelity.markers.length}`);
  console.log(`  attempt → receipt mapping ..... ${fidelity.newAttempts.length}:${fidelity.occurrenceReceipts.length} (1:1, was 31 attempts → 15 receipts)`);
  const scheduled = fidelity.newAttempts.filter((row) => row.scheduleDriven === true).length;
  console.log(`  scheduleDriven=true ........... ${scheduled}/${fidelity.newAttempts.length} (none was answering a due schedule)`);
  const withDue = fidelity.newAttempts.filter((row) => row.dueAt != null).length;
  console.log(`  attempts with a recorded dueAt  ${withDue}/${fidelity.newAttempts.length}`);
  const sources = [...new Set(fidelity.newAttempts.map((row) => row.source))];
  console.log(`  recorded sources .............. ${sources.join(', ')}`);
  const withKey = fidelity.newAttempts.filter((row) => row.idempotencyKey != null).length;
  console.log(`  attempts carrying an idem key . ${withKey}/${fidelity.newAttempts.length}`);
}

function reportIsolation(results, cohort) {
  const e1 = results.find((r) => r.student?.key === 'E1');
  const e2 = results.find((r) => r.student?.key === 'E2');
  assert.ok(e1 && e2, 'case E must have both students');
  assert.equal(cohort.students.find((s) => s.key === 'E1').reviewTargets[0].nodeId,
    cohort.students.find((s) => s.key === 'E2').reviewTargets[0].nodeId,
    'case E must genuinely share one node');
  const d1 = e1.caseRow.nodes[0].masteryDelta;
  const d2 = e2.caseRow.nodes[0].masteryDelta;
  assert.ok(d1 > 0 && d2 < 0, 'the shared node must move in each student\'s own direction');

  const f = results.find((r) => r.student?.key === 'F');
  assert.ok(f && f.caseRow.nodes.length === 2, 'case F must have two reviewed nodes');
  const [n0, n1] = f.caseRow.nodes;
  assert.ok(n0.masteryDelta > 0 && n1.masteryDelta < 0, 'each node must move by its own observation');

  console.log('');
  console.log('[m3-prod] isolation');
  console.log(`  E  same node, two students .... E1 ${fmtSigned(d1)} / E2 ${fmtSigned(d2)} (independent, opposite directions)`);
  console.log(`  F  two nodes, one student ..... ${fmtSigned(n0.masteryDelta)} / ${fmtSigned(n1.masteryDelta)}`);
}

// ---------------------------------------------------------------------------
// Pre-migration compatibility
// ---------------------------------------------------------------------------

/**
 * Pre-migration history: a review attempt with NULL metadata and a legacy
 * day-scoped receipt, on a node that receives NO new review.
 *
 * The dedicated node is the point: if this node's mastery moves, something
 * retro-applied historical evidence. Putting the legacy rows on a node that a
 * new review legitimately touches would prove nothing.
 */
async function seedLegacyRows(prisma, student) {
  const nodeId = `m3p-node-legacy-${runId}`;
  const questionId = `m3p-question-legacy-${runId}`;
  const familyId = `m3p-family-legacy-${runId}`;
  const reviewedAt = new Date(Date.now() - 3 * DAY);
  const masteryAtSeed = 0.7;

  await createNode(prisma, nodeId, 3);
  await prisma.questionFamily.create({ data: { id: familyId } });
  await prisma.question.create({
    data: {
      id: questionId,
      familyId,
      contentFingerprint: `m3p-legacy-${runId}`,
      stem: 'm3p legacy question',
      options: ['A', 'B'],
      answer: 'A',
      analysis: 'seed',
      difficulty: 'MEDIUM',
      type: 'SINGLE_CHOICE',
      source: 'integration',
    },
  });
  await prisma.questionKnowledgeNodeTag.create({
    data: { questionId, knowledgeNodeId: nodeId, role: 'PRIMARY' },
  });
  const correctCount = Math.round(4 * masteryAtSeed);
  await prisma.userKnowledgeMastery.create({
    data: {
      userId: student.userId,
      knowledgeNodeId: nodeId,
      mastery: masteryAtSeed,
      accuracy: masteryAtSeed,
      recentAccuracy: masteryAtSeed,
      attempts: 4,
      correctCount,
      wrongCount: 4 - correctCount,
      confidence: 0.3,
      retention: 1,
      stabilityDays: 1.7,
      lastReviewedAt: reviewedAt,
    },
  });
  await prisma.userMasterySnapshot.create({
    data: {
      userId: student.userId,
      knowledgeNodeId: nodeId,
      mastery: masteryAtSeed,
      attempts: 4,
      correctCount,
      wrongCount: 4 - correctCount,
      snapshotDate: new Date(reviewedAt.getTime() - 10 * DAY),
    },
  });

  const scheduleId = `m3p-legacy-schedule-${runId}`;
  await prisma.reviewSchedule.create({
    data: {
      id: scheduleId,
      userId: student.userId,
      questionId,
      consecutiveCorrect: 0,
      stability: 'learning',
      nextReviewAt: new Date(reviewedAt.getTime() + DAY),
      reviewCount: 1,
      lastReviewedAt: reviewedAt,
    },
  });
  const attempt = await prisma.reviewAttempt.create({
    data: {
      scheduleId,
      redoCorrect: true,
      timeSpentSec: 30,
      nextIntervalDays: 1,
      reviewedAt,
      // Deliberately NULL: this is what every row written before the migration
      // looks like. It must be readable and must never be back-filled.
    },
  });

  // A legacy day-scoped receipt, built with the same pure function the old code
  // used, so the shape is exactly what history contains.
  const record = buildLearningEvidence({
    userId: student.userId,
    action: 'review.recalled',
    sourceId: questionId,
    recordedAt: reviewedAt.toISOString(),
    scope: reviewedAt.toISOString().slice(0, 10),
    recallObserved: true,
    recallCorrect: true,
  });
  const eventKey = learningEvidenceKey({
    userId: student.userId,
    action: 'review.recalled',
    sourceId: questionId,
    scope: reviewedAt.toISOString().slice(0, 10),
  });
  await prisma.userEvent.create({
    data: {
      userId: student.userId,
      type: 'EVIDENCE_RECORDED',
      eventKey,
      payload: { ...record, id: eventKey },
    },
  });

  return {
    attemptId: attempt.id,
    eventKey,
    nodeId,
    questionId,
    familyId,
    masteryAtSeed,
    count: 1,
    userId: student.userId,
  };
}

async function assertLegacyUntouched(prisma, legacy) {
  const attempt = await prisma.reviewAttempt.findUnique({
    where: { id: legacy.attemptId },
    select: { isReview: true, scheduleDriven: true, source: true, dueAt: true },
  });
  assert.deepEqual(
    attempt,
    { isReview: null, scheduleDriven: null, source: null, dueAt: null },
    'pre-migration rows must keep NULL metadata — no back-fill, no invented facts',
  );

  const event = await prisma.userEvent.findUnique({
    where: { userId_eventKey: { userId: legacy.userId, eventKey: legacy.eventKey } },
  });
  assert.ok(event, 'the pre-migration receipt must still be readable');
  assert.equal(event.payload.occurrence ?? null, null, 'no occurrence may be fabricated for history');

  // The decisive check: a node whose ONLY review observation is historical must
  // keep its mastery. If it moved, history was retro-applied.
  const mastery = await prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgeNodeId: { userId: legacy.userId, knowledgeNodeId: legacy.nodeId } },
    select: { mastery: true, version: true },
  });
  assert.equal(mastery.mastery, legacy.masteryAtSeed, 'historical mastery must not be rewritten by the new path');

  const markers = (await markerRows(prisma, legacy.userId))
    .filter((row) => row.payload.evidenceEventKey === legacy.eventKey);
  assert.equal(markers.length, 0, 'a pre-migration receipt must not be retro-projected into mastery');

  console.log('');
  console.log('[m3-prod] pre-migration compatibility');
  console.log('  legacy attempt metadata ....... all NULL (unknown, not back-filled)');
  console.log('  legacy day-scoped receipt ..... readable, occurrence NULL, never retro-applied');
  console.log(`  historical mastery ............ unchanged (${legacy.masteryAtSeed}, version ${mastery.version})`);
}

async function assertMigrationShape(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'ReviewAttempt'
      AND column_name IN ('isReview', 'scheduleDriven', 'source', 'dueAt')
    ORDER BY column_name
  `;
  assert.equal(rows.length, 4, 'all four V12-M3-B columns must exist');
  for (const row of rows) {
    assert.equal(row.is_nullable, 'YES', `${row.column_name} must be nullable (historical truth is unknown)`);
    assert.equal(row.column_default, null, `${row.column_name} must have no default (nothing is fabricated)`);
  }
  console.log(`[m3-prod] migration shape: 4 additive nullable columns, no defaults (rollback = DROP COLUMN)`);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function createNode(prisma, nodeId, difficulty) {
  await prisma.knowledgeNode.create({
    data: {
      id: nodeId,
      subject: 'DATA_STRUCTURE',
      nodeType: 'knowledge_point',
      name: `m3p node ${nodeId}`,
      importance: 4,
      difficulty,
      syllabusVersion: '2026',
    },
  });
  await prisma.knowledgeFrequencySnapshot.create({
    data: {
      knowledgeNodeId: nodeId,
      snapshotDate: new Date('2026-01-01T00:00:00.000Z'),
      recent3Frequency: 4,
      recent5Frequency: 5,
      allTimeEvidence: 8,
      primaryScore5y: 12,
      trendDirection: 'STABLE',
      trendDelta: 0,
      evidenceConfidence: 'HIGH',
      modelVersion: 'm3-prod-v1',
    },
  });
}

async function seedStudent(prisma, spec, sharedNodeId) {
  const tag = `${runId}-${spec.key}`;
  const userId = `m3p-user-${tag}`;
  const now = Date.now();
  await prisma.user.create({
    data: {
      id: userId,
      email: emailOf(userId),
      name: `M3P ${spec.key}`,
      role: 'STUDENT',
      passwordHash: await hashPassword(studentPassword),
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      targetScore: 120,
      remainingDays: 60,
    },
  });

  const masteryById = new Map();
  const reviewTargets = [];
  const familyIds = [];
  const pointIds = [];
  const nodeIds = [];

  const nodeSpecs = [];
  for (let index = 0; index < spec.nodes.length; index += 1) {
    nodeSpecs.push({ kind: spec.nodes[index].role, reviews: spec.nodes[index].reviews, idempotent: spec.nodes[index].idempotent, shared: spec.shared === true && index === 0 });
  }
  // Context nodes keep the reviewed node's rank observable.
  for (let index = 0; index < CONTEXT_NODES; index += 1) {
    nodeSpecs.push({ kind: `context${index}`, reviews: [], idempotent: false, shared: false });
  }

  for (let index = 0; index < nodeSpecs.length; index += 1) {
    const nodeSpec = nodeSpecs[index];
    const isReviewed = nodeSpec.reviews.length > 0;
    const nodeId = nodeSpec.shared ? sharedNodeId : `m3p-node-${tag}-${index}`;
    const questionId = `m3p-question-${tag}-${index}`;
    const familyId = `m3p-family-${tag}-${index}`;
    const pointId = `m3p-point-${tag}-${index}`;
    familyIds.push(familyId);
    pointIds.push(pointId);
    nodeIds.push(nodeId);
    if (!nodeSpec.shared) await createNode(prisma, nodeId, isReviewed ? spec.difficulty : 3);

    await prisma.questionFamily.create({ data: { id: familyId } });
    await prisma.question.create({
      data: {
        id: questionId,
        familyId,
        contentFingerprint: `m3p-${tag}-${index}`,
        stem: `m3p question ${index}`,
        options: ['A', 'B'],
        answer: 'A',
        analysis: 'seed',
        difficulty: 'MEDIUM',
        type: 'SINGLE_CHOICE',
        source: 'integration',
      },
    });
    await prisma.questionKnowledgeNodeTag.create({
      data: { questionId, knowledgeNodeId: nodeId, role: 'PRIMARY' },
    });

    // Context nodes sit away from the band so the reviewed node's movement is
    // attributable; the reviewed node sits exactly at its band mastery. The
    // shared node (case E) is written once per student but must start equal.
    const mastery = isReviewed ? spec.mastery : clamp01(spec.mastery + (index - 1) * 0.1);
    masteryById.set(nodeId, mastery);

    const correctCount = Math.round(4 * mastery);
    await prisma.userKnowledgeMastery.create({
      data: {
        userId,
        knowledgeNodeId: nodeId,
        mastery,
        accuracy: mastery,
        recentAccuracy: mastery,
        attempts: 4,
        correctCount,
        wrongCount: 4 - correctCount,
        confidence: 0.3,
        retention: 1,
        stabilityDays: 1.7,
        lastReviewedAt: new Date(now - 10 * DAY),
      },
    });
    await prisma.userMasterySnapshot.create({
      data: {
        userId,
        knowledgeNodeId: nodeId,
        mastery,
        attempts: 4,
        correctCount,
        wrongCount: 4 - correctCount,
        // Strictly before every review, so the replay has a real baseline.
        snapshotDate: new Date(now - 20 * DAY),
      },
    });

    if (isReviewed) {
      await prisma.knowledgePoint.create({
        data: {
          id: pointId,
          subject: 'DATA_STRUCTURE',
          chapter: 'm3p',
          title: `m3p point ${tag}`,
          importance: 4,
          frequency: 4,
          prerequisites: [],
        },
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await prisma.practiceRecord.create({
          data: {
            id: `m3p-record-${tag}-${index}-${attempt}`,
            userId,
            questionId,
            knowledgePointId: pointId,
            correct: false,
            timeSpentSec: 120,
            expectedTimeSec: 100,
            mistakeReason: '概念混淆',
            submittedAt: new Date(now - (5 - attempt) * DAY),
          },
        });
      }
      reviewTargets.push({
        nodeId,
        questionId,
        reviews: nodeSpec.reviews,
        idempotent: nodeSpec.idempotent === true,
      });
    }
  }

  return {
    key: spec.key,
    label: spec.label,
    userId,
    difficulty: spec.difficulty,
    masteryById,
    nodeIds,
    reviewTargets,
    familyIds,
    pointIds,
  };
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

async function evidenceRows(prisma, userId) {
  const rows = await prisma.userEvent.findMany({
    where: { userId, type: 'EVIDENCE_RECORDED' },
    select: { id: true, eventKey: true, payload: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, payload: row.payload ?? {} }));
}

async function markerRows(prisma, userId) {
  const rows = await prisma.userEvent.findMany({
    where: { userId, type: 'REVIEW_MASTERY_APPLIED' },
    select: { id: true, eventKey: true, payload: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, payload: row.payload ?? {} }));
}

async function cleanup(prisma, cohort) {
  const userIds = cohort.students.map((student) => student.userId);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (cohort.adminId) await prisma.user.deleteMany({ where: { id: cohort.adminId } });
  const nodeIds = [...new Set(cohort.students.flatMap((student) => student.nodeIds))];
  if (cohort.legacy) nodeIds.push(cohort.legacy.nodeId);
  if (nodeIds.length > 0) {
    await prisma.knowledgeFrequencySnapshot.deleteMany({ where: { knowledgeNodeId: { in: nodeIds } } });
    await prisma.questionKnowledgeNodeTag.deleteMany({ where: { knowledgeNodeId: { in: nodeIds } } });
    await prisma.knowledgeNode.deleteMany({ where: { id: { in: nodeIds } } });
  }
  const questionIds = cohort.students.flatMap((student) => student.reviewTargets.map((target) => target.questionId));
  if (cohort.legacy) questionIds.push(cohort.legacy.questionId);
  if (questionIds.length > 0) await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
  const familyIds = cohort.students.flatMap((student) => student.familyIds);
  if (cohort.legacy) familyIds.push(cohort.legacy.familyId);
  if (familyIds.length > 0) await prisma.questionFamily.deleteMany({ where: { id: { in: familyIds } } });
  const pointIds = cohort.students.flatMap((student) => student.pointIds);
  if (pointIds.length > 0) await prisma.knowledgePoint.deleteMany({ where: { id: { in: pointIds } } });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3250',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { apiOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { apiOutput += chunk.toString(); });
  child.getOutput = () => apiOutput;
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`API exited with ${child.exitCode}: ${apiOutput.trim().slice(-1500)}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.dataSource === 'postgresql') return;
      }
    } catch {}
    await delay(400);
  }
  throw new Error(`Timed out waiting for API health: ${apiOutput.trim().slice(-1500)}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.ok(response.ok, `POST ${url} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.ok(response.ok, `GET ${url} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

/** Login lowercases the address, so the stored form must match it. */
function emailOf(id) {
  return `${id.toLowerCase()}@integration.test`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp01(value) {
  return Math.round(Math.min(0.95, Math.max(0.05, value)) * 10000) / 10000;
}

function subtract(left, right) {
  if (typeof left !== 'number' || typeof right !== 'number') return null;
  return round4(left - right);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function fmtSigned(value) {
  if (typeof value !== 'number') return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(4)}`;
}

function reportCase(row) {
  console.log('');
  console.log(`  case ${row.key}: ${row.label}`);
  console.log('    node                    masterBefore → after      Δmastery   Δpriority  Δopportunity  Δrank');
  for (const node of row.nodes) {
    console.log(
      `    ${node.nodeId.slice(-18).padEnd(20)} ${node.masteryBefore.toFixed(4)} → ${node.masteryAfter.toFixed(4)}  `
      + `${fmtSigned(node.masteryDelta).padStart(9)}  ${String(node.priorityDelta ?? '—').padStart(9)}  `
      + `${String(node.opportunityDelta ?? '—').padStart(12)}  ${String(node.rankDelta ?? '—').padStart(5)}`,
    );
  }
}

main().catch((error) => {
  console.error('[m3-prod] FAILED:', error.message);
  if (transcript.error) console.error('[m3-prod] transcript:', JSON.stringify(transcript).slice(0, 400));
  const output = apiOutput.trim();
  if (output) console.error(output.split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
});
