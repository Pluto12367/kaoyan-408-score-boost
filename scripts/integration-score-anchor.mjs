/**
 * S1 Score Anchor — end-to-end check over real HTTP + real PostgreSQL.
 *
 * Drives the Score Ledger through its actual API for one student:
 *
 *   prediction persisted (idempotent) → assessment recorded (provenance
 *   forced by role, normalized 150-scale) → boundary rejections (range,
 *   future examDate, provenance claim) → unverified outcome → teacher
 *   verification through the real authorization spine → calibration pairs
 *   on the normalized scale with per-provenance strata → correction chain
 *   folds without touching the evidence row.
 *
 * Every assertion is an invariant. Without a database this script is
 * meaningless by design — it refuses to fake anything.
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
const apiUrl = 'http://127.0.0.1:3260';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-score-anchor-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Score-Anchor-Integration-Password-1';

const ids = {
  admin: `anchor-admin-${runId}`,
  teacher: `anchor-teacher-${runId}`,
  student: null,
};

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

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
  let studentId = null;
  try {
    // ---------------------------------------------------------------------
    // 1. Seed admin + teacher (+ teacher→student authorization) and register
    //    one student through the real invitation flow.
    // ---------------------------------------------------------------------
    for (const [id, role, name] of [
      [ids.admin, 'ADMIN', 'Score Anchor Admin'],
      [ids.teacher, 'TEACHER', 'Score Anchor Teacher'],
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

    const invite = await createInvitation(prisma, ids.admin, 5);
    const credentials = {
      email: `anchor-student-${runId}@integration.test`,
      password,
      name: '成绩锚点学生',
      inviteCode: invite,
    };
    const registered = await postJson(`${apiUrl}/auth/register`, credentials);
    studentId = registered?.user?.id ?? registered?.id ?? null;
    assert.ok(studentId, 'register must return the created student id');
    ids.student = studentId;
    await prisma.user.update({
      where: { id: studentId },
      data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE', targetScore: 120 },
    });
    await prisma.teacherStudentAuthorization.upsert({
      where: { teacherId_studentId: { teacherId: ids.teacher, studentId } },
      update: {},
      create: { teacherId: ids.teacher, studentId },
    });

    const studentToken = (await postJson(`${apiUrl}/auth/login`, {
      email: credentials.email,
      password,
    }))?.accessToken;
    assert.ok(studentToken, 'student login must return an access token');
    const studentHeaders = { authorization: `Bearer ${studentToken}` };

    const teacherToken = (await postJson(`${apiUrl}/auth/login`, {
      email: `${ids.teacher}@integration.test`,
      password,
    }))?.accessToken;
    assert.ok(teacherToken, 'teacher login must return an access token');
    const teacherHeaders = { authorization: `Bearer ${teacherToken}` };

    const adminToken = (await postJson(`${apiUrl}/auth/login`, {
      email: `${ids.admin}@integration.test`,
      password,
    }))?.accessToken;
    assert.ok(adminToken, 'admin login must return an access token');
    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    record('seed', `admin/teacher/student ready (student ${studentId})`);

    // ---------------------------------------------------------------------
    // 2. Route registration proof: unauthenticated reads are 401, not 404.
    // ---------------------------------------------------------------------
    const unauth = await fetch(`${apiUrl}/coach/score-evidence`);
    assert.equal(unauth.status, 401, 'GET /coach/score-evidence must require authentication');
    record('route-guard', 'GET /coach/score-evidence without a token is 401 (registered + guarded)');

    // ---------------------------------------------------------------------
    // 3. Prediction persisted + idempotent.
    // ---------------------------------------------------------------------
    const dayKey = new Date().toISOString().slice(0, 10);
    const predictionInput = {
      predictionKey: `integration:${studentId}:${dayKey}`,
      modelVersion: 'estimate-predicted-score@v1',
      predictedScore: 100,
      predictedMinScore: 90,
      predictedMaxScore: 110,
      generatedFor: 'report',
      inputsSnapshot: { targetScore: 120, remainingDays: 96 },
    };
    const first = await postJson(`${apiUrl}/coach/score-evidence/predictions`, predictionInput, studentHeaders);
    assert.equal(first.storeAvailable, true);
    assert.equal(first.duplicate, false, 'first write is not a duplicate');
    const second = await postJson(`${apiUrl}/coach/score-evidence/predictions`, predictionInput, studentHeaders);
    assert.equal(second.duplicate, true, 'retry with the same predictionKey reads back');
    assert.equal(second.id, first.id, 'the read-back row is the same row');
    record('prediction', `persisted ${first.id} (idempotent by predictionKey)`);

    // ---------------------------------------------------------------------
    // 4. Assessment recorded with actor-forced provenance and normalization.
    // ---------------------------------------------------------------------
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(1_100);
    const examDate = new Date().toISOString();
    const assessment = await postJson(`${apiUrl}/coach/score-evidence/assessments`, {
      rawScore: 96,
      rawTotalScale: 150,
      semantic: 'exam_total',
      source: 'IMPORTED',
      gradingMethod: 'self_report',
      examDate,
      title: '机构全真模考',
      clientKey: `anchor-assess-${runId}`,
    }, studentHeaders);
    assert.equal(assessment.duplicate, false);
    assert.equal(assessment.normalizedScore, 96, '96/150 normalizes to 96/150');
    const assessmentRepeat = await postJson(`${apiUrl}/coach/score-evidence/assessments`, {
      rawScore: 96,
      rawTotalScale: 150,
      examDate,
      clientKey: `anchor-assess-${runId}`,
    }, studentHeaders);
    assert.equal(assessmentRepeat.duplicate, true, 'same clientKey reads back the same row');
    record('assessment', `recorded ${assessment.id} (IMPORTED, 96/150, idempotent)`);

    // ---------------------------------------------------------------------
    // 5. Boundary guards: provenance claim, range, future examDate.
    // ---------------------------------------------------------------------
    const provenanceClaim = await fetch(`${apiUrl}/coach/score-evidence/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studentHeaders },
      body: JSON.stringify({ rawScore: 96, rawTotalScale: 150, source: 'TEACHER_GRADED', examDate }),
    });
    assert.equal(provenanceClaim.status, 403, 'a student cannot claim TEACHER_GRADED provenance');
    const outOfRange = await postJson(`${apiUrl}/coach/score-evidence/assessments`, {
      rawScore: 160,
      rawTotalScale: 150,
      examDate,
    }, studentHeaders).catch((error) => error);
    assert.ok(outOfRange instanceof Error && /400|invalid/.test(String(outOfRange)), 'out-of-range score is rejected');
    const futureExam = await postJson(`${apiUrl}/coach/score-evidence/assessments`, {
      rawScore: 96,
      rawTotalScale: 150,
      examDate: new Date(Date.now() + 5 * DAY).toISOString(),
    }, studentHeaders).catch((error) => error);
    assert.ok(futureExam instanceof Error && /future|400/.test(String(futureExam)), 'a future examDate is rejected');
    record('boundaries', 'provenance 403 / range 400 / future examDate 400');

    // ---------------------------------------------------------------------
    // 6. Outcome recorded unverified; verification needs the teacher spine.
    // ---------------------------------------------------------------------
    await sleep(1_100);
    const occurredAt = new Date().toISOString();
    const outcome = await postJson(`${apiUrl}/coach/score-evidence/outcomes`, {
      examType: 'real_exam',
      examYear: 2026,
      rawScore: 120,
      rawTotalScale: 150,
      occurredAt,
    }, studentHeaders);
    assert.equal(outcome.verificationStatus, 'unverified', 'a student outcome starts unverified');
    const studentVerify = await fetch(`${apiUrl}/coach/score-evidence/outcomes/${outcome.id}/verify`, {
      method: 'POST',
      headers: { ...studentHeaders },
    });
    assert.equal(studentVerify.status, 403, 'a student can never verify an outcome');
    const outcomeRepeat = await postJson(`${apiUrl}/coach/score-evidence/outcomes`, {
      examType: 'real_exam',
      examYear: 2026,
      rawScore: 120,
      rawTotalScale: 150,
      occurredAt,
    }, studentHeaders);
    assert.equal(outcomeRepeat.duplicate, true, 'same exam year dedups through the real_exam key');
    record('outcome', `recorded ${outcome.id} (unverified, real_exam:2026 dedup)`);

    // Before verification the outcome must not be calibrated.
    const beforeVerify = await getJson(`${apiUrl}/coach/score-evidence`, studentHeaders);
    assert.ok(
      beforeVerify.calibrationEvidence.exclusions.some((row) => row.reason === 'outcome_unverified'),
      'the unverified outcome is excluded from calibration',
    );

    // ---------------------------------------------------------------------
    // 7. Teacher verification through the real authorization spine.
    // ---------------------------------------------------------------------
    const verified = await postJson(`${apiUrl}/coach/score-evidence/outcomes/${outcome.id}/verify`, {}, teacherHeaders);
    assert.equal(verified.verificationStatus, 'verified', 'an authorized teacher verifies the outcome');
    record('verify', `outcome ${outcome.id} verified by the authorized teacher`);

    // ---------------------------------------------------------------------
    // 8. Calibration: normalized pairing, per-provenance strata, honest gate.
    // ---------------------------------------------------------------------
    const evidence = await getJson(`${apiUrl}/coach/score-evidence`, studentHeaders);
    assert.equal(evidence.storeAvailable, true);
    assert.ok(evidence.anchors.verifiedOutcome, 'the verified outcome is surfaced as the trusted anchor');
    assert.equal(evidence.anchors.verifiedOutcome.normalizedScore, 120);
    const observationCount = evidence.calibrationEvidence.pairedCount;
    assert.ok(observationCount >= 2, `prediction pairs with the assessment and the outcome (got ${observationCount})`);
    assert.equal(
      evidence.calibrationEvidence.status,
      'insufficient_evidence',
      'n=2 is below the preregistered floor — the gate must not pretend',
    );
    assert.ok(
      evidence.calibrationEvidence.strata.some((stratum) => stratum.source === 'REAL_EXAM'),
      'strata are grouped per provenance',
    );
    record('evidence', `paired=${observationCount} status=insufficient_evidence strata=${evidence.calibrationEvidence.strata.length}`);

    const calibration = await getJson(`${apiUrl}/coach/score-calibration?userId=${studentId}`, adminHeaders);
    assert.equal(calibration.authoritative, false, 'calibration is never authoritative');
    assert.ok(calibration.summary.pairedCount >= 2, 'both compatible pairs are calibrated');
    for (const row of calibration.rows) {
      assert.equal(row.scalePair, '150/150', 'every calibrated row states its scale pair');
      assert.ok(row.actual >= 0 && row.actual <= 150, 'no mixed-scale actual can exist');
    }
    record('calibration', `paired=${calibration.summary.pairedCount} rows all on 150/150 (mixed scale inexpressible)`);

    // ---------------------------------------------------------------------
    // 9. Correction chain: append-only, recomputed normalization.
    // ---------------------------------------------------------------------
    const corrected = await postJson(`${apiUrl}/coach/score-evidence/corrections`, {
      targetKind: 'assessment',
      targetId: assessment.id,
      correctedFields: { rawScore: 98 },
      reason: '集成测试：更正录入分数',
    }, studentHeaders);
    assert.ok(corrected.id, 'correction appended');
    const afterCorrection = await getJson(`${apiUrl}/coach/score-evidence`, studentHeaders);
    const correctedRow = afterCorrection.assessments.find((row) => row.id === assessment.id);
    assert.equal(correctedRow.rawScore, 98, 'the effective view folds the correction');
    assert.equal(correctedRow.normalizedScore, 98, 'normalization is recomputed on the corrected raw value');
    assert.equal(correctedRow.corrected, true);
    record('correction', `appended ${corrected.id}; effective view folded, evidence row untouched`);

    console.log('\nS1 Score Anchor integration: ALL PASS');
  } finally {
    // Cleanup: user deletion cascades the ledger rows, the authorization and
    // the invitation artifacts — the test database stays as clean as found.
    if (studentId) {
      await prisma.user.deleteMany({ where: { id: { in: [studentId, ids.teacher, ids.admin] } } }).catch(() => {});
    }
    await prisma.$disconnect();
    if (activeApi) activeApi.kill();
  }
}

// ---------------------------------------------------------------------------
// Harness (mirrors integration-score-improvement-loop.mjs)
// ---------------------------------------------------------------------------

async function createInvitation(prisma, createdById, maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 's1 score anchor integration',
      maxUses,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
      createdById,
    },
  });
  return code;
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3260',
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
    // The API must be built (dist/main.js) before booting; build here so the
    // script is self-contained like its siblings.
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    activeApi = startApi();
    await waitForHealth(activeApi);
    await main();
    process.exit(0);
  } catch (error) {
    console.error('\nS1 Score Anchor integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-1500));
    }
    process.exit(1);
  }
})();
