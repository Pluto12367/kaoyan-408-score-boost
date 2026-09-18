/**
 * Browser-verification seeder (dev/test only) — creates ONE student with data
 * behind all four learning-insight projections, then leaves everything in
 * place so a human or a browser session can log in and see the card.
 *
 * Prints the credentials and the exact cleanup SQL. Run against the TEST
 * database only; it refuses to run when NODE_ENV=production.
 */

import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
process.env.DATABASE_URL = databaseUrl;
const apiUrl = process.env.SEED_API_URL ?? 'http://127.0.0.1:3000';
const jwtSecret = process.env.JWT_SECRET ?? 'browser-verify-secret-0123456789';

// Two phases: the paper repository hydrates once at API boot, so DB fixtures
// must exist BEFORE the API starts, and the HTTP journey runs after.
const phase = process.argv.includes('--fixtures-only') ? 'fixtures'
  : process.argv.includes('--http-only') ? 'http' : 'all';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV=production.');
  process.exit(1);
}

// Reusable across phases: pass SEED_RUN_ID to run --http-only against the
// fixtures created by a previous --fixtures-only pass.
const runId = process.env.SEED_RUN_ID ?? randomUUID().slice(0, 8);
const password = 'BrowserVerify-Password-1';
const email = `browser-verify-${runId}@integration.test`;
const ids = { admin: `bv-admin-${runId}`, node: `bv-node-${runId}`, point: `bv-point-${runId}`, paper: `bv-paper-${runId}` };
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${url} → ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return response.json();
}

try {
  if (phase !== 'http') {
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'BV Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 操作（演示）${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'OPERATING_SYSTEM', chapter: '进程管理', title: '进程同步与互斥（演示）',
      importance: 5, frequency: 5, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  const questions = ['a', 'b', 'c', 'd'].map((suffix) => `bv-q-${suffix}-${runId}`);
  for (const [index, id] of questions.entries()) {
    await prisma.questionFamily.create({ data: { id: `bv-fam-${id}` } });
    await prisma.question.create({
      data: {
        id, familyId: `bv-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
        stem: `演示题 ${index + 1}：关于进程同步与 PV 操作`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: '演示解析。',
        difficulty: index < 2 ? 'BASIC' : 'MEDIUM', type: 'SINGLE_CHOICE', source: 'demo-seed',
        expectedTimeSec: 60, questionSubtype: 'OS_PV', maxScore: 2,
      },
    });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  }
  await prisma.paper.create({
    data: {
      id: ids.paper, title: '演示卷（浏览器验证）', paperType: '模拟卷', questionCount: 4,
      knowledgePointIds: [ids.point],
      questions: questions.map((id, index) => ({ id, stem: `演示题 ${index + 1}：关于进程同步与 PV 操作`, type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: '演示解析。' })),
      estimatedMinutes: 10, createdBy: ids.admin,
    },
  });

  }
  if (phase === 'fixtures') {
    console.log('FIXTURES READY — restart the API, then run with --http-only.');
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }
  // In --http-only mode the fixture ids are deterministic from runId, so the
  // same question list is derivable without re-creating fixtures.
  const questionIds = phase === 'http'
    ? ['a', 'b', 'c', 'd'].map((suffix) => `bv-q-${suffix}-${runId}`)
    : questions;
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'browser verify', maxUses: 2,
      startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 86_400_000), createdById: ids.admin,
    },
  });
  // Idempotent across re-runs: an existing student (from an interrupted run) is
  // reused by logging in rather than failing on "email already registered".
  let student;
  try {
    const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: '演示学生', inviteCode: invite });
    student = registered?.user?.id ?? registered?.id;
    await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  } catch (error) {
    if (!String(error?.message ?? '').includes('already registered')) throw error;
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    assert.ok(existing, 'existing student must be resolvable by email');
    student = existing.id;
  }
  const headers = { authorization: `Bearer ${(await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken}` };

  await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: 2027, targetScore: 110, currentScore: 62, remainingDays: 120, dailyHours: 3, weakestSubject: '操作系统',
  }, headers);

  for (const [index, id] of questionIds.entries()) {
    await postJson(`${apiUrl}/practice-records`, {
      questionId: id, knowledgePointId: ids.point, selectedAnswer: 'X', timeSpentSec: 60,
    }, { ...headers, 'idempotency-key': `bv-${runId}-${id}` });
  }
  await postJson(`${apiUrl}/wrong-questions/${questionIds[0]}/reason`, {
    controlledReason: 'calculation_error', redoCorrect: false, timeSpentSec: 60, isReview: false,
    idempotencyKey: `bv-report-${runId}`,
  }, headers);
  await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: questionIds.map((id) => ({ questionId: id, selectedAnswer: 'X', timeSpentSec: 30 })),
  }, headers);
  await postJson(`${apiUrl}/practice-records`, {
    questionId: questionIds[0], knowledgePointId: ids.point, selectedAnswer: 'A', timeSpentSec: 30,
  }, { ...headers, 'idempotency-key': `bv-retry-${runId}` });

  const [prescription, forgetting, recovery] = await Promise.all([
    fetch(`${apiUrl}/coach/training-prescription?days=7`, { headers }).then((r) => r.json()),
    fetch(`${apiUrl}/coach/forgetting-risk`, { headers }).then((r) => r.json()),
    fetch(`${apiUrl}/coach/score-recovery?days=30`, { headers }).then((r) => r.json()),
  ]);
  assert.ok(prescription.target, 'prescription target exists');
  assert.ok(recovery.summary.questions > 0, 'recovery has questions');

  console.log('SEEDED');
  console.log(`email=${email}`);
  console.log(`password=${password}`);
  console.log(`student=${student} node=${ids.node}`);
  console.log(`prescription ladder=${prescription.ladder.length} forgetting=${forgetting.rows.length} recovery questions=${recovery.summary.questions}`);
  console.log('CLEANUP SQL:');
  console.log(`DELETE FROM "InvitationRedemption" WHERE "userId" = '${student}';`);
  console.log(`DELETE FROM "InvitationCode" WHERE "createdById" = '${ids.admin}';`);
  console.log(`DELETE FROM "User" WHERE id IN ('${student}','${ids.admin}');`);
  console.log(`DELETE FROM "Question" WHERE "familyId" LIKE 'bv-fam-%';`);
  console.log(`DELETE FROM "QuestionFamily" WHERE id LIKE 'bv-fam-%';`);
  console.log(`DELETE FROM "Paper" WHERE id = '${ids.paper}';`);
  console.log(`DELETE FROM "KnowledgePoint" WHERE id = '${ids.point}';`);
  console.log(`DELETE FROM "KnowledgeNode" WHERE id = '${ids.node}';`);
} catch (error) {
  console.error('SEED FAILED:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
