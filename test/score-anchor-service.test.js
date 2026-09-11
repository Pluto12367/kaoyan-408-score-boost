/**
 * S1 Score Anchor — service contract (sandbox-loaded like the V12-M5
 * calibration service tests).
 *
 * Pins the writer invariants:
 *   • provenance follows the ACTOR (a student claiming TEACHER_GRADED is 403)
 *   • raw scale is preserved and normalization happens at write time
 *   • an outcome's occurredAt must be in the past; a future examDate is 400
 *   • corrections APPEND — the evidence row is never updated
 *   • unverified outcomes never self-verify and students cannot verify
 *   • without a database the service is honestly absent (null, not fake data)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { ScoreAnchorService } = require('../apps/api/src/score-anchor/score-anchor.service.ts');

const PAST = '2026-08-01T00:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';

function stubDb(overrides = {}) {
  const calls = { updates: [], creates: {} };
  const db = {
    calls,
    user: { findUnique: async () => ({ examDate: null }) },
    scorePrediction: {
      findUnique: async () => null,
      create: async ({ data }) => {
        calls.creates.prediction = data;
        return { id: 'p-new' };
      },
    },
    scoreAssessment: {
      findUnique: async () => null,
      create: async ({ data }) => {
        calls.creates.assessment = data;
        return { id: 'a-new', normalizedScore: data.normalizedScore };
      },
      update: async ({ data }) => {
        calls.updates.push({ table: 'scoreAssessment', data });
        return { id: 'a-1' };
      },
    },
    scoreOutcome: {
      findUnique: async () => null,
      create: async ({ data }) => {
        calls.creates.outcome = data;
        return { id: 'o-new', verificationStatus: data.verificationStatus };
      },
      update: async ({ where, data }) => {
        calls.updates.push({ table: 'scoreOutcome', data });
        return { id: where.id, verificationStatus: 'verified' };
      },
    },
    scoreCorrection: {
      create: async ({ data }) => {
        calls.creates.correction = data;
        return { id: 'c-new' };
      },
      findMany: async () => [],
    },
    teacherStudentAuthorization: { findFirst: async () => ({ id: 'auth-1' }) },
    ...overrides,
  };
  return db;
}

const service = (db) => new ScoreAnchorService(db);
const student = { userId: 'u-student', role: 'student' };
const teacher = { userId: 'u-teacher', role: 'teacher' };
const admin = { userId: 'u-admin', role: 'admin' };

test('without a database the writers and read models are honestly absent', async () => {
  const absent = new ScoreAnchorService(undefined);
  assert.equal(absent.enabled, false);
  assert.equal(await absent.recordPrediction('u1', {
    predictionKey: 'report:u1:2026-09-12',
    modelVersion: 'estimate-predicted-score@v1',
    predictedScore: 100,
  }), null);
  assert.equal(await absent.getScoreEvidence(student, 'u1'), null);
});

test('a prediction is recorded on the 150 scale with its model version', async () => {
  const db = stubDb();
  const result = await service(db).recordPrediction('u1', {
    predictionKey: 'report:u1:2026-09-12',
    modelVersion: 'estimate-predicted-score@v1',
    predictedScore: 100,
    predictedMinScore: 90,
    predictedMaxScore: 110,
    generatedFor: 'report',
  });
  assert.equal(result.duplicate, false);
  assert.equal(db.calls.creates.prediction.normalizedTotalScale, 150);
  assert.equal(db.calls.creates.prediction.semantic, 'exam_total');
  assert.equal(db.calls.creates.prediction.source, 'MODEL_OUTPUT');
});

test('a prediction whose best falls outside its own interval is rejected', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordPrediction('u1', {
      predictionKey: 'report:u1:x',
      modelVersion: 'm',
      predictedScore: 120,
      predictedMaxScore: 110,
    }),
    /predictedScore must not exceed predictedMaxScore/,
  );
});

test('a student recording an assessment is forced to IMPORTED provenance', async () => {
  const db = stubDb();
  const result = await service(db).recordAssessment(student, {
    rawScore: 96,
    rawTotalScale: 150,
    source: 'IMPORTED',
    examDate: PAST,
  });
  assert.equal(result.duplicate, false);
  assert.equal(db.calls.creates.assessment.source, 'IMPORTED');
  assert.equal(db.calls.creates.assessment.originType, 'external_import');
});

test('a student claiming TEACHER_GRADED provenance is forbidden, not silently fixed', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordAssessment(student, {
      rawScore: 96,
      rawTotalScale: 150,
      source: 'TEACHER_GRADED',
      examDate: PAST,
    }),
    (error) => error.status === 403,
  );
  assert.equal(db.calls.creates.assessment, undefined, 'nothing was written');
});

test('a teacher defaults to TEACHER_GRADED with the teacher_entry origin', async () => {
  const db = stubDb();
  await service(db).recordAssessment(teacher, { rawScore: 90, rawTotalScale: 150, examDate: PAST });
  assert.equal(db.calls.creates.assessment.source, 'TEACHER_GRADED');
  assert.equal(db.calls.creates.assessment.originType, 'teacher_entry');
});

test('raw scale is preserved and the normalized 150 value is computed at write time', async () => {
  const db = stubDb();
  await service(db).recordAssessment(student, { rawScore: 96, rawTotalScale: 100, examDate: PAST });
  assert.equal(db.calls.creates.assessment.rawTotalScale, 100);
  assert.equal(db.calls.creates.assessment.normalizedScore, 144, '96/100 -> 144/150');
  assert.equal(db.calls.creates.assessment.normalizedTotalScale, 150);
  assert.equal(db.calls.creates.assessment.semantic, 'exam_total');
});

test('an out-of-range score is rejected at the boundary', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordAssessment(student, { rawScore: 160, rawTotalScale: 150, examDate: PAST }),
    /invalid_score_range/,
  );
});

test('a future examDate is rejected', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordAssessment(student, { rawScore: 96, rawTotalScale: 150, examDate: FUTURE }),
    /examDate must not be in the future/,
  );
});

test('a student outcome with verified:true is forbidden', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordOutcome(student, {
      examType: 'real_exam',
      examYear: 2026,
      rawScore: 120,
      rawTotalScale: 150,
      occurredAt: PAST,
      verified: true,
    }),
    (error) => error.status === 403,
  );
});

test('a student outcome without verification records as unverified with the real_exam dedup key', async () => {
  const db = stubDb();
  const result = await service(db).recordOutcome(student, {
    examType: 'real_exam',
    examYear: 2026,
    rawScore: 120,
    rawTotalScale: 150,
    occurredAt: PAST,
  });
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(db.calls.creates.outcome.dedupKey, 'real_exam:2026');
  assert.equal(db.calls.creates.outcome.verificationStatus, 'unverified');
  assert.equal(db.calls.creates.outcome.source, 'REAL_EXAM');
});

test('an outcome dated in the future is rejected — outcomes record exams that happened', async () => {
  const db = stubDb();
  await assert.rejects(
    () => service(db).recordOutcome(student, {
      examType: 'real_exam',
      examYear: 2030,
      rawScore: 120,
      rawTotalScale: 150,
      occurredAt: FUTURE,
    }),
    /occurredAt must be in the past/,
  );
});

test('a teacher may verify another student outcome only with an authorization record', async () => {
  const stored = { id: 'o1', userId: 'u-student', verificationStatus: 'unverified' };
  const db = stubDb({
    scoreOutcome: {
      findUnique: async () => stored,
      create: async () => stored,
      update: async ({ where, data }) => ({ id: where.id, verificationStatus: data.verificationStatus }),
    },
    teacherStudentAuthorization: { findFirst: async () => null },
  });
  await assert.rejects(
    () => service(db).verifyOutcome(teacher, 'o1'),
    (error) => error.status === 403,
  );

  const authorized = stubDb({
    scoreOutcome: {
      findUnique: async () => stored,
      create: async () => stored,
      update: async ({ where, data }) => {
        authorized.calls.updates.push({ table: 'scoreOutcome', data });
        return { id: where.id, verificationStatus: data.verificationStatus };
      },
    },
    teacherStudentAuthorization: { findFirst: async () => ({ id: 'auth-1' }) },
  });
  const result = await service(authorized).verifyOutcome(teacher, 'o1');
  assert.equal(result.verificationStatus, 'verified');
  assert.equal(authorized.calls.updates.length, 1);
  assert.equal(authorized.calls.updates[0].data.verifiedBy, 'u-teacher');
});

test('a student can never verify, even their own outcome', async () => {
  const db = stubDb({
    scoreOutcome: {
      findUnique: async () => ({ id: 'o1', userId: 'u-student', verificationStatus: 'unverified' }),
      create: async () => ({}),
      update: async () => ({}),
    },
  });
  await assert.rejects(
    () => service(db).verifyOutcome(student, 'o1'),
    (error) => error.status === 403,
  );
  assert.equal(db.calls.updates.length, 0);
});

test('verifying an already-verified outcome changes nothing', async () => {
  const db = stubDb({
    scoreOutcome: {
      findUnique: async () => ({ id: 'o1', userId: 'u1', verificationStatus: 'verified' }),
      create: async () => ({}),
      update: async () => ({}),
    },
  });
  const result = await service(db).verifyOutcome(admin, 'o1');
  assert.equal(result.verificationStatus, 'verified');
  assert.equal(db.calls.updates.length, 0, 'the verified row was not rewritten');
});

test('a correction recomputes the normalized score and never updates the evidence row', async () => {
  const db = stubDb({
    scoreAssessment: {
      findUnique: async () => ({
        id: 'a1',
        userId: 'u-student',
        rawScore: 90,
        rawTotalScale: 150,
        normalizedScore: 90,
      }),
      create: async () => ({}),
      update: async ({ data }) => {
        db.calls.updates.push({ table: 'scoreAssessment', data });
        return { id: 'a1' };
      },
    },
    scoreCorrection: {
      create: async ({ data }) => {
        db.calls.creates.correction = data;
        return { id: 'c-new' };
      },
      findMany: async () => [],
    },
  });
  const result = await service(db).recordCorrection(student, {
    targetKind: 'assessment',
    targetId: 'a1',
    correctedFields: { rawScore: 96 },
    reason: '录入时看错了分数',
  });
  assert.equal(result.id, 'c-new');
  assert.equal(db.calls.creates.correction.correctedFields.rawScore, 96);
  assert.equal(db.calls.creates.correction.correctedFields.normalizedScore, 96, '90/150 -> 96/150 recomputed');
  assert.equal(db.calls.updates.length, 0, 'the evidence row itself was NEVER updated');
});

test('a correction touching a non-correctable field is rejected', async () => {
  const db = stubDb({
    scoreAssessment: {
      findUnique: async () => ({ id: 'a1', userId: 'u-student', rawScore: 90, rawTotalScale: 150 }),
      create: async () => ({}),
    },
    scoreCorrection: { create: async () => ({ id: 'c' }), findMany: async () => [] },
  });
  await assert.rejects(
    () => service(db).recordCorrection(student, {
      targetKind: 'assessment',
      targetId: 'a1',
      correctedFields: { source: 'REAL_EXAM' },
      reason: 'upgrade my provenance',
    }),
    /not correctable/,
  );
});

test('a student cannot correct another student evidence', async () => {
  const db = stubDb({
    scoreAssessment: {
      findUnique: async () => ({ id: 'a1', userId: 'someone-else', rawScore: 90, rawTotalScale: 150 }),
      create: async () => ({}),
    },
    scoreCorrection: { create: async () => ({ id: 'c' }), findMany: async () => [] },
  });
  await assert.rejects(
    () => service(db).recordCorrection(student, {
      targetKind: 'assessment',
      targetId: 'a1',
      correctedFields: { rawScore: 96 },
      reason: 'not mine',
    }),
    (error) => error.status === 403,
  );
});

test('getScoreEvidence folds the correction chain into the effective view', async () => {
  const db = stubDb({
    scorePrediction: {
      findUnique: async () => null,
      findMany: async () => [
        {
          id: 'p1',
          predictedScore: 100,
          predictedMinScore: 90,
          predictedMaxScore: 110,
          generatedAt: new Date('2026-08-01T00:00:00.000Z'),
          modelVersion: 'estimate-predicted-score@v1',
        },
      ],
      create: async () => ({ id: 'p' }),
    },
    scoreAssessment: {
      findUnique: async () => null,
      findMany: async () => [
        {
          id: 'a1',
          userId: 'u1',
          originType: 'external_import',
          originId: 'k1',
          rawScore: 90,
          rawTotalScale: 150,
          normalizedScore: 90,
          normalizedTotalScale: 150,
          semantic: 'exam_total',
          source: 'IMPORTED',
          gradingMethod: null,
          examDate: new Date('2026-08-10T00:00:00.000Z'),
          title: '机构模考',
          recordedAt: new Date('2026-08-11T00:00:00.000Z'),
        },
      ],
      create: async () => ({ id: 'a' }),
    },
    scoreOutcome: { findUnique: async () => null, findMany: async () => [], create: async () => ({}) },
    scoreCorrection: {
      create: async () => ({ id: 'c' }),
      findMany: async () => [
        {
          targetId: 'a1',
          correctedFields: { rawScore: 95, normalizedScore: 95 },
          correctedAt: new Date('2026-08-12T00:00:00.000Z'),
          reason: 'r',
        },
      ],
    },
    teacherStudentAuthorization: { findFirst: async () => ({ id: 'auth' }) },
  });
  const evidence = await service(db).getScoreEvidence({ userId: 'u1', role: 'student' }, 'u1');
  assert.ok(evidence);
  assert.equal(evidence.storeAvailable, true);
  assert.equal(evidence.assessments[0].rawScore, 95, 'the correction chain resolves to the effective value');
  assert.equal(evidence.assessments[0].corrected, true);
  assert.equal(evidence.anchors.latestPrediction.predictedScore, 100);
  assert.equal(evidence.calibrationEvidence.pairedCount, 1, 'prediction 08-01 pairs with exam 08-10');
  assert.equal(evidence.calibrationEvidence.status, 'insufficient_evidence', 'n=1 is below the gate floor');
});

test('the paper dual-write stores the in-app mock as accuracy_rate evidence', async () => {
  const db = stubDb();
  await service(db).recordPaperAssessment('u1', {
    originId: 'sess-1',
    accuracyRate: 65,
    title: '408 模拟卷',
  });
  assert.equal(db.calls.creates.assessment.semantic, 'accuracy_rate');
  assert.equal(db.calls.creates.assessment.rawScore, 65);
  assert.equal(db.calls.creates.assessment.rawTotalScale, 100);
  assert.equal(db.calls.creates.assessment.source, 'MOCK');
  assert.equal(db.calls.creates.assessment.normalizedScore, 97.5, '65/100 -> 97.5/150');
});

test('the paper dual-write never throws — the exam path must not depend on the ledger', async () => {
  const db = stubDb({
    scoreAssessment: {
      findUnique: async () => null,
      create: async () => {
        throw new Error('ledger down');
      },
    },
  });
  await service(db).recordPaperAssessment('u1', { originId: 'sess-2', accuracyRate: 50, title: 'x' });
});
