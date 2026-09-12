import test from 'node:test';
import assert from 'node:assert/strict';

// Phase B9 / B4 — probe content validation contract.
//
// The validator's job is to *refuse*, not to bless. Two rules dominate:
//   1. `verified` is never inferred from generation. It requires the structural
//      facts to hold AND a named human review to be recorded (B4: no self-proof).
//   2. Quality blockers (missing solution/difficulty/node/rubric, duplicates,
//      invalid pool label) make the whole pool NOT READY rather than being
//      averaged away (B7/B8: never lower the bar to hit a count).

const {
  validateProbeContent,
  PROBE_CONTENT_TARGET_NODES,
  PROBE_CONTENT_MIN_PER_NODE,
} = await import('../packages/shared/dist/index.js');

function fact(overrides = {}) {
  return {
    questionId: 'q-1',
    source: 'transfer_probe_pool',
    type: 'SINGLE_CHOICE',
    difficulty: 'BASIC',
    contentFingerprint: 'fp-1',
    familyId: 'fam-1',
    answer: 'A',
    analysis: '解析文本',
    rubricCriteriaCount: 0,
    nodeIds: ['node-a'],
    priorAttempts: 0,
    priorExposures: 0,
    ...overrides,
  };
}

function manifestEntry(overrides = {}) {
  return {
    questionId: 'q-1',
    nodeId: 'node-a',
    questionType: 'SINGLE_CHOICE',
    difficultyBucket: 'BASIC',
    isomorphismStatus: 'verified',
    isomorphismEvidence: {
      sameNode: true,
      sameQuestionType: true,
      sameDifficultyBucket: true,
      differentSurface: true,
      sameKnowledgeOperation: { operationId: 'op-1', declaredBy: 'reviewer-1', reviewedAt: '2026-09-12T00:00:00.000Z' },
      referenceQuestionId: 'q-ref',
    },
    solution: 'A',
    expectedOperation: '遍历顺序判定',
    contentSource: 'content-team-2026-09',
    reviewStatus: 'approved',
    reviewedBy: 'reviewer-1',
    reviewedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    questions: [fact()],
    manifest: { questions: [manifestEntry()] },
    candidateNodeIds: ['node-a'],
    minQuestionsPerNode: PROBE_CONTENT_MIN_PER_NODE,
    targetNodeCount: PROBE_CONTENT_TARGET_NODES,
    ...overrides,
  };
}

// ---------------------------------------------------------------- constants

test('B0: the target is 30 nodes x >=2 verified questions, declared as constants', () => {
  assert.equal(PROBE_CONTENT_TARGET_NODES, 30);
  assert.equal(PROBE_CONTENT_MIN_PER_NODE, 2);
});

// ------------------------------------------------------------- verification

test('B3/B4: verified requires structural facts AND a recorded human review', () => {
  const ready = validateProbeContent(baseInput());
  assert.equal(ready.perNode[0].verified, 1, 'a fully evidenced + reviewed question counts as verified');

  // Missing the human half of the evidence -> unverified, never auto-upgraded.
  const noReview = validateProbeContent(baseInput({
    manifest: { questions: [manifestEntry({ reviewStatus: 'pending', reviewedBy: null, reviewedAt: null })] },
  }));
  assert.equal(noReview.perNode[0].verified, 0);
  assert.equal(noReview.perNode[0].unverified, 1);

  const noOperation = validateProbeContent(baseInput({
    manifest: { questions: [manifestEntry({
      isomorphismEvidence: { ...manifestEntry().isomorphismEvidence, sameKnowledgeOperation: null },
    })] },
  }));
  assert.equal(noOperation.perNode[0].verified, 0, 'the core knowledge operation cannot be inferred');
  assert.equal(noOperation.perNode[0].unverified, 1);
});

test('B4: a self-declared "isomorphic = true" with no evidence is unverified', () => {
  const report = validateProbeContent(baseInput({
    manifest: { questions: [manifestEntry({ isomorphismEvidence: null })] },
  }));
  assert.equal(report.perNode[0].verified, 0);
  assert.ok(report.blocking.some((finding) => finding.code === 'isomorphism_evidence_missing'));
});

test('B3: structural mismatches downgrade to unverified instead of being trusted', () => {
  const cases = [
    ['sameNode', { sameNode: false }],
    ['sameQuestionType', { sameQuestionType: false }],
    ['sameDifficultyBucket', { sameDifficultyBucket: false }],
    ['differentSurface', { differentSurface: false }],
  ];
  for (const [label, patch] of cases) {
    const report = validateProbeContent(baseInput({
      manifest: { questions: [manifestEntry({ isomorphismEvidence: { ...manifestEntry().isomorphismEvidence, ...patch } })] },
    }));
    assert.equal(report.perNode[0].verified, 0, `${label}=false must not be verified`);
    assert.equal(report.perNode[0].unverified, 1);
  }
});

test('B3: verification is cross-checked against the database, not the manifest alone', () => {
  // The manifest claims BASIC + SINGLE_CHOICE on node-a; the stored row says HARD
  // and lives on another node. The claim must not survive.
  const report = validateProbeContent(baseInput({
    questions: [fact({ difficulty: 'HARD', nodeIds: ['node-b'], type: 'COMPREHENSIVE', rubricCriteriaCount: 0 })],
  }));
  assert.equal(report.perNode[0].verified, 0, 'stored facts disagree with the manifest');
  assert.ok(report.blocking.some((finding) => finding.code === 'manifest_db_mismatch'));
});

// --------------------------------------------------------------- blockers

test('B9: each quality blocker is reported, never averaged away', () => {
  const cases = [
    [{ answer: '' }, 'missing_solution'],
    [{ analysis: '' }, 'missing_analysis'],
    [{ source: 'imported' }, 'invalid_probe_label'],
    [{ difficulty: '' }, 'missing_difficulty'],
    [{ nodeIds: [] }, 'missing_node'],
  ];
  for (const [patch, code] of cases) {
    const report = validateProbeContent(baseInput({ questions: [fact(patch)] }));
    assert.ok(report.blocking.some((finding) => finding.code === code), `expected ${code}`);
    assert.equal(report.verdict, 'PROBE CONTENT NOT READY');
  }
});

test('B7: a human-graded question without rubric criteria is NOT READY', () => {
  const report = validateProbeContent(baseInput({
    questions: [fact({ type: 'COMPREHENSIVE', rubricCriteriaCount: 0 })],
    manifest: { questions: [manifestEntry({ questionType: 'COMPREHENSIVE' })] },
  }));
  assert.ok(report.blocking.some((finding) => finding.code === 'missing_rubric'));
  assert.equal(report.verdict, 'PROBE CONTENT NOT READY');
});

test('B9: duplicate question, duplicate family and duplicate manifest rows are blockers', () => {
  const duplicateFingerprint = validateProbeContent(baseInput({
    questions: [fact(), fact({ questionId: 'q-2', contentFingerprint: 'fp-1', familyId: 'fam-2' })],
    manifest: {
      questions: [
        manifestEntry(),
        manifestEntry({ questionId: 'q-2' }),
      ],
    },
  }));
  assert.ok(duplicateFingerprint.blocking.some((finding) => finding.code === 'duplicate_question'));

  const duplicateFamily = validateProbeContent(baseInput({
    questions: [fact(), fact({ questionId: 'q-2', contentFingerprint: 'fp-2', familyId: 'fam-1' })],
    manifest: {
      questions: [manifestEntry(), manifestEntry({ questionId: 'q-2' })],
    },
  }));
  assert.ok(duplicateFamily.blocking.some((finding) => finding.code === 'duplicate_family'));

  const duplicateManifest = validateProbeContent(baseInput({
    questions: [fact()],
    manifest: { questions: [manifestEntry(), manifestEntry()] },
  }));
  assert.ok(duplicateManifest.blocking.some((finding) => finding.code === 'duplicate_manifest_entry'));
});

// -------------------------------------------------- never-seen vs verified

test('B5: prior exposure is reported separately and never changes verification', () => {
  const report = validateProbeContent(baseInput({
    questions: [fact({ priorAttempts: 3, priorExposures: 2 })],
  }));
  assert.equal(report.perNode[0].verified, 1, 'content quality is independent of who has seen it');
  assert.equal(report.exposure.exposedQuestionCount, 1);
  assert.equal(report.exposure.clean, false, 'the pool is not isolated from practice history');
  assert.ok(report.blocking.every((finding) => finding.code !== 'exposed'), 'exposure blocks delivery, not content validity');
});

test('B6: an empty pool is an honest NOT READY with a coverage gap, not a failure', () => {
  const report = validateProbeContent({
    questions: [],
    manifest: null,
    candidateNodeIds: ['node-a', 'node-b'],
    minQuestionsPerNode: 2,
    targetNodeCount: 30,
  });
  assert.equal(report.verdict, 'PROBE CONTENT NOT READY');
  // Every candidate node is listed with zero coverage — that IS the gap, so it
  // must be visible rather than collapsing to an empty list.
  assert.equal(report.perNode.length, 2);
  for (const row of report.perNode) {
    assert.equal(row.verified, 0);
    assert.equal(row.unverified, 0);
    assert.equal(row.total, 0);
  }
  assert.equal(report.totals.questions, 0);
  assert.equal(report.totals.nodesMeetingTarget, 0);
  assert.equal(report.coverageGap.nodeShortfall, 30);
  assert.equal(report.coverageGap.questionShortfall, 60);
  assert.ok(!report.blocking.some((finding) => finding.code === 'exposed'));
  assert.equal(report.exposure.clean, true);
});

// ------------------------------------------------------------ readiness

test('B11: READY only when 30 nodes each hold >=2 verified questions', () => {
  const nodes = Array.from({ length: 30 }, (_, index) => `node-${index}`);
  const questions = [];
  const entries = [];
  for (const nodeId of nodes) {
    for (let index = 0; index < 2; index += 1) {
      const questionId = `q-${nodeId}-${index}`;
      questions.push(fact({ questionId, nodeId, contentFingerprint: `fp-${questionId}`, familyId: `fam-${questionId}`, nodeIds: [nodeId] }));
      entries.push(manifestEntry({ questionId, nodeId }));
    }
  }
  const ready = validateProbeContent({
    questions, manifest: { questions: entries }, candidateNodeIds: nodes,
    minQuestionsPerNode: 2, targetNodeCount: 30,
  });
  assert.equal(ready.totals.verified, 60);
  assert.equal(ready.totals.nodesMeetingTarget, 30);
  assert.equal(ready.coverageGap.nodeShortfall, 0);
  assert.equal(ready.verdict, 'PROBE CONTENT READY');

  // One node short of the target is NOT READY, and says by how much.
  const short = validateProbeContent({
    questions: questions.filter((row) => row.nodeId !== 'node-29'),
    manifest: { questions: entries.filter((row) => row.nodeId !== 'node-29') },
    candidateNodeIds: nodes, minQuestionsPerNode: 2, targetNodeCount: 30,
  });
  assert.equal(short.totals.nodesMeetingTarget, 29);
  assert.equal(short.coverageGap.nodeShortfall, 1);
  assert.equal(short.verdict, 'PROBE CONTENT NOT READY');
});

test('B10: the report exposes the coverage the readiness claim depends on', () => {
  const report = validateProbeContent(baseInput({
    questions: [
      fact(),
      fact({ questionId: 'q-2', type: 'COMPREHENSIVE', rubricCriteriaCount: 3, contentFingerprint: 'fp-2', familyId: 'fam-2' }),
    ],
    manifest: { questions: [manifestEntry(), manifestEntry({ questionId: 'q-2', questionType: 'COMPREHENSIVE' })] },
  }));
  assert.equal(report.totals.questions, 2);
  assert.equal(report.totals.rubricCovered, 1);
  assert.equal(report.totals.rubricRequired, 1);
  assert.deepEqual(Object.keys(report.difficultyCoverage).sort(), ['BASIC']);
  assert.ok(report.perNode[0].total >= 2);
});
