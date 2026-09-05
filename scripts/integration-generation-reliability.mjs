import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const fixturePrefix = `generation-reliability-${Date.now()}-${process.pid}`;
const userId = `${fixturePrefix}-user`;
const generationKey = `LEARNING_LOOP:${userId}:2026-09-02:v1`;

function isEnvironmentError(error) {
  const code = error?.code;
  return ['P1001', 'P1017', 'P1003', 'P1012'].includes(code)
    || /spawn EPERM|dockerDesktop|ECONNREFUSED|Can't reach database server|server has closed the connection/i.test(String(error?.message ?? error));
}

function isMigrationError(error) {
  return ['P2021', 'P2022'].includes(error?.code)
    || /does not exist in the current database|The table .* does not exist/i.test(String(error?.message ?? error));
}

function assertLoopbackDatabase(url) {
  const parsed = new URL(url);
  assert(
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost',
    `refusing to write integration fixtures to non-loopback database: ${parsed.hostname}`,
  );
}

function planInput(key) {
  return {
    userId,
    generationKey: key,
    phase: 'score-center',
    targetScore: 115,
    remainingDays: 96,
    dailyHours: 3,
    checkpoint: 'score-center',
    source: 'integration-test',
    modelVersion: 'integration-v1',
    availableMinutes: 60,
    tasks: [1, 2].map((rank) => ({
      knowledgePointId: `${fixturePrefix}-point-${rank}`,
      subject: 'computer-organization',
      chapter: 'cache',
      title: `Generation reliability task ${rank}`,
      mode: 'PRACTICE',
      minutes: 20,
      questionCount: 5,
      scheduledDate: '2026-09-02',
      priority: '中',
      reason: 'generation reliability integration fixture',
      nextAction: 'practice',
      generatedRank: rank,
    })),
  };
}

function actionInput(targetId) {
  return {
    userId,
    scheduledDate: '2026-09-02',
    generationKey,
    actionType: 'PRACTICE',
    targetType: 'KNOWLEDGE_NODE',
    targetId,
    reason: 'generation reliability integration fixture',
    evidenceRefs: [{ kind: 'integration-fixture', id: fixturePrefix }],
  };
}

function planEventInput() {
  return {
    userId,
    type: 'plan.generated',
    payload: {
      planId: `${fixturePrefix}-plan`,
      generationKey,
      source: 'integration-test',
      scheduledDate: '2026-09-02',
      triggerType: 'task.complete',
      sourceId: `${fixturePrefix}-task-source`,
      triggerKey: `learning-loop:${userId}:2026-09-02`,
    },
  };
}

export async function run() {
  assertLoopbackDatabase(databaseUrl);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;

  const setup = new PrismaClient({ datasourceUrl: databaseUrl });
  let workerA;
  let workerB;
  let plan;
  try {
    await setup.$connect();
    await setup.user.create({
      data: { id: userId, name: 'Generation reliability fixture', role: 'STUDENT' },
    });

    workerA = new PrismaClient({ datasourceUrl: databaseUrl });
    workerB = new PrismaClient({ datasourceUrl: databaseUrl });
    const [{ StudyPlanRepository }, { RecommendationActionAdapterService }, { CanonicalEventWriterService }, { UserEventRepository }] = await Promise.all([
      import('../apps/api/dist/study/study-plan.repository.js'),
      import('../apps/api/dist/study/recommendation-action-adapter.service.js'),
      import('../apps/api/dist/study/canonical-event-writer.service.js'),
      import('../apps/api/dist/study/user-event.repository.js'),
    ]);

    const planRepositoryA = new StudyPlanRepository(workerA);
    const planRepositoryB = new StudyPlanRepository(workerB);
    const [planA, planB] = await Promise.all([
      planRepositoryA.createOrGetByGenerationKey(planInput(generationKey)),
      planRepositoryB.createOrGetByGenerationKey(planInput(generationKey)),
    ]);
    assert.equal(planA.id, planB.id, 'concurrent generation requests must return the same StudyPlan');
    plan = planA;

    const persistedPlanCount = await setup.studyPlan.count({ where: { userId, generationKey } });
    const persistedTaskCount = await setup.studyTask.count({ where: { planId: plan.id } });
    assert.equal(persistedPlanCount, 1, 'concurrent generation must persist one StudyPlan');
    assert.equal(persistedTaskCount, 2, 'the winning StudyPlan must retain all generated tasks');

    const actionAdapterA = new RecommendationActionAdapterService(workerA);
    const actionAdapterB = new RecommendationActionAdapterService(workerB);
    const firstActionDraft = actionInput(`${fixturePrefix}-node-1`);
    const [actionA, actionB] = await Promise.all([
      actionAdapterA.createOrGetAction(firstActionDraft),
      actionAdapterB.createOrGetAction(firstActionDraft),
    ]);
    assert.equal(actionA.id, actionB.id, 'concurrent action creation must return the same RecommendationAction');

    const secondAction = await actionAdapterA.createOrGetAction(actionInput(`${fixturePrefix}-node-2`));
    const tasks = await setup.studyTask.findMany({ where: { planId: plan.id }, orderBy: { generatedRank: 'asc' } });
    assert.equal(tasks.length, 2);
    assert.equal(await actionAdapterA.bindStudyTask(actionA.id, tasks[0].id), true);
    assert.equal(await actionAdapterA.bindStudyTask(secondAction.id, tasks[1].id), true);

    const persistedActionCount = await setup.recommendationAction.count({
      where: { userId, creationKey: { startsWith: `ACTION:${generationKey}` } },
    });
    assert.equal(persistedActionCount, 2, 'same-generation action targets must materialize once per target');
    const boundActionCount = await setup.recommendationAction.count({
      where: { userId, studyTaskId: { in: tasks.map((task) => task.id) } },
    });
    assert.equal(boundActionCount, 2, 'each generated task must have one Action binding');

    const eventWriterA = new CanonicalEventWriterService(new UserEventRepository(workerA));
    const eventWriterB = new CanonicalEventWriterService(new UserEventRepository(workerB));
    const eventInput = planEventInput();
    const [eventA, eventB] = await Promise.all([
      eventWriterA.recordCanonicalEvent(eventInput),
      eventWriterB.recordCanonicalEvent(eventInput),
    ]);
    assert.equal(eventA?.id, eventB?.id, 'concurrent plan.generated writes must return the same UserEvent');
    assert.equal(eventA?.eventKey, `PLAN_GENERATED:${generationKey}`);
    const persistedEventCount = await setup.userEvent.count({
      where: { userId, type: 'plan.generated', eventKey: `PLAN_GENERATED:${generationKey}` },
    });
    assert.equal(persistedEventCount, 1, 'same generation must persist one plan.generated event');

    const rollbackGenerationKey = `LEARNING_LOOP:${userId}:2026-09-03:rollback`;
    const rollbackIds = {
      plan: `${fixturePrefix}-rollback-plan`,
      task: `${fixturePrefix}-rollback-task`,
      action: `${fixturePrefix}-rollback-action`,
      event: `${fixturePrefix}-rollback-event`,
    };
    await assert.rejects(
      setup.$transaction(async (tx) => {
        await tx.studyPlan.create({
          data: {
            id: rollbackIds.plan,
            userId,
            generationKey: rollbackGenerationKey,
            phase: 'score-center',
            targetScore: 115,
            remainingDays: 96,
            dailyHours: 3,
            checkpoint: 'rollback-fixture',
          },
        });
        await tx.studyTask.create({
          data: {
            id: rollbackIds.task,
            planId: rollbackIds.plan,
            knowledgePointId: `${fixturePrefix}-rollback-point`,
            title: 'Rollback fixture task',
            mode: 'PRACTICE',
            minutes: 20,
            questionCount: 5,
            scheduledDate: '2026-09-03',
            priority: '中',
            reason: 'rollback fixture',
            nextAction: 'practice',
          },
        });
        await tx.recommendationAction.create({
          data: {
            id: rollbackIds.action,
            userId,
            actionType: 'PRACTICE',
            targetType: 'KNOWLEDGE_NODE',
            targetId: `${fixturePrefix}-rollback-node`,
            reason: 'rollback fixture',
            evidenceRefs: [{ kind: 'integration-fixture', id: fixturePrefix }],
            creationKey: `ACTION:${rollbackGenerationKey}:PRACTICE:KNOWLEDGE_NODE:${fixturePrefix}-rollback-node`,
            studyTaskId: rollbackIds.task,
          },
        });
        await tx.userEvent.create({
          data: {
            id: rollbackIds.event,
            userId,
            type: 'plan.generated',
            eventKey: `PLAN_GENERATED:${rollbackGenerationKey}`,
            payload: { generationKey: rollbackGenerationKey },
          },
        });
        throw new Error('intentional generation transaction failure');
      }),
      /intentional generation transaction failure/,
    );

    assert.equal(await setup.studyPlan.count({ where: { id: rollbackIds.plan } }), 0, 'failed transaction must remove StudyPlan');
    assert.equal(await setup.studyTask.count({ where: { id: rollbackIds.task } }), 0, 'failed transaction must remove StudyTask');
    assert.equal(await setup.recommendationAction.count({ where: { id: rollbackIds.action } }), 0, 'failed transaction must remove RecommendationAction');
    assert.equal(await setup.userEvent.count({ where: { id: rollbackIds.event } }), 0, 'failed transaction must remove UserEvent');

    const result = {
      studyPlans: persistedPlanCount,
      studyTasks: persistedTaskCount,
      recommendationActions: persistedActionCount,
      planGeneratedEvents: persistedEventCount,
      rollbackArtifacts: 0,
    };
    console.log('generation reliability PostgreSQL integration assertions passed', result);
    return result;
  } finally {
    await workerA?.$disconnect();
    await workerB?.$disconnect();
    await setup.user.delete({ where: { id: userId } }).catch(() => undefined);
    await setup.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    if (isEnvironmentError(error)) {
      console.error(`ENVIRONMENT BLOCKED: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    if (isMigrationError(error)) {
      console.error(`MIGRATION NOT APPLIED: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
}
