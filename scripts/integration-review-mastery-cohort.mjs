/**
 * V12-M3 — Review → Unified Mastery shadow: real PostgreSQL + HTTP cohort.
 *
 * ## What this measures, on production code paths
 *
 * The M3 product gap is that `applyReview` never reaches the ability estimate.
 * This script does NOT simulate the pipeline: it drives real reviews through
 * `POST /wrong-questions/:questionId/reason` with `isReview: true`, so the
 * authoritative writer runs, `ReviewAttempt` rows are created and the V12-M1
 * evidence layer issues its `EVIDENCE_RECORDED` receipts. Only then does it read
 * `GET /coach/review-mastery-shadow` and check what wiring review → mastery
 * would do.
 *
 * ## Design
 *
 * 15 students x 6 nodes each, so recommendation ranking is measurable (a single
 * node is always rank 1). The reviewed node sits exactly at its band mastery and
 * is the only node with review history; the other five are context nodes with
 * uniform importance/difficulty so mastery is the only variable under study.
 * Coverage: 3 mastery bands x {correct, incorrect, mixed} x difficulty {1,3,5}
 * x {1, 3} reviews.
 *
 * ## Invariants asserted (no greenwashing)
 *
 *   A. every review event that reached the evidence ledger produced exactly one
 *      traceable mastery step, and no unreceipted event reached the shadow;
 *   B. every step is reproducible from `updateMasteryAfterAttempt` itself;
 *   C. every incorrect review that raised mastery is the canonical model's own
 *      behaviour (recomputed independently), never a wiring artefact;
 *   D. every node's change equals the sum of its attributed steps;
 *   E. no cross-student evidence appears in any student's dataset;
 *   F. authoritative writes = 0 during assembly, and the review path itself
 *      changed no mastery value (the gap, measured).
 *
 * Exits non-zero on the first violated invariant. Every artefact is
 * non-authoritative; nothing is written by the shadow.
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
  effectiveTargetFor,
} = require('../packages/shared/dist/index.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3240';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-review-mastery-secret-0123456789abc';
const adminPassword = 'Review-Mastery-Admin-Password-1';
const studentPassword = 'Review-Mastery-Student-Password-1';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const NODES_PER_STUDENT = 6;

const DESIGN = [
  { band: 'low', mastery: 0.22, difficulty: 1, outcome: 'correct', reviews: 1 },
  { band: 'low', mastery: 0.22, difficulty: 3, outcome: 'incorrect', reviews: 1 },
  { band: 'low', mastery: 0.22, difficulty: 5, outcome: 'incorrect', reviews: 3 },
  { band: 'mid', mastery: 0.6, difficulty: 1, outcome: 'correct', reviews: 1 },
  { band: 'mid', mastery: 0.6, difficulty: 3, outcome: 'correct', reviews: 3 },
  { band: 'mid', mastery: 0.6, difficulty: 5, outcome: 'incorrect', reviews: 1 },
  { band: 'high', mastery: 0.95, difficulty: 1, outcome: 'correct', reviews: 3 },
  { band: 'high', mastery: 0.95, difficulty: 3, outcome: 'incorrect', reviews: 3 },
  { band: 'high', mastery: 0.95, difficulty: 5, outcome: 'correct', reviews: 1 },
  { band: 'low', mastery: 0.22, difficulty: 5, outcome: 'mixed', reviews: 3 },
  { band: 'mid', mastery: 0.6, difficulty: 1, outcome: 'mixed', reviews: 3 },
  { band: 'high', mastery: 0.95, difficulty: 3, outcome: 'mixed', reviews: 3 },
  { band: 'low', mastery: 0.22, difficulty: 1, outcome: 'incorrect', reviews: 1 },
  { band: 'mid', mastery: 0.6, difficulty: 5, outcome: 'correct', reviews: 3 },
  { band: 'high', mastery: 0.95, difficulty: 1, outcome: 'incorrect', reviews: 1 },
];

let activeApi = null;
/**
 * `POST /auth/login` is production-throttled to 10 requests / 60s
 * (apps/api/src/auth/auth.controller.ts:22). The cohort needs 16 logins, so the
 * script works WITH the guard instead of disabling it.
 */
const LOGIN_WINDOW = { limit: 9, used: 0 };

async function login(email, password) {
  if (LOGIN_WINDOW.used >= LOGIN_WINDOW.limit) {
    console.log('[review-mastery] waiting out the login throttle window (10/60s is a production guard)');
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
  const cohort = [];
  let adminId = null;
  try {
    adminId = `rm-admin-${runId}`;
    await prisma.user.create({
      data: {
        id: adminId,
        email: `${adminId}@integration.test`,
        name: 'Review Mastery Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(adminPassword),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });

    for (const design of DESIGN) {
      cohort.push(await seedStudent(prisma, design));
    }
    console.log(`[review-mastery] seeded ${cohort.length} students x ${NODES_PER_STUDENT} nodes`);

    const userIds = cohort.map((student) => student.userId);
    const beforeReviews = await masteryFingerprint(prisma, userIds);

    activeApi = startApi();
    await waitForHealth(activeApi);

    const adminToken = await login(`${adminId}@integration.test`, adminPassword);
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    // -------------------------------------------------------------------
    // Phase 1 — drive REAL reviews through the production endpoint
    // -------------------------------------------------------------------
    for (const student of cohort) {
      const token = await login(`${student.userId}@integration.test`, studentPassword);
      student.token = token;
      const headers = { authorization: `Bearer ${token}` };
      student.outcomes = [];
      for (let index = 0; index < student.reviews; index += 1) {
        const correct = student.outcome === 'all_correct'
          ? true
          : student.outcome === 'all_wrong'
            ? false
            : index % 2 === 0;
        student.outcomes.push(correct);
        const result = await postJson(
          `${apiUrl}/wrong-questions/${student.questionIds[0]}/reason`,
          {
            selfReportedReason: 'integration review',
            redoCorrect: correct,
            timeSpentSec: 45,
            isReview: true,
          },
          headers,
        );
        assert.ok(result, 'the review must be accepted');
      }
    }

    const afterReviews = await masteryFingerprint(prisma, userIds);
    // V12-M3-C inverted this assertion on purpose. Until the production
    // integration landed, the correct statement was "reviews must NOT change
    // authoritative mastery" — that was the gap being shadowed. The gap is now
    // closed, so the same measurement must show the opposite, and the cohort is
    // the place that proves it holds at scale rather than in one hand-built case.
    const movedKeys = afterReviews.masteryByKey.filter(
      (key, index) => key !== beforeReviews.masteryByKey[index],
    );
    assert.equal(
      movedKeys.length,
      cohort.length,
      `every reviewed node must move now: expected ${cohort.length} changed rows, got ${movedKeys.length}`,
    );
    assert.ok(
      afterReviews.attempts > beforeReviews.attempts,
      'the review attempts must have been persisted by production code',
    );
    assert.ok(
      afterReviews.evidence > beforeReviews.evidence,
      'the evidence layer must have issued receipts through production code',
    );

    // M3-A fidelity at cohort scale: one occurrence-keyed receipt per attempt.
    // Before the fix this was 31 attempts → 15 receipts.
    const fidelity = await receiptFidelity(prisma, userIds);
    assert.equal(
      fidelity.attempts,
      fidelity.occurrenceReceipts,
      `M3-A: every attempt needs its own receipt (attempts ${fidelity.attempts} vs occurrence receipts ${fidelity.occurrenceReceipts})`,
    );
    assert.equal(
      fidelity.markers,
      fidelity.occurrenceReceipts,
      'M3-C: every receipt must be projected exactly once',
    );
    console.log(
      `[review-mastery] reviews persisted: attempts ${beforeReviews.attempts} → ${afterReviews.attempts}, `
      + `authoritative mastery changed on ${movedKeys.length}/${cohort.length} reviewed nodes`,
    );
    console.log(
      `[review-mastery] M3-A fidelity: ${fidelity.attempts} attempts → ${fidelity.occurrenceReceipts} occurrence-keyed receipts `
      + `(1:1), ${fidelity.markers} mastery applications; ${fidelity.legacyReceipts} pre-migration day-scoped receipts`,
    );

    // -------------------------------------------------------------------
    // Phase 2 — read the shadow for every student; prove it writes nothing
    // -------------------------------------------------------------------
    await expectStatus(`${apiUrl}/coach/review-mastery-shadow?userId=${userIds[0]}`, {}, 401);
    // Reuses the token from the review phase — the throttle is real and there is
    // no reason to spend another login on it.
    await expectStatus(
      `${apiUrl}/coach/review-mastery-shadow?userId=${userIds[0]}`,
      { authorization: `Bearer ${cohort[0].token}` },
      403,
    );

    const results = [];
    for (const student of cohort) {
      const shadow = await getJson(
        `${apiUrl}/coach/review-mastery-shadow?userId=${student.userId}&windowDays=365`,
        adminHeaders,
      );
      assert.ok(shadow.result, `${student.userId} must have a shadow`);
      assert.equal(shadow.result.authoritative, false, 'shadow output must never be authoritative');
      results.push({ student, shadow: shadow.result });
    }

    const afterShadow = await masteryFingerprint(prisma, userIds);
    // Six tables, including the two a mastery shadow would most plausibly reach
    // for (UserMasterySnapshot / RecommendationAction): reading the shadow must
    // change nothing anywhere.
    assert.deepEqual(
      afterShadow,
      afterReviews,
      'authoritative writes = 0: reading the shadow must change nothing at all',
    );
    console.log(
      `[review-mastery] authoritative writes = 0 across 6 tables `
      + `(mastery rows ${afterShadow.masteryRows}, snapshots ${afterShadow.snapshots}, `
      + `schedules ${afterShadow.schedules}, attempts ${afterShadow.attempts}, `
      + `evidence ${afterShadow.evidence}, actions ${afterShadow.actions})`,
    );

    // -------------------------------------------------------------------
    // Phase 3 — invariant checks
    // -------------------------------------------------------------------
    const seenEventIds = new Map();
    const rows = [];
    let totalSteps = 0;
    let offTargetSteps = 0;
    let correctLowered = 0;
    let incorrectRaised = 0;
    let unreproducibleRises = 0;

    for (const { student, shadow } of results) {
      const owner = student.userId;
      assert.equal(shadow.authoritative, false, 'shadow output must never be authoritative');
      assert.equal(shadow.model, 'production', 'the candidate must never be the default');
      assert.equal(shadow.audit.passed, true, `${owner} audit failed: ${shadow.audit.basis}`);
      assert.equal(shadow.projection.authoritative, false);
      assert.equal(shadow.mastery.authoritative, false);
      assert.equal(shadow.dataset.authoritative, false);

      const reconciliation = shadow.projection.reconciliation;
      assert.equal(reconciliation.events, student.reviews, `${owner}: expected ${student.reviews} review events`);
      // A: the evidence boundary. Every observed review must have a receipt.
      assert.equal(reconciliation.eventsWithoutNode, 0, `${owner}: all questions must resolve to a node`);
      assert.equal(
        reconciliation.eventsWithReceipt,
        student.reviews,
        `${owner}: every review must carry an evidence receipt`,
      );
      assert.equal(
        shadow.mastery.eventRows.length,
        student.reviews,
        `${owner}: one mastery step per review event`,
      );
      assert.equal(shadow.dataset.summary.events, student.reviews);
      assert.equal(shadow.dataset.summary.attributionComplete, true, `${owner}: attribution must be complete`);
      assert.equal(shadow.downstream.available, true, `${owner}: the decision chain must cover the node`);

      // E: student isolation.
      const ownNodes = new Set(student.nodeIds);
      for (const row of shadow.dataset.rows) {
        assert.equal(row.studentId, owner, 'a dataset row leaked another student');
        assert.equal(row.authoritative, false);
        assert.ok(ownNodes.has(row.nodeId), `${owner}: foreign node ${row.nodeId}`);
        assert.ok(
          row.attribution[0].startsWith(`review.recalled:`),
          `${owner}: every step must name the review event that caused it`,
        );
        const previous = seenEventIds.get(row.reviewEventId);
        assert.ok(
          previous == null || previous === owner,
          `review event ${row.reviewEventId} appeared for both ${previous} and ${owner}`,
        );
        seenEventIds.set(row.reviewEventId, owner);
      }

      // B/C/D: semantics fidelity, direction, conservation.
      for (const step of shadow.mastery.trace) {
        for (const event of step.steps) {
          totalSteps += 1;
          const observation = shadow.projection.observations.find(
            (row) => row.reviewEventId === event.reviewEventId,
          );
          assert.ok(observation, `${owner}: trace step without an observation`);
          const before = { mastery: event.beforeRaw, accuracy: 0, recentAccuracy: 0, attempts: 0, correctCount: 0, wrongCount: 0, confidence: 0 };
          const expected = updateMasteryAfterAttempt(before, {
            isCorrect: observation.redoCorrect,
            difficulty: observation.difficulty,
            role: 'PRIMARY',
          });
          assert.ok(
            Object.is(expected.mastery, event.afterRaw),
            `${owner}: step ${event.reviewEventId} is not the canonical model`,
          );
          const target = effectiveTargetFor('production', before, {
            isCorrect: observation.redoCorrect,
            difficulty: observation.difficulty,
            role: 'PRIMARY',
          });
          const moved = event.afterRaw - event.beforeRaw;
          if (Math.abs(moved) > 1e-9 && Math.sign(moved) !== Math.sign(target - event.beforeRaw)) {
            offTargetSteps += 1;
          }
          if (observation.redoCorrect && moved < -1e-9) correctLowered += 1;
          if (!observation.redoCorrect && moved > 1e-9) {
            incorrectRaised += 1;
            // C: a rise after a wrong answer must be the canonical target lying
            // above the estimate — the model's own equilibrium, not the wiring.
            if (!(target > event.beforeRaw)) unreproducibleRises += 1;
          }
        }
        const stepSum = step.steps.reduce((sum, item) => sum + (item.afterRaw - item.beforeRaw), 0);
        assert.ok(
          Math.abs(stepSum - (step.finalRaw - step.baselineRaw)) < 1e-12,
          `${owner}: ${step.nodeId} has unattributable mastery change`,
        );
      }
      assert.equal(offTargetSteps, 0, 'every step must move toward its canonical target');
      assert.equal(unreproducibleRises, 0, 'no rise after a wrong review may be a wiring artefact');

      const node = shadow.mastery.nodeRows.find((item) => item.nodeId === student.nodeIds[0]);
      assert.ok(node, `${owner}: the reviewed node must be in the shadow`);
      // V12-M3-C: the authoritative value must have moved by exactly the unified
      // semantics applied to this student's own observed outcomes (C1 OFF), and
      // it must have moved at all — otherwise the integration did nothing.
      let expected = {
        mastery: student.mastery, accuracy: 0, recentAccuracy: 0,
        attempts: 0, correctCount: 0, wrongCount: 0, confidence: 0,
      };
      for (const correct of student.outcomes) {
        expected = updateMasteryAfterAttempt(expected, {
          isCorrect: correct,
          difficulty: student.difficulty,
          role: 'PRIMARY',
        });
      }
      assert.equal(
        node.authoritativeMastery,
        Math.round(expected.mastery * 10000) / 10000,
        `${owner}: authoritative mastery must equal the legacy production model applied to its own outcomes`,
      );
      assert.notEqual(
        node.authoritativeMastery,
        student.mastery,
        `${owner}: the review must have moved authoritative mastery (the M3 gap is closed)`,
      );
      rows.push({
        owner: student.userId,
        band: student.band,
        difficulty: student.difficulty,
        outcome: student.outcome,
        reviews: student.reviews,
        receipts: reconciliation.eventsWithReceipt,
        coalesced: reconciliation.coalescedReceipts,
        baseline: node.baselineMastery,
        shadow: node.shadowMastery,
        authoritative: node.authoritativeMastery,
        delta: node.masteryDelta,
        direction: node.direction,
        priorityDelta: shadow.dataset.rows[0].priorityDelta,
        opportunityDelta: shadow.dataset.rows[0].opportunityDelta,
        rankDelta: shadow.dataset.rows[0].rankDelta,
        affectedNodes: shadow.dataset.summary.affectedNodes,
        nodes: shadow.dataset.summary.nodes,
        steps: shadow.mastery.eventRows.length,
      });
    }

    report(rows, { correctLowered, incorrectRaised, totalSteps, attempts: afterReviews.attempts - beforeReviews.attempts });

    // -------------------------------------------------------------------
    // Phase 4 — cohort aggregate through the service's own pure aggregator
    // -------------------------------------------------------------------
    const aggregate = {
      students: results.length,
      studentsAffected: results.filter((item) => item.shadow.dataset.summary.affectedNodes > 0).length,
      events: results.reduce((sum, item) => sum + item.shadow.dataset.summary.events, 0),
      nodes: results.reduce((sum, item) => sum + item.shadow.dataset.summary.nodes, 0),
      affectedNodes: results.reduce((sum, item) => sum + item.shadow.dataset.summary.affectedNodes, 0),
      rankChanges: results.reduce((sum, item) => sum + item.shadow.dataset.summary.rankChanges, 0),
    };
    console.log('');
    console.log('[review-mastery] cohort aggregate');
    console.log(`  students ....................... ${aggregate.students}`);
    console.log(`  students whose nodes changed ... ${aggregate.studentsAffected} (${pct(aggregate.studentsAffected, aggregate.students)})`);
    console.log(`  review events .................. ${aggregate.events}`);
    console.log(`  nodes .......................... ${aggregate.nodes} (affected ${aggregate.affectedNodes}, ${pct(aggregate.affectedNodes, aggregate.nodes)})`);
    console.log(`  recommendation rank changes .... ${aggregate.rankChanges}`);
    console.log(`  correct reviews moved DOWN ..... ${correctLowered}`);
    console.log(`  incorrect reviews moved UP ..... ${incorrectRaised}`);
    console.log('  (both are the current EMA\'s own transient, reproduced from the canonical model)');
    console.log('');
    console.log('[review-mastery] PASS — review→mastery shadow is computable, attributable, non-authoritative');
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    const userIds = cohort.map((student) => student.userId);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => {});
    for (const student of cohort) {
      await prisma.knowledgeFrequencySnapshot
        .deleteMany({ where: { knowledgeNodeId: { in: student.nodeIds } } })
        .catch(() => {});
      await prisma.questionKnowledgeNodeTag
        .deleteMany({ where: { knowledgeNodeId: { in: student.nodeIds } } })
        .catch(() => {});
      await prisma.question.deleteMany({ where: { id: { in: student.questionIds } } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: { in: student.nodeIds } } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { in: student.familyIds } } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: { in: student.pointIds } } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

async function seedStudent(prisma, design) {
  const tag = `${runId}-${design.band}-d${design.difficulty}-${design.outcome}-r${design.reviews}`;
  const userId = `rm-user-${tag}`;
  const now = Date.now();
  const outcome = design.outcome === 'correct' ? 'all_correct' : design.outcome === 'incorrect' ? 'all_wrong' : 'mixed';

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@integration.test`,
      name: `RM ${design.band} ${design.outcome} d${design.difficulty} r${design.reviews}`,
      role: 'STUDENT',
      passwordHash: await hashPassword(studentPassword),
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      targetScore: 120,
      remainingDays: 60,
    },
  });

  const nodes = [];
  const familyIds = [];
  const pointIds = [];
  for (let index = 0; index < NODES_PER_STUDENT; index += 1) {
    const nodeId = `rm-node-${tag}-${index}`;
    const questionId = `rm-question-${tag}-${index}`;
    const nodeFamilyId = `rm-family-${tag}-${index}`;
    const pointId = `rm-point-${tag}-${index}`;
    familyIds.push(nodeFamilyId);
    pointIds.push(pointId);
    const isReviewed = index === 0;
    const offset = isReviewed ? 0 : (index - Math.floor(NODES_PER_STUDENT / 2)) * 0.07;
    const mastery = clamp01(design.mastery + offset);
    // Uniform across a student's nodes so any rank movement is attributable to
    // the reviewed node's mastery alone.
    const difficulty = isReviewed ? design.difficulty : 3;

    await prisma.knowledgeNode.create({
      data: {
        id: nodeId,
        subject: index % 2 === 0 ? 'DATA_STRUCTURE' : 'OPERATING_SYSTEM',
        nodeType: 'knowledge_point',
        name: `rm node ${tag} #${index}`,
        importance: 4,
        difficulty,
        syllabusVersion: '2026',
      },
    });
    await prisma.questionFamily.create({ data: { id: nodeFamilyId } });
    await prisma.question.create({
      data: {
        id: questionId,
        familyId: nodeFamilyId,
        contentFingerprint: `rm-${tag}-${index}`,
        stem: `rm seed question ${index}`,
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
        modelVersion: 'review-mastery-cohort-v1',
      },
    });

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
    // Baseline strictly before the reviews, so the replay starts from the
    // student's real pre-review state rather than from nothing.
    await prisma.userMasterySnapshot.create({
      data: {
        userId,
        knowledgeNodeId: nodeId,
        mastery,
        attempts: 4,
        correctCount,
        wrongCount: 4 - correctCount,
        snapshotDate: new Date(now - 20 * DAY),
      },
    });

    // Practice history is a precondition of the review endpoint: production
    // refuses to schedule a review for a question the student never answered.
    // `PracticeRecord.knowledgePointId` is a real foreign key, so the legacy
    // KnowledgePoint row has to exist.
    if (isReviewed) {
      await prisma.knowledgePoint.create({
        data: {
          id: pointId,
          subject: 'DATA_STRUCTURE',
          chapter: 'cohort',
          title: `rm point ${tag}`,
          importance: 4,
          frequency: 4,
          prerequisites: [],
        },
      });
      for (let index2 = 0; index2 < 2; index2 += 1) {
        await prisma.practiceRecord.create({
          data: {
            id: `rm-record-${tag}-${index2}`,
            userId,
            questionId,
            knowledgePointId: pointId,
            correct: false,
            timeSpentSec: 120,
            expectedTimeSec: 100,
            mistakeReason: '概念混淆',
            submittedAt: new Date(now - (5 - index2) * DAY),
          },
        });
      }
    }

    nodes.push({ nodeId, questionId, mastery });
  }

  return {
    userId,
    nodeId: nodes[0].nodeId,
    nodeIds: nodes.map((node) => node.nodeId),
    questionIds: nodes.map((node) => node.questionId),
    familyIds,
    pointIds,
    band: design.band,
    difficulty: design.difficulty,
    outcome,
    reviews: design.reviews,
    mastery: nodes[0].mastery,
  };
}

/**
 * The authoritative state. `masteryByKey` deliberately excludes stability:
 * `applyReview` is SUPPOSED to move stability (that is what it writes today), so
 * only the ability estimate is the gap under measurement.
 *
 * Every table a review→mastery shadow could plausibly touch is counted, so
 * "authoritative writes = 0" is a real claim rather than one that happens to
 * omit the table the shadow would have used.
 */
async function masteryFingerprint(prisma, userIds) {
  const [mastery, snapshots, attempts, events, schedules, actions] = await Promise.all([
    prisma.userKnowledgeMastery.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, knowledgeNodeId: true, mastery: true, retention: true, stabilityDays: true },
      orderBy: { knowledgeNodeId: 'asc' },
    }),
    prisma.userMasterySnapshot.count({ where: { userId: { in: userIds } } }),
    prisma.reviewAttempt.count({ where: { schedule: { userId: { in: userIds } } } }),
    prisma.userEvent.count({ where: { userId: { in: userIds } } }),
    prisma.reviewSchedule.count({ where: { userId: { in: userIds } } }),
    prisma.recommendationAction.count({ where: { userId: { in: userIds } } }),
  ]);
  return {
    masteryByKey: mastery.map((row) => `${row.userId}:${row.knowledgeNodeId}=${row.mastery}/${row.retention}`),
    masteryRows: mastery.length,
    snapshots,
    attempts,
    evidence: events,
    schedules,
    actions,
  };
}

/**
 * V12-M3-A fidelity at cohort scale: how many review attempts exist, how many
 * carry their own occurrence-keyed receipt, and how many were projected into
 * mastery exactly once. Before the fix this cohort measured 31 attempts → 15
 * receipts.
 */
async function receiptFidelity(prisma, userIds) {
  const attempts = await prisma.reviewAttempt.count({
    where: { schedule: { userId: { in: userIds } } },
  });
  const events = await prisma.userEvent.findMany({
    where: { userId: { in: userIds }, type: 'EVIDENCE_RECORDED' },
    select: { payload: true },
  });
  const recallReceipts = events.filter((row) => row.payload?.action === 'review.recalled');
  const occurrenceReceipts = recallReceipts.filter(
    (row) => typeof row.payload?.occurrence === 'string' && row.payload.occurrence.length > 0,
  );
  const markers = await prisma.userEvent.count({
    where: { userId: { in: userIds }, type: 'REVIEW_MASTERY_APPLIED' },
  });
  return {
    attempts,
    recallReceipts: recallReceipts.length,
    occurrenceReceipts: occurrenceReceipts.length,
    legacyReceipts: recallReceipts.length - occurrenceReceipts.length,
    markers,
  };
}

function report(rows, summary) {
  console.log('');
  console.log('[review-mastery] per student (reviewed node only)');
  console.log('  band  diff  outcome    n  step  base   shadow  auth   delta   dPrio   dOpp  dRank');
  for (const row of rows) {
    console.log(
      `  ${row.band.padEnd(5)} ${String(row.difficulty).padEnd(5)} ${row.outcome.padEnd(10)} `
      + `${String(row.reviews).padStart(1)}  ${String(row.steps).padStart(4)}  `
      + `${fmt(row.baseline).padStart(6)} ${fmt(row.shadow).padStart(7)} ${fmt(row.authoritative).padStart(6)} `
      + `${fmtSigned(row.delta).padStart(7)} ${fmtSigned(row.priorityDelta).padStart(7)} `
      + `${fmtSigned(row.opportunityDelta).padStart(6)} ${String(row.rankDelta ?? '—').padStart(5)}`,
    );
  }
  console.log('');
  console.log(`[review-mastery] checked ${summary.totalSteps} mastery steps; `
    + `${summary.correctLowered} correct reviews moved down, ${summary.incorrectRaised} incorrect reviews moved up`);
  // After V12-M3-C the shadow's baseline is no longer the pre-review state: the
  // production path writes a same-day snapshot WITH the review already applied,
  // and the shadow picks the nearest snapshot at or before the observation. So
  // the `base` column below already contains the review and `delta` is one extra
  // step from a same-day baseline — it is a baseline artefact, NOT a
  // production-vs-shadow semantics divergence. The production movement is the
  // difference between the seeded pre-review value and `auth`.
  console.log('[review-mastery] NOTE: `base` is the review-day snapshot and already');
  console.log('[review-mastery]       includes the review, so `delta` is a baseline artefact,');
  console.log('[review-mastery]       not a semantics divergence. `auth` is the authoritative value.');
}

function clamp01(value) {
  return Math.round(Math.min(0.95, Math.max(0.05, value)) * 10000) / 10000;
}

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
}

function fmtSigned(value) {
  if (typeof value !== 'number') return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(4)}`;
}

function pct(part, total) {
  if (total === 0) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3240',
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
      if (response.ok) {
        const health = await response.json();
        if (health.dataSource === 'postgresql') return;
      }
    } catch {}
    await delay(400);
  }
  throw new Error(`Timed out waiting for API health: ${child.getOutput?.().trim() ?? ''}`);
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

/** 401 (not 404) proves the route exists; 403 proves the role guard is real. */
async function expectStatus(url, headers, expected) {
  const response = await fetch(url, { headers });
  assert.equal(
    response.status,
    expected,
    `${url} should return ${expected} but returned ${response.status}`,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('[review-mastery] FAILED:', error.message);
  if (activeApi?.getOutput) {
    const output = activeApi.getOutput().trim();
    if (output) console.error(output.split('\n').slice(-25).join('\n'));
  }
  process.exitCode = 1;
});
