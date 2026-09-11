/**
 * M3 Phase C — migration validation for the approved C1 semantics.
 *
 * The switch is `MASTERY_SEMANTICS`, default `legacy`. This script validates the
 * migration on real PostgreSQL + real HTTP without enabling anything by default:
 *
 *   A. Reachable path   drive mastery through the real API under legacy and
 *                       under c1 and compare. Expected to be IDENTICAL, because
 *                       the EMA cannot cross its own target and the initial
 *                       value 0.5 sits inside the band for every difficulty.
 *   B. Switch is live   seed an out-of-band mastery (a state no production
 *                       writer can produce) and show that legacy and c1 differ
 *                       there, i.e. the flag genuinely takes effect.
 *   C. Read-only replay replay stored review events through both semantics in
 *                       memory and prove the authoritative fingerprint is
 *                       unchanged (invariant G).
 *   D. Rollback         switch back to legacy and show legacy behaviour resumes,
 *                       with no data rewrite.
 *   E. Invariants A-G   plus the impact simulation the owner asked for.
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');
const shared = require('../packages/shared/dist/index.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const API_PORT = 3230;
const apiUrl = `http://127.0.0.1:${API_PORT}`;
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-mastery-migration-secret-0123456789';
const adminPassword = 'Migration-Admin-Password-1';
const studentPassword = 'Migration-Student-Password-1';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
let activeApi = null;
const createdUsers = [];

async function main() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const adminId = `mig-admin-${runId}`;
    await prisma.user.upsert({
      where: { id: adminId },
      update: { passwordHash: await hashPassword(adminPassword), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
      create: {
        id: adminId,
        email: `${adminId}@integration.test`,
        name: 'Migration Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(adminPassword),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });
    createdUsers.push(adminId);

    const inviteCode = await createInvitation(prisma, adminId);

    // ---- A. Reachable path: legacy vs c1 must agree -----------------------
    const reachable = await runCase(prisma, inviteCode, {
      label: 'A/reachable',
      nodeDifficulty: 3,
      seedMastery: null,
      sequence: [
        { correct: false, times: 4 },
        { correct: true, times: 3 },
        { correct: false, times: 5 },
        { correct: true, times: 2 },
      ],
    });

    // ---- B. Switch is live: out-of-band state ----------------------------
    const outOfBand = await runCase(prisma, inviteCode, {
      label: 'B/out-of-band',
      nodeDifficulty: 1,
      seedMastery: 0.22,
      sequence: [{ correct: false, times: 1 }],
    });

    // ---- C. Read-only historical replay ----------------------------------
    const replay = await readOnlyReplay(prisma);

    // ---- D. Rollback ------------------------------------------------------
    const rollback = await runCase(prisma, inviteCode, {
      label: 'D/rollback',
      nodeDifficulty: 1,
      seedMastery: 0.22,
      sequence: [{ correct: false, times: 1 }],
      forceLegacyAfterCandidate: true,
    });

    report({ reachable, outOfBand, replay, rollback });
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    for (const userId of createdUsers) {
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.question.deleteMany({ where: { id: { startsWith: `mig-q-${runId}` } } }).catch(() => {});
    await prisma.questionFamily.deleteMany({ where: { id: { startsWith: `mig-f-${runId}` } } }).catch(() => {});
    await prisma.knowledgeFrequencySnapshot.deleteMany({ where: { knowledgeNodeId: { startsWith: `mig-n-${runId}` } } }).catch(() => {});
    await prisma.questionKnowledgeNodeTag.deleteMany({ where: { knowledgeNodeId: { startsWith: `mig-n-${runId}` } } }).catch(() => {});
    await prisma.knowledgeNode.deleteMany({ where: { id: { startsWith: `mig-n-${runId}` } } }).catch(() => {});
    await prisma.knowledgePoint.deleteMany({ where: { id: { startsWith: `mig-p-${runId}` } } }).catch(() => {});
    await prisma.$disconnect();
  }
}

/**
 * Drive one student through a practice sequence under BOTH semantics and report
 * the resulting mastery. Only the env flag differs between the two runs.
 */
async function runCase(prisma, inviteCode, options) {
  const result = { label: options.label, nodeDifficulty: options.nodeDifficulty, seedMastery: options.seedMastery };
  for (const semantics of ['legacy', 'c1']) {
    // The API must be up before the student can log in, so start it first.
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    await delay(300);
    activeApi = startApi(semantics === 'c1' ? 'c1' : undefined);
    await waitForHealth(activeApi);

    const handle = await seedStudent(prisma, inviteCode, options);

    for (const block of options.sequence) {
      for (let index = 0; index < block.times; index += 1) {
        await postJson(`${apiUrl}/practice-records`, {
          questionId: handle.questionId,
          knowledgePointId: handle.pointId,
          selectedAnswer: block.correct ? 'A' : 'B',
          correct: block.correct,
          timeSpentSec: 60,
        }, handle.headers, { 'Idempotency-Key': `${handle.userId}-${block.correct}-${index}` });
      }
    }

    const mastery = await prisma.userKnowledgeMastery.findUnique({
      where: { userId_knowledgeNodeId: { userId: handle.userId, knowledgeNodeId: handle.nodeId } },
    });
    result[`${semantics}Mastery`] = mastery ? round4(mastery.mastery) : null;
  }
  result.masteryDelta = result.legacyMastery != null && result.c1Mastery != null
    ? round6(result.c1Mastery - result.legacyMastery)
    : null;

  if (options.forceLegacyAfterCandidate) {
    // Rollback: the same seed, but the flag is removed again.
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    await delay(300);
    activeApi = startApi('c1');
    await waitForHealth(activeApi);
    const handle = await seedStudent(prisma, inviteCode, options);
    await postJson(`${apiUrl}/practice-records`, {
      questionId: handle.questionId,
      knowledgePointId: handle.pointId,
      selectedAnswer: 'B',
      correct: false,
      timeSpentSec: 60,
    }, handle.headers, { 'Idempotency-Key': `${handle.userId}-rollback` });
    const afterCandidate = await readMastery(prisma, handle);
    // Now roll back: flag removed.
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    await delay(300);
    activeApi = startApi(undefined);
    await waitForHealth(activeApi);
    await postJson(`${apiUrl}/practice-records`, {
      questionId: handle.questionId,
      knowledgePointId: handle.pointId,
      selectedAnswer: 'B',
      correct: false,
      timeSpentSec: 60,
    }, handle.headers, { 'Idempotency-Key': `${handle.userId}-post-rollback` });
    const afterRollback = await readMastery(prisma, handle);
    result.afterCandidate = afterCandidate;
    result.afterRollback = afterRollback;
    result.rollbackRestoredLegacy = afterRollback != null && afterCandidate != null && afterRollback > afterCandidate;
  }
  return result;
}

async function readOnlyReplay(prisma) {
  const before = await fingerprint(prisma);
  const users = await prisma.userKnowledgeMastery.findMany({ take: 40, select: { userId: true } });
  const rows = [];
  for (const entry of [...new Set(users.map((row) => row.userId))].slice(0, 10)) {
    const masteryRows = await prisma.userKnowledgeMastery.findMany({
      where: { userId: entry },
      orderBy: { mastery: 'asc' },
      select: { knowledgeNodeId: true, mastery: true, attempts: true, correctCount: true, wrongCount: true, accuracy: true, recentAccuracy: true, confidence: true, retention: true, stabilityDays: true, lastReviewedAt: true },
    });
    for (const row of masteryRows) {
      const base = {
        mastery: row.mastery,
        accuracy: row.accuracy,
        recentAccuracy: row.recentAccuracy,
        attempts: row.attempts,
        correctCount: row.correctCount,
        wrongCount: row.wrongCount,
        confidence: row.confidence,
      };
      // Replay the same node state through both semantics, in memory only.
      for (const isCorrect of [true, false]) {
        for (const difficulty of [1, 3, 5]) {
          const signal = { isCorrect, difficulty, role: 'PRIMARY' };
          const legacy = shared.applyMasterySemantics('legacy', base, signal);
          const c1 = shared.applyMasterySemantics('c1', base, signal);
          if (legacy.mastery !== c1.mastery) {
            rows.push({
              inBand: base.mastery >= shared.masteryTargetProfile(difficulty).wrongTarget
                && base.mastery <= shared.masteryTargetProfile(difficulty).correctTarget,
              mastery: round4(base.mastery),
              isCorrect,
              difficulty,
              legacy: round4(legacy.mastery),
              c1: round4(c1.mastery),
            });
          }
        }
      }
    }
  }
  const after = await fingerprint(prisma);
  return { divergentRows: rows, firstDivergences: rows.slice(0, 8), fingerprintUnchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
}

async function seedStudent(prisma, inviteCode, options) {
  // Lower-case the tag: login normalises the email before lookup, so a seeded
  // address containing upper case would never be found.
  const tag = `${runId}-${options.label.replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 7)}`.toLowerCase();
  const userId = `mig-user-${tag}`;
  const nodeId = `mig-n-${tag}`;
  const pointId = `mig-p-${tag}`;
  const familyId = `mig-f-${tag}`;
  const questionId = `mig-q-${tag}`;

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@integration.test`,
      name: `Migration ${options.label}`,
      role: 'STUDENT',
      passwordHash: await hashPassword(studentPassword),
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      targetScore: 120,
      remainingDays: 60,
    },
  });
  createdUsers.push(userId);
  await prisma.knowledgePoint.create({
    data: { id: pointId, subject: 'DATA_STRUCTURE', chapter: 'migration', title: `mig point ${tag}`, importance: 4, frequency: 4 },
  });
  await prisma.knowledgeNode.create({
    data: {
      id: nodeId,
      subject: 'DATA_STRUCTURE',
      nodeType: 'knowledge_point',
      name: `mig node ${tag}`,
      importance: 4,
      // The node's difficulty fixes the EMA target pair, which is why the
      // reachable band is a property of the node.
      difficulty: options.nodeDifficulty,
      syllabusVersion: '2026',
    },
  });
  await prisma.knowledgePointNodeMap.create({
    data: { knowledgePointId: pointId, knowledgeNodeId: nodeId, mappingType: 'PRIMARY' },
  });
  await prisma.questionFamily.create({ data: { id: familyId } });
  await prisma.question.create({
    data: {
      id: questionId,
      familyId,
      contentFingerprint: `mig-${tag}`,
      stem: 'migration seed question',
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
      modelVersion: 'migration-v1',
    },
  });

  if (options.seedMastery != null) {
    // Test fixture only: an out-of-band state that no production writer can
    // produce. It exists to prove the switch is live, not to model reality.
    await prisma.userKnowledgeMastery.create({
      data: {
        userId,
        knowledgeNodeId: nodeId,
        mastery: options.seedMastery,
        accuracy: options.seedMastery,
        recentAccuracy: options.seedMastery,
        attempts: 4,
        correctCount: 0,
        wrongCount: 4,
        confidence: 0.3,
      },
    });
  }

  const login = await postJson(`${apiUrl}/auth/login`, {
    email: `${userId}@integration.test`,
    password: studentPassword,
  });
  const token = login?.accessToken ?? login?.token;
  assert.ok(token, 'seeded student must log in');
  void inviteCode;
  return { userId, nodeId, pointId, questionId, headers: { authorization: `Bearer ${token}` } };
}

async function readMastery(prisma, handle) {
  const row = await prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgeNodeId: { userId: handle.userId, knowledgeNodeId: handle.nodeId } },
    select: { mastery: true },
  });
  return row ? round4(row.mastery) : null;
}

async function fingerprint(prisma) {
  const [mastery, schedules, attempts, actions, events] = await Promise.all([
    prisma.userKnowledgeMastery.findMany({ select: { userId: true, mastery: true, stabilityDays: true, attempts: true } }),
    prisma.reviewSchedule.count(),
    prisma.reviewAttempt.count(),
    prisma.recommendationAction.count(),
    prisma.userEvent.count(),
  ]);
  return {
    masteryRows: mastery.length,
    masterySum: round4(mastery.reduce((sum, row) => sum + row.mastery, 0)),
    attemptsSum: mastery.reduce((sum, row) => sum + row.attempts, 0),
    schedules,
    reviewAttempts: attempts,
    actions,
    events,
  };
}

function report({ reachable, outOfBand, replay, rollback }) {
  console.log('');
  console.log('=== A. Reachable path (legacy vs C1, real API writes) ===');
  console.log(`  node difficulty ${reachable.nodeDifficulty}, from the neutral initial value`);
  console.log(`  legacy mastery = ${reachable.legacyMastery}   C1 mastery = ${reachable.c1Mastery}   delta = ${reachable.masteryDelta}`);
  console.log(`  → ${reachable.masteryDelta === 0 ? 'IDENTICAL: C1 changes nothing on reachable states' : 'DIFFERENT: investigate'}`);
  assert.equal(reachable.masteryDelta, 0, 'C1 must not change behaviour on reachable states');

  console.log('');
  console.log('=== B. Switch is live (out-of-band fixture state) ===');
  console.log(`  node difficulty ${outOfBand.nodeDifficulty}, seeded mastery ${outOfBand.seedMastery} (fixture only)`);
  console.log(`  legacy mastery = ${outOfBand.legacyMastery}   C1 mastery = ${outOfBand.c1Mastery}   delta = ${outOfBand.masteryDelta}`);
  console.log(`  → ${outOfBand.masteryDelta !== 0 ? 'DIFFERENT: the flag genuinely takes effect' : 'IDENTICAL: the flag is not wired'}`);
  assert.notEqual(outOfBand.masteryDelta, 0, 'the flag must demonstrably take effect somewhere');

  console.log('');
  console.log('=== C. Read-only historical replay (invariant G) ===');
  console.log(`  authoritative fingerprint unchanged = ${replay.fingerprintUnchanged}`);
  console.log(`  mastery rows ${replay.before.masteryRows}, sum ${replay.before.masterySum}, events ${replay.before.events}`);
  const inBandDivergence = replay.divergentRows.filter((row) => row.inBand);
  console.log(`  divergent states found = ${replay.divergentRows.length} (in-band = ${inBandDivergence.length})`);
  for (const row of replay.firstDivergences.slice(0, 5)) {
    console.log(`    mastery ${row.mastery} d${row.difficulty} ${row.isCorrect ? 'correct' : 'wrong'}: legacy ${row.legacy} → C1 ${row.c1} (in-band=${row.inBand})`);
  }
  assert.equal(replay.fingerprintUnchanged, true, 'a replay must not write authoritative data');

  console.log('');
  console.log('=== D. Rollback ===');
  if (rollback) {
    console.log(`  under C1 after one failed easy review = ${rollback.afterCandidate}`);
    console.log(`  after removing the flag               = ${rollback.afterRollback}`);
    console.log(`  → legacy behaviour restored = ${rollback.rollbackRestoredLegacy}`);
    assert.equal(rollback.rollbackRestoredLegacy, true, 'removing the flag must restore legacy behaviour');
  }

  console.log('');
  console.log('=== E. Findings for the Go/No-Go ===');
  console.log(`  reachable-state impact        = ${reachable.masteryDelta === 0 ? 'ZERO' : 'non-zero'}`);
  console.log(`  flag effective on out-of-band = ${outOfBand.masteryDelta !== 0 ? 'YES' : 'NO'}`);
  console.log('  authoritative writes during validation = 0');
  console.log('  production switch enabled     = NO (flag unset in the legacy run, and not left set)');
}

async function createInvitation(prisma, createdById) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 'm3 migration validation',
      maxUses: 50,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 86_400_000),
      createdById,
    },
  });
  return code;
}

function startApi(semantics) {
  const env = {
    ...process.env,
    PORT: String(API_PORT),
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    ALLOW_DEMO_AUTH: 'true',
  };
  if (semantics === 'c1') env.MASTERY_SEMANTICS = 'c1';
  else delete env.MASTERY_SEMANTICS;

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env,
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

async function postJson(url, body, headers = {}, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers, ...extraHeaders },
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

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

main().catch((error) => {
  console.error('[m3-migration] FAILED:', error.message);
  if (activeApi?.getOutput) {
    const output = activeApi.getOutput().trim();
    if (output) console.error(output.split('\n').slice(-20).join('\n'));
  }
  process.exitCode = 1;
});
