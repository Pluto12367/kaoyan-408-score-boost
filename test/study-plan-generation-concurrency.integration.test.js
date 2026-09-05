import test from 'node:test';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';

test('StudyPlan generation reliability converges under PostgreSQL concurrency', { skip: !enabled }, async () => {
  const { run } = await import('../scripts/integration-generation-reliability.mjs');
  await run();
});
