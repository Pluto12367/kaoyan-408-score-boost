// LE-V10 F1 M5 — integration validation for the exam-alignment projection
// against the real seeded test database (127.0.0.1:55432/kaoyan408_test).
//
// Validates the full data chain on REAL seed data (seed-408-v2):
//   Question →(QuestionKnowledgeNodeTag)→ KnowledgeNode
//             →(KnowledgeFrequencySnapshot)→ recent3/5 + confidence
//             →(ExamQuestionKnowledgeTag→ExamQuestion→Paper)→ exam hits
//             →(UserKnowledgeMastery)→ mastery honesty branches
// Run: npm run test:integration:exam-aligned  (after db:test:up)

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert.equal = (actual, expected, message) => {
  if (!(Object.is(actual, expected))) {
    throw new Error(message ?? `expected ${String(expected)}, got ${String(actual)}`);
  }
};

assert.ok = assert;

assert.deepEqual = (actual, expected, message) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, message ?? `deepEqual failed:\n  actual:   ${actualJson}\n  expected: ${expectedJson}`);
};

function roundGain(primaryScore5y, mastery) {
  return Math.round(primaryScore5y * (1 - mastery) * 0.6);
}

async function main() {
  process.env.DATABASE_URL = databaseUrl;
  const { ExamAlignmentService } = await import('../apps/api/dist/study/exam-alignment.service.js');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const service = new ExamAlignmentService(prisma);
  let fixtureTagId = null;

  try {
    assert(service.enabled === true, 'service must be enabled with DATABASE_URL');

    // Snapshot coverage: pick three nodes with seeded frequency snapshots.
    const snapshots = await prisma.knowledgeFrequencySnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 40,
    });
    const latestKey = `${snapshots[0]?.snapshotDate?.toISOString()}@${snapshots[0]?.modelVersion}`;
    const byNode = new Map();
    for (const row of snapshots) {
      const key = `${row.snapshotDate.toISOString()}@${row.modelVersion}`;
      if (key !== latestKey) continue;
      if (!byNode.has(row.knowledgeNodeId)) byNode.set(row.knowledgeNodeId, row);
    }
    const sampleNodes = [...byNode.values()].slice(0, 3);
    assert(sampleNodes.length >= 3, 'seeded database must contain at least 3 frequency snapshots');
    console.log(`[exam-aligned] snapshot nodes sampled: ${sampleNodes.map((row) => row.knowledgeNodeId).join(', ')}`);

    // Find a real question tagged to the first sampled node; the seeded test
    // database ships questions without node tags, so create a temp fixture tag
    // (cleaned up in finally) mirroring how content import tags questions.
    let tagged = await prisma.questionKnowledgeNodeTag.findFirst({
      where: { knowledgeNodeId: sampleNodes[0].knowledgeNodeId },
      select: { questionId: true },
    });
    let fixtureTagIdLocal = null;
    if (!tagged) {
      const question = await prisma.question.findFirst({ select: { id: true } });
      assert(question, 'seeded database must contain at least one question');
      const fixture = await prisma.questionKnowledgeNodeTag.create({
        data: {
          questionId: question.id,
          knowledgeNodeId: sampleNodes[0].knowledgeNodeId,
          role: 'PRIMARY',
          confidence: 1.0,
          source: 'integration-fixture',
        },
      });
      fixtureTagIdLocal = fixture.id;
      tagged = { questionId: question.id };
      console.log(`[exam-aligned] fixture tag created: ${question.id} → ${sampleNodes[0].knowledgeNodeId}`);
    }
    assert(tagged, 'seeded database must contain at least one question-node tag');
    fixtureTagId = fixtureTagIdLocal;

    const userId = 'u-exam-aligned-integration';
    await prisma.userKnowledgeMastery.deleteMany({ where: { userId, knowledgeNodeId: sampleNodes[0].knowledgeNodeId } });

    // Branch 1 — no mastery record: frequency visible, mastery null, gain hidden.
    const anonymous = await service.getAlignmentForQuestions(userId, [tagged.questionId]);
    assert(anonymous, 'alignment projection must exist with an enabled store');
    const anonItem = anonymous.items[0];
    assert(anonItem.primaryNode.knowledgeNodeId === sampleNodes[0].knowledgeNodeId);
    assert.equal(anonItem.mastery, null, 'missing mastery must be null (尚未练习), never 0%');
    assert.equal(anonItem.predictedGainEstimate, null, 'gain hidden without mastery');
    if (anonItem.stars > 0) {
      assert.equal(anonItem.recent5Frequency, byNode.get(anonItem.primaryNode.knowledgeNodeId).recent5Frequency);
      assert.ok(anonItem.examHits.length <= 3, 'exam hits capped at 3');
      const years = anonItem.examHits.map((hit) => hit.year);
      assert.deepEqual([...years].sort((a, b) => b - a), years, 'exam hits sorted year-desc');
    }

    // Branch 2 — with a mastery record: estimate appears with the exact formula.
    // Prefer a non-LOW confidence node so the formula branch gets real coverage.
    const sample = sampleNodes.find((row) => row.evidenceConfidence !== 'LOW') ?? sampleNodes[0];
    const masteryValue = 0.5;
    let tempUser = await prisma.user.findFirst({ where: { role: 'STUDENT' }, select: { id: true } });
    let tempUserCreated = false;
    if (!tempUser) {
      tempUser = await prisma.user.create({
        data: { id: 'u-exam-aligned-integration', name: 'Exam Aligned Integration', role: 'STUDENT' },
        select: { id: true },
      });
      tempUserCreated = true;
    }
    const integrationUserId = tempUser.id;
    await prisma.userKnowledgeMastery.deleteMany({ where: { userId: integrationUserId, knowledgeNodeId: sample.knowledgeNodeId } });
    await prisma.userKnowledgeMastery.create({
      data: {
        userId: integrationUserId,
        knowledgeNodeId: sample.knowledgeNodeId,
        mastery: masteryValue,
        accuracy: 0.5,
        attempts: 2,
        correctCount: 1,
        wrongCount: 1,
      },
    });
    try {
      const withMastery = await service.getAlignmentForQuestions(integrationUserId, [tagged.questionId]);
      const item = withMastery.items.find((row) => row.primaryNode?.knowledgeNodeId === sample.knowledgeNodeId);
      assert(item, 'primary node with snapshot and mastery must project');
      assert.equal(item.mastery, masteryValue);
      if (sample.evidenceConfidence !== 'LOW') {
        assert.equal(item.predictedGainEstimate, roundGain(sample.primaryScore5y, masteryValue),
          `estimate must equal round(${sample.primaryScore5y} × (1 − ${masteryValue}) × 0.6)`);
      } else {
        assert.equal(item.predictedGainEstimate, null, 'LOW confidence hides the estimate');
      }
      assert.equal(item.evidence.masterySource.table, 'UserKnowledgeMastery');
      console.log(`[exam-aligned] mastery branch ok: gain=${item.predictedGainEstimate} confidence=${sample.evidenceConfidence}`);
    } finally {
      await prisma.userKnowledgeMastery.deleteMany({ where: { userId: integrationUserId, knowledgeNodeId: sample.knowledgeNodeId } });
      if (tempUserCreated) await prisma.user.delete({ where: { id: integrationUserId } });
    }

    // Branch 3 — summary aggregates: covered counts only snapshot-backed nodes.
    const nodeIds = sampleNodes.map((row) => row.knowledgeNodeId);
    const anyQuestion = await prisma.questionKnowledgeNodeTag.findFirst({
      where: { knowledgeNodeId: { in: nodeIds } },
      select: { questionId: true },
    });
    const summaryProjection = await service.getAlignmentForQuestions(userId, [anyQuestion.questionId]);
    assert(summaryProjection.summary.coveredNodeCount <= 1, 'single question cannot cover more nodes than its tags');
    assert(summaryProjection.summary.coveredYears.every((year) => Number.isInteger(year) && year > 2000));

    console.log('[exam-aligned] integration validation PASS');
  } finally {
    if (fixtureTagId) {
      await prisma.questionKnowledgeNodeTag.deleteMany({ where: { id: fixtureTagId, source: 'integration-fixture' } });
      console.log('[exam-aligned] fixture tag cleaned up');
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[exam-aligned] integration validation FAILED:', error?.message ?? error);
  process.exitCode = 1;
});
