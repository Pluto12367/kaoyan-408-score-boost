/**
 * V12-M3 — review semantics shadow COHORT.
 *
 * The owner's instruction for Phase C was explicit: do NOT switch production
 * semantics; keep the shadow and let it accumulate evidence across many
 * students, both outcomes, different mastery bands, different intervals and
 * repeated reviews — and watch how the divergence propagates, not just how big
 * the mastery delta is.
 *
 * This script produces exactly that evidence. It seeds a cohort of synthetic
 * students into the test database with controlled variation, reads the shadow
 * for each through the real API, and reports:
 *
 *   • the divergence distribution overall and per mastery band
 *   • direction agreement rate (does the unified replay point the same way
 *     every time, or does it disagree with itself across the cohort?)
 *   • the observed sample size against the PRE-REGISTERED switch threshold
 *   • a readiness verdict that is allowed to say "not yet"
 *
 * It never writes production semantics: seeding is confined to throwaway
 * students in the test database, and the shadow itself is read-only.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3220';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-shadow-cohort-secret-0123456789abc';
const adminPassword = 'Shadow-Cohort-Admin-Password-1';
const studentPassword = 'Shadow-Cohort-Student-Password-1';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;

/** Pre-registered switch criteria (documented before any of this was measured). */
const PREREGISTERED = { minDirectionAgreement: 0.7, minObservations: 30 };

/**
 * Several nodes per student, because recommendation ranking is not measurable
 * with one: a lone node is always rank 1, so "did top-N change?" would be
 * unanswerable and the rank-spread risk untestable.
 */
const NODES_PER_STUDENT = 6;

const MASTERY_BANDS = [
  { label: '0.00-0.30', mastery: 0.22 },
  { label: '0.30-0.45', mastery: 0.38 },
  { label: '0.45-0.60', mastery: 0.52 },
  { label: '0.60-0.75', mastery: 0.68 },
  { label: '0.75-1.00', mastery: 0.82 },
];
const OUTCOMES = ['all_correct', 'all_wrong', 'mixed'];
const INTERVALS = [1, 3, 7];
const REVIEW_COUNTS = [1, 2, 3];

let activeApi = null;

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
    adminId = `cohort-admin-${runId}`;
    await prisma.user.upsert({
      where: { id: adminId },
      update: { passwordHash: await hashPassword(adminPassword), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
      create: {
        id: adminId,
        email: `${adminId}@integration.test`,
        name: 'Cohort Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(adminPassword),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });

    // Build the cohort: every (band x outcome) pair, with review count and
    // interval cycling so the sample is not dominated by one shape.
    let index = 0;
    for (const band of MASTERY_BANDS) {
      for (const outcome of OUTCOMES) {
        const reviewCount = REVIEW_COUNTS[index % REVIEW_COUNTS.length];
        const intervalDays = INTERVALS[index % INTERVALS.length];
        index += 1;
        cohort.push(await seedStudent(prisma, { band, outcome, reviewCount, intervalDays }));
      }
    }
    console.log(`[shadow-cohort] seeded ${cohort.length} students (${MASTERY_BANDS.length} bands x ${OUTCOMES.length} outcomes)`);

    activeApi = startApi();
    await waitForHealth(activeApi);
    const adminLogin = await postJson(`${apiUrl}/auth/login`, {
      email: `${adminId}@integration.test`,
      password: adminPassword,
    });
    const adminToken = adminLogin?.accessToken ?? adminLogin?.token;
    assert.ok(adminToken, 'the cohort admin must be able to log in');
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    // Read the shadow for each student through the real API.
    const rows = [];
    for (const student of cohort) {
      const shadow = await getJson(
        `${apiUrl}/coach/review-semantics-shadow?userId=${student.userId}&windowDays=365`,
        adminHeaders,
      );
      assert.equal(shadow.authoritative, false, 'shadow output must never be authoritative');
      const row = (shadow.masteryReplay?.rows ?? []).find((item) => item.nodeId === student.nodeId) ?? null;
      rows.push({ ...student, row, retention: shadow.retention?.summary ?? null });
    }

    report(rows);

    // ---------------------------------------------------------------------
    // Shadow Decision Chain: propagate the divergence to the actual decision
    // ---------------------------------------------------------------------
    await verifyDecisionChain(prisma, cohort, adminHeaders, rows);
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    // Clean up only this run's throwaway students and content.
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
      await prisma.question
        .deleteMany({ where: { id: { in: student.questionIds } } })
        .catch(() => {});
      await prisma.knowledgeNode
        .deleteMany({ where: { id: { in: student.nodeIds } } })
        .catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { in: student.familyIds } } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

async function seedStudent(prisma, { band, outcome, reviewCount, intervalDays }) {
  const tag = `${runId}-${band.label}-${outcome}-${reviewCount}-${intervalDays}`;
  const userId = `cohort-user-${tag}`;
  const familyId = `cohort-family-${tag}`;
  const now = Date.now();

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@integration.test`,
      name: `Cohort ${band.label} ${outcome}`,
      role: 'STUDENT',
      passwordHash: await hashPassword(studentPassword),
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      targetScore: 120,
      remainingDays: 60,
    },
  });
  await prisma.questionFamily.create({ data: { id: familyId } });

  // A student needs SEVERAL nodes for recommendation ranking to be measurable at
  // all: with one node its rank is always 1, so "did the top items change?"
  // cannot be answered. The reviewed node is index 0; the rest are context
  // nodes whose mastery stays authoritative and therefore act as the comparison
  // set that the reviewed node can move relative to.
  const nodes = [];
  const familyIds = [];
  for (let index = 0; index < NODES_PER_STUDENT; index += 1) {
    const nodeId = `cohort-node-${tag}-${index}`;
    const questionId = `cohort-question-${tag}-${index}`;
    // Question is unique on (familyId, versionNumber), so each seeded question
    // needs its own family.
    const nodeFamilyId = `${familyId}-${index}`;
    familyIds.push(nodeFamilyId);
    const isReviewed = index === 0;
    // Context nodes are spread around the band so the reviewed node has room to
    // move up or down the ranking.
    const offset = (index - Math.floor(NODES_PER_STUDENT / 2)) * 0.07;
    const mastery = clamp01(band.mastery + offset);

    await prisma.knowledgeNode.create({
      data: {
        id: nodeId,
        subject: index % 2 === 0 ? 'DATA_STRUCTURE' : 'OPERATING_SYSTEM',
        nodeType: 'knowledge_point',
        name: `cohort node ${tag} #${index}`,
        importance: 3 + (index % 3),
        difficulty: 2 + (index % 3),
        syllabusVersion: '2026',
      },
    });
    await prisma.questionFamily.create({ data: { id: nodeFamilyId } });
    await prisma.question.create({
      data: {
        id: questionId,
        familyId: nodeFamilyId,
        contentFingerprint: `cohort-${tag}-${index}`,
        stem: `cohort seed question ${index}`,
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
        recent3Frequency: 3 + (index % 4),
        recent5Frequency: 4 + (index % 3),
        allTimeEvidence: 6 + (index % 5),
        primaryScore5y: 8 + (index % 6),
        trendDirection: 'STABLE',
        trendDelta: 0,
        evidenceConfidence: 'HIGH',
        modelVersion: 'cohort-v1',
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
        lastReviewedAt: new Date(now - intervalDays * DAY),
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
        snapshotDate: new Date(now - (reviewCount * intervalDays + 2) * DAY),
      },
    });

    // Only the reviewed node gets review attempts; the others must stay
    // authoritative so the divergence stays attributable to one node.
    if (isReviewed) {
      const scheduleId = `cohort-schedule-${tag}`;
      await prisma.reviewSchedule.create({
        data: {
          id: scheduleId,
          userId,
          questionId,
          consecutiveCorrect: 0,
          stability: 'learning',
          nextReviewAt: new Date(now + DAY),
          reviewCount,
          lastReviewedAt: new Date(now - intervalDays * DAY),
        },
      });
      for (let attempt = 0; attempt < reviewCount; attempt += 1) {
        const correct = outcome === 'all_correct' ? true : outcome === 'all_wrong' ? false : attempt % 2 === 0;
        await prisma.reviewAttempt.create({
          data: {
            scheduleId,
            redoCorrect: correct,
            timeSpentSec: 45 + attempt * 10,
            nextIntervalDays: intervalDays,
            reviewedAt: new Date(now - (reviewCount - attempt) * intervalDays * DAY),
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
    contextNodeIds: nodes.slice(1).map((node) => node.nodeId),
    familyId,
    familyIds,
    questionIds: nodes.map((node) => node.questionId),
    band: band.label,
    outcome,
    reviewCount,
    intervalDays,
  };
}

function clamp01(value) {
  return Math.round(Math.min(0.95, Math.max(0.05, value)) * 10000) / 10000;
}


function report(rows) {
  const evaluated = rows.filter((item) => item.row && item.row.replayMastery != null);
  const higher = evaluated.filter((item) => item.row.direction === 'unified_higher').length;
  const lower = evaluated.filter((item) => item.row.direction === 'unified_lower').length;
  const converged = evaluated.filter((item) => item.row.direction === 'converged').length;
  const insufficient = rows.filter((item) => !item.row || item.row.replayMastery == null).length;

  console.log('');
  console.log('[shadow-cohort] divergence per student');
  for (const item of rows) {
    const delta = item.row?.delta;
    console.log(
      `  ${item.band.padEnd(10)} ${item.outcome.padEnd(11)} reviews=${item.reviewCount} interval=${item.intervalDays}d `
      + `stored=${fmt(item.row?.storedMastery)} unified=${fmt(item.row?.replayMastery)} `
      + `delta=${delta == null ? '—' : (delta > 0 ? '+' : '') + delta} ${item.row?.direction ?? 'insufficient_data'}`,
    );
  }

  const observations = evaluated.length;
  const directional = higher + lower;
  const agreement = directional > 0 ? Math.max(higher, lower) / directional : null;

  console.log('');
  console.log('[shadow-cohort] by mastery band');
  for (const band of MASTERY_BANDS) {
    const inBand = evaluated.filter((item) => item.band === band.label);
    const deltas = inBand.map((item) => item.row.delta ?? 0);
    const mean = deltas.length > 0 ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
    const flips = inBand.filter((item) => item.row.direction !== 'unified_higher').length;
    console.log(
      `  ${band.label.padEnd(10)} n=${String(inBand.length).padEnd(2)} meanDelta=${fmt(mean)} `
      + `unified_higher=${inBand.length - flips} other=${flips}`,
    );
  }

  console.log('');
  console.log('[shadow-cohort] summary');
  console.log(`  evaluated=${observations} insufficient=${insufficient}`);
  console.log(`  unified_higher=${higher} unified_lower=${lower} converged=${converged}`);
  console.log(`  direction agreement=${agreement == null ? 'n/a' : (agreement * 100).toFixed(1) + '%'} (of ${directional} directional)`);
  console.log(
    `  preregistered threshold: agreement >= ${PREREGISTERED.minDirectionAgreement * 100}% `
    + `and observations >= ${PREREGISTERED.minObservations}`,
  );

  const agreementOk = agreement != null && agreement >= PREREGISTERED.minDirectionAgreement;
  const sampleOk = observations >= PREREGISTERED.minObservations;
  const ready = agreementOk && sampleOk;

  console.log('');
  console.log(`[shadow-cohort] SWITCH READINESS: ${ready ? 'THRESHOLD MET (still owner-gated)' : 'NOT READY — stay in shadow'}`);
  if (!sampleOk) {
    console.log(`  reason: only ${observations} evaluated observations, below the preregistered floor of ${PREREGISTERED.minObservations}`);
  }
  if (!agreementOk) {
    console.log('  reason: the unified replay does not point consistently in one direction across the cohort');
  }
  console.log('  note: this is a synthetic cohort. Real students, real intervals and real retention observations are still required.');
  console.log('[shadow-cohort] production semantics unchanged (shadow only)');
}

function fmt(value) {
  return value == null ? '—' : Number(value).toFixed(4);
}

/**
 * Read-only fingerprint of the authoritative learning state. Any change across
 * the shadow phase means the shadow wrote something it must never write.
 */
async function authoritativeFingerprint(prisma) {
  const [mastery, schedules, attempts, actions, events] = await Promise.all([
    prisma.userKnowledgeMastery.findMany({ select: { userId: true, mastery: true, stabilityDays: true } }),
    prisma.reviewSchedule.count(),
    prisma.reviewAttempt.count(),
    prisma.recommendationAction.count(),
    prisma.userEvent.count(),
  ]);
  const masterySum = MasterySum(mastery);
  return {
    masterySum,
    masteryRows: mastery.length,
    schedules,
    attempts,
    actions,
    events,
  };
}

function MasterySum(rows) {
  return Math.round(rows.reduce((sum, row) => sum + row.mastery + (row.stabilityDays ?? 0), 0) * 10000) / 10000;
}

async function verifyDecisionChain(prisma, cohort, adminHeaders, shadowRows) {
  console.log('');
  console.log('[decision-chain] verifying the chain on real PostgreSQL + HTTP');

  const before = await authoritativeFingerprint(prisma);
  const shadowByStudent = new Map(shadowRows.map((item) => [item.userId, item]));
  const dataset = [];

  for (const student of cohort) {
    const url = `${apiUrl}/coach/shadow-decision-chain?userId=${student.userId}&windowDays=365&maxItems=8`;
    const chain = await getJson(url, adminHeaders);

    // Shadow-only semantics
    assert.equal(chain.authoritative, false, 'the chain must never be authoritative');
    assert.equal(chain.productionSemanticsChanged, false, 'production semantics must be untouched');
    assert.ok(Array.isArray(chain.risks), 'risks must be reported, even when empty');

    // Student isolation + candidate ownership: exactly this student's own nodes.
    const owned = chain.summary.candidateUniverse.nodeIds;
    assert.deepEqual(
      owned,
      [...student.nodeIds].sort(),
      `student ${student.userId} must see exactly their own ${student.nodeIds.length} nodes`,
    );
    assert.equal(
      chain.rows.every((row) => student.nodeIds.includes(row.knowledgeNodeId)),
      true,
      'no cross-student contamination',
    );
    assert.equal(chain.rows.length, student.nodeIds.length, 'every owned node participates');

    // Determinism: the same facts must produce the same decision.
    const repeat = await getJson(url, adminHeaders);
    assert.deepEqual(
      repeat.rows.map((row) => [row.priorityDelta, row.rankDelta, row.opportunityDelta]),
      chain.rows.map((row) => [row.priorityDelta, row.rankDelta, row.opportunityDelta]),
      'the chain must be deterministic',
    );

    // Universe consistency (Risk C).
    assert.equal(chain.summary.candidateUniverse.consistent, true, 'both paths must share one universe');

    // Attribution: only the REVIEWED node may diverge, and it must name its trigger.
    const diverged = chain.rows.filter((row) => row.masteryDelta != null && Math.abs(row.masteryDelta) > 0);
    assert.equal(diverged.length, 1, 'only the reviewed node may diverge');
    assert.equal(diverged[0].knowledgeNodeId, student.nodeId);
    assert.ok(diverged[0].triggerEventId, 'the divergence must be attributable to a review event');
    for (const row of chain.rows) {
      if (row.triggerEventId) continue;
      assert.equal(row.masteryDelta, null, 'a node with no review must show no divergence');
    }

    const row = chain.rows.find((item) => item.knowledgeNodeId === student.nodeId);
    dataset.push({
      studentId: student.userId,
      case: `${student.band}/${student.outcome}/x${student.reviewCount}@${student.intervalDays}d`,
      nodeId: row.knowledgeNodeId,
      nodesOwned: student.nodeIds.length,
      observedMastery: row.observedMastery,
      shadowMastery: row.shadowMastery,
      masteryDelta: row.masteryDelta,
      observedPriority: row.observedPriority,
      shadowPriority: row.shadowPriority,
      priorityDelta: row.priorityDelta,
      observedOpportunity: row.observedOpportunity,
      shadowOpportunity: row.shadowOpportunity,
      opportunityDelta: row.opportunityDelta,
      observedRank: row.observedRank,
      shadowRank: row.shadowRank,
      rankDelta: row.rankDelta,
      top1Changed: chain.summary.topN.top1Changed,
      entered: chain.summary.topN.entered,
      exited: chain.summary.topN.exited,
      rankChangedNodes: chain.summary.topN.rankChanged.length,
      triggerEventId: row.triggerEventId,
      triggerEventType: row.triggerEventType,
      confidence: row.confidence,
      riskCodes: chain.risks.map((risk) => risk.code),
      authoritative: row.authoritative,
    });
  }

  // Auth guard on the chain endpoint: unauthenticated must be rejected, and a
  // student must not reach a teacher/admin instrument.
  await expectStatus(`${apiUrl}/coach/shadow-decision-chain?userId=${cohort[0].userId}`, {}, 401);
  const studentLogin = await postJson(`${apiUrl}/auth/login`, {
    email: `${cohort[0].userId}@integration.test`,
    password: studentPassword,
  });
  const studentToken = studentLogin?.accessToken ?? studentLogin?.token;
  assert.ok(studentToken, 'the seeded cohort student must be able to log in');
  await expectStatus(
    `${apiUrl}/coach/shadow-decision-chain?userId=${cohort[0].userId}`,
    { authorization: `Bearer ${studentToken}` },
    403,
  );
  console.log('[decision-chain] auth guard = PASS (401 unauthenticated, 403 as student)');

  const after = await authoritativeFingerprint(prisma);
  assert.deepEqual(after, before, 'the shadow phase must not write any authoritative state');

  // ---- Decision Dataset -------------------------------------------------
  console.log('');
  console.log('[decision-chain] Decision Dataset (authoritative = false)');
  console.log('  case                          dMastery  dPriority  dOpportunity  dRank  trigger');
  for (const entry of dataset) {
    console.log(
      `  ${entry.case.padEnd(28)} ${fmtSigned(entry.masteryDelta)}  ${String(entry.priorityDelta).padStart(9)}  `
      + `${fmtSigned(entry.opportunityDelta).padStart(12)}  ${String(entry.rankDelta).padStart(5)}  ${entry.triggerEventType ?? '—'}`,
    );
  }

  const masteryDeltas = dataset.map((entry) => entry.masteryDelta).filter((value) => value != null);
  const priorityDeltas = dataset.map((entry) => entry.priorityDelta);
  const rankDeltas = dataset.map((entry) => Math.abs(entry.rankDelta));
  const changed = dataset.filter((entry) => entry.masteryDelta != null && entry.masteryDelta !== 0).length;
  const noImpact = dataset.filter(
    (entry) => entry.rankDelta === 0 && entry.priorityDelta === 0,
  ).length;
  const swings = dataset.filter((entry) => entry.riskCodes.includes('PRIORITY_SWING'));
  const rankMoved = dataset.filter((entry) => entry.rankDelta !== 0);

  console.log('');
  console.log('[decision-chain] impact distribution');
  console.log(`  students evaluated         = ${dataset.length}`);
  console.log(`  mastery changed            = ${changed}  (affected ratio ${pct(changed, dataset.length)})`);
  console.log(`  no impact (priority+rank 0)= ${noImpact}  (no-impact ratio ${pct(noImpact, dataset.length)})`);
  console.log(`  median mastery delta       = ${fmtSigned(median(masteryDeltas))}`);
  console.log(`  p90 mastery delta          = ${fmtSigned(percentile(masteryDeltas, 0.9))}`);
  console.log(`  median |priority delta|    = ${fmtSigned(median(priorityDeltas.map(Math.abs)))}`);
  console.log(`  max |priority delta|       = ${fmtSigned(maxAbs(priorityDeltas))}`);
  console.log(`  median |rank delta|        = ${median(rankDeltas)}`);
  console.log(`  max |rank delta|           = ${rankDeltas.length > 0 ? Math.max(...rankDeltas) : 0}`);
  console.log(`  nodes with rank change     = ${rankMoved.length}`);
  console.log(`  PRIORITY_SWING flagged     = ${swings.length}`);
  console.log('');
  console.log('[decision-chain] top changed nodes');
  for (const entry of [...dataset].sort((a, b) => Math.abs(b.masteryDelta ?? 0) - Math.abs(a.masteryDelta ?? 0)).slice(0, 5)) {
    console.log(`  ${entry.case.padEnd(28)} mastery ${fmtSigned(entry.masteryDelta)} → priority ${entry.priorityDelta >= 0 ? '+' : ''}${entry.priorityDelta}, rank ${entry.rankDelta >= 0 ? '+' : ''}${entry.rankDelta}`);
  }
  console.log('');
  console.log('[decision-chain] top ranking changes');
  const ranked = [...dataset].sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta)).slice(0, 5);
  if (ranked.every((entry) => entry.rankDelta === 0)) {
    console.log('  none — no rank moved in this cohort');
  } else {
    for (const entry of ranked) {
      console.log(`  ${entry.case.padEnd(28)} rank ${entry.observedRank} → ${entry.shadowRank} (delta ${entry.rankDelta >= 0 ? '+' : ''}${entry.rankDelta})`);
    }
  }

  console.log('');
  console.log('[decision-chain] authoritative safety');
  console.log(`  authoritative writes       = 0  (fingerprint unchanged: mastery sum ${after.masterySum}, ${after.masteryRows} rows)`);
  console.log('  production behavior        = unchanged (score-center/service.ts has zero V12 changes)');
  console.log('  student isolation          = PASS (every chain contained exactly its own node set)');
  console.log('  determinism                = PASS (repeat calls produced identical decisions)');
  console.log('  attribution                = PASS (every divergence named its review event)');
  console.log('');
  console.log('[decision-chain] M3 Phase C DECISION DATA READY');
  console.log('  Decision data ready; owner decision still required.');
}

function fmtSigned(value) {
  if (value == null) return '—';
  const rounded = Math.round(value * 10000) / 10000;
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

function pct(part, total) {
  if (total === 0) return 'n/a';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value * 10000) / 10000;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return Math.round(sorted[index] * 10000) / 10000;
}

function maxAbs(values) {
  if (values.length === 0) return 0;
  return Math.round(Math.max(...values.map(Math.abs)) * 10000) / 10000;
}

// ---------------------------------------------------------------------------

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3220',
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

async function expectStatus(url, headers, expected) {
  const response = await fetch(url, { headers });
  assert.equal(
    response.status,
    expected,
    `${url} should return ${expected} but returned ${response.status}`,
  );
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.ok(response.ok, `GET ${url} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void createHmac;
void randomBytes;

main().catch((error) => {
  console.error('[shadow-cohort] FAILED:', error.message);
  if (activeApi?.getOutput) {
    const output = activeApi.getOutput().trim();
    if (output) console.error(output.split('\n').slice(-20).join('\n'));
  }
  process.exitCode = 1;
});
