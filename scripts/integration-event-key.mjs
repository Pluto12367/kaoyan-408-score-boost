import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const fixturePrefix = `event-key-it-${randomUUID()}`;
const eventFor = (signalType) => ({
  id: `student-state-feedback:${fixturePrefix}:${signalType}`,
  userId: fixturePrefix,
  actionId: `${fixturePrefix}-action`,
  actionType: 'PRACTICE',
  targetType: 'KNOWLEDGE_NODE',
  targetId: `${fixturePrefix}-node`,
  signalType,
  confidence: signalType === 'POSITIVE_FEEDBACK' ? 1 : 0.2,
  evidenceRefs: [`practice-record:${fixturePrefix}`],
  occurredAt: '2026-09-02T08:05:00.000Z',
});

async function main() {
  const { StudentStateFeedbackRepository } = await import('../apps/api/dist/study/student-state-feedback.repository.js');
  const { feedbackDedupeKey } = await import('../apps/api/dist/study/student-state-feedback.adapter.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const setup = new PrismaClient({ datasourceUrl: databaseUrl });
  let firstWorker;
  let secondWorker;
  try {
    await setup.$connect();
    await setup.user.create({
      data: { id: fixturePrefix, name: 'EventKey integration fixture', role: 'STUDENT' },
    });

    firstWorker = new PrismaClient({ datasourceUrl: databaseUrl });
    secondWorker = new PrismaClient({ datasourceUrl: databaseUrl });
    const firstRepository = new StudentStateFeedbackRepository(firstWorker);
    const secondRepository = new StudentStateFeedbackRepository(secondWorker);
    const positive = eventFor('POSITIVE_FEEDBACK');

    const concurrent = await Promise.all([
      firstRepository.createIfAbsent(positive),
      secondRepository.createIfAbsent(positive),
    ]);
    assert.equal(concurrent.filter((result) => result?.created).length, 1, 'one concurrent writer must create the event');
    assert.equal(new Set(concurrent.map((result) => result?.record.id)).size, 1, 'conflicting writers must return the same event');
    const positiveEventKey = feedbackDedupeKey(positive);
    assert.equal(await setup.userEvent.count({ where: { userId: fixturePrefix, eventKey: positiveEventKey } }), 1);

    const retry = await firstRepository.createIfAbsent(positive);
    assert.equal(retry.created, false, 'a retry must read the existing event');

    await firstRepository.createIfAbsent(eventFor('NEGATIVE_FEEDBACK'));
    assert.equal(await setup.userEvent.count({ where: { userId: fixturePrefix } }), 2, 'different signal types must remain distinct events');

    await setup.userEvent.create({ data: { userId: fixturePrefix, type: 'practice.submit', eventKey: null, payload: { fixturePrefix } } });
    await setup.userEvent.create({ data: { userId: fixturePrefix, type: 'task.complete', eventKey: null, payload: { fixturePrefix } } });
    assert.equal(
      await setup.userEvent.count({ where: { userId: fixturePrefix, eventKey: null } }),
      2,
      'legacy events with NULL eventKey must coexist',
    );

    console.log('event-key PostgreSQL integration assertions passed');
  } catch (error) {
    if (error?.code === 'P1001' || error?.code === 'P1017') {
      console.error(`ENVIRONMENT BLOCKED: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    if (error?.code === 'P2021' || error?.code === 'P2022') {
      console.error(`MIGRATION NOT APPLIED: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await firstWorker?.$disconnect();
    await secondWorker?.$disconnect();
    await setup.user.deleteMany({ where: { id: fixturePrefix } }).catch(() => undefined);
    await setup.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
