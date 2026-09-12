/**
 * S2.10 — E2 transfer experiment analyzer (READ-ONLY).
 *
 * Reads transfer-probe evidence events (detail.kind='transfer_probe') and the
 * practice-accuracy facts, then prints the stratified E2 table via the same
 * pure projection the product uses. No writes of any kind.
 *
 * Usage: node scripts/analyze-transfer-probe-e2.mjs [--min-node=20]
 */
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { buildTransferProjection, TRANSFER_PROBE_GATE } = require('../packages/shared/dist/index.js');

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const minNodes = Number(process.argv.find((arg) => arg.startsWith('--min-node='))?.split('=')[1] ?? 20);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

try {
  const events = await prisma.userEvent.findMany({
    where: { type: 'EVIDENCE_RECORDED', payload: { path: ['detail', 'kind'], equals: 'transfer_probe' } },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: { payload: true },
  });
  const facts = events.map((row) => {
    const payload = row.payload;
    const detail = payload.detail ?? {};
    return {
      key: String(payload.eventKey ?? payload.recordedAt ?? ''),
      nodeId: String(detail.nodeId ?? ''),
      kind: String(detail.kind_probe ?? 'practice_difficulty'),
      bucket: String(detail.bucket ?? 'MEDIUM'),
      isomorphism: String(detail.isomorphism ?? 'unverified'),
      attempts: Number(payload.metrics?.attempts ?? 0),
      correct: Number(payload.metrics?.correctCount ?? 0),
      invalidated: detail.invalidated === true,
    };
  });
  const nodeIds = [...new Set(facts.map((fact) => fact.nodeId).filter(Boolean))];
  const practiceAccuracyByNode = {};
  for (const nodeId of nodeIds) {
    const records = await prisma.practiceRecord.findMany({
      where: {
        gradingMode: 'objective',
        variantQuestionId: null,
        question: { knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } } },
        OR: [{ sessionId: null }, { session: { is: { type: { not: 'transfer_probe' } } } }],
      },
      orderBy: { submittedAt: 'desc' },
      take: 500,
      select: { correct: true },
    });
    practiceAccuracyByNode[nodeId] = {
      nodeId, attempts: records.length, correct: records.filter((row) => row.correct).length,
    };
  }
  const rows = buildTransferProjection(facts, practiceAccuracyByNode);
  const reported = rows.filter((row) => row.gate === 'reported' && row.isomorphism === 'verified');

  console.log(`E2 transfer experiment — events=${facts.length} nodes=${nodeIds.length}`);
  console.log(`verified strata reported (n>=${TRANSFER_PROBE_GATE.minSampleSize}): ${reported.length}/${nodeIds.length} nodes`);
  console.log('node | kind | bucket | n | transferRate | practiceAccuracy | transferGap | confidence');
  for (const row of rows) {
    console.log(
      [
        row.nodeId, row.kind, row.bucket, row.probeAttempts,
        row.transferRate == null ? 'insufficient_data' : `${row.transferRate}%`,
        row.practiceAccuracy == null ? 'unavailable' : `${row.practiceAccuracy}%`,
        row.transferGap == null ? '—' : `${row.transferGap > 0 ? '+' : ''}${row.transferGap}pt`,
        row.sampleConfidence ?? '—',
      ].join(' | '),
    );
  }
  const verdict = reported.length >= minNodes
    ? 'E2 SAMPLE SUFFICIENT — proceed to analysis write-up'
    : `E2 SAMPLE INSUFFICIENT — ${reported.length}/${minNodes} verified nodes reported; keep accumulating`;
  console.log(`\n${verdict}`);
  console.log('Reminder: TransferGap is transfer evidence, NOT score improvement.');
  process.exit(0);
} catch (error) {
  console.error('E2 analysis failed:', error?.message ?? error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
