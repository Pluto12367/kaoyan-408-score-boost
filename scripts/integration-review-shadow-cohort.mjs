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
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;

/** Pre-registered switch criteria (documented before any of this was measured). */
const PREREGISTERED = { minDirectionAgreement: 0.7, minObservations: 30 };

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
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    // Clean up only this run's throwaway students and content.
    const userIds = cohort.map((student) => student.userId);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => {});
    for (const student of cohort) {
      await prisma.question.deleteMany({ where: { id: student.questionId } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: student.familyId } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: student.nodeId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

async function seedStudent(prisma, { band, outcome, reviewCount, intervalDays }) {
  const tag = `${runId}-${band.label}-${outcome}-${reviewCount}-${intervalDays}`;
  const userId = `cohort-user-${tag}`;
  const nodeId = `cohort-node-${tag}`;
  const familyId = `cohort-family-${tag}`;
  const questionId = `cohort-question-${tag}`;
  const now = Date.now();

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@integration.test`,
      name: `Cohort ${band.label} ${outcome}`,
      role: 'STUDENT',
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      targetScore: 120,
    },
  });
  await prisma.knowledgeNode.create({
    data: {
      id: nodeId,
      subject: 'DATA_STRUCTURE',
      nodeType: 'knowledge_point',
      name: `cohort node ${tag}`,
      importance: 4,
      difficulty: 3,
      syllabusVersion: '2026',
    },
  });
  await prisma.questionFamily.create({ data: { id: familyId } });
  await prisma.question.create({
    data: {
      id: questionId,
      familyId,
      contentFingerprint: `cohort-${tag}`,
      stem: 'cohort seed question',
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

  // The stored mastery the shadow will compare its replay against.
  await prisma.userKnowledgeMastery.create({
    data: {
      userId,
      knowledgeNodeId: nodeId,
      mastery: band.mastery,
      accuracy: band.mastery,
      recentAccuracy: band.mastery,
      attempts: 4,
      correctCount: Math.round(4 * band.mastery),
      wrongCount: 4 - Math.round(4 * band.mastery),
      confidence: 0.3,
      retention: 1,
      stabilityDays: 1.7,
      lastReviewedAt: new Date(now - intervalDays * DAY),
    },
  });

  // A baseline snapshot dated before the first review, so the replay has a
  // starting point instead of falling back to neutral.
  await prisma.userMasterySnapshot.create({
    data: {
      userId,
      knowledgeNodeId: nodeId,
      mastery: band.mastery,
      attempts: 4,
      correctCount: Math.round(4 * band.mastery),
      wrongCount: 4 - Math.round(4 * band.mastery),
      snapshotDate: new Date(now - (reviewCount * intervalDays + 2) * DAY),
    },
  });

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
    const correct = outcome === 'all_correct'
      ? true
      : outcome === 'all_wrong'
        ? false
        : attempt % 2 === 0;
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

  return { userId, nodeId, questionId, familyId, band: band.label, outcome, reviewCount, intervalDays };
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
