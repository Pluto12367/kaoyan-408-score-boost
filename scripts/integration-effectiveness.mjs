/**
 * V6.3 Effectiveness PostgreSQL integration check.
 *
 * Seeds a full source-fact graph (user, knowledge point/node map, question,
 * practice records, mastery snapshots, recommendation action + study task +
 * completion, review schedule) into the test database at 127.0.0.1:55432
 * (see compose.test.yml / docs/current-sprint.md mine list) and verifies the
 * EffectivenessService derives outcomes, intervention events, profile and
 * experiments from REAL rows end-to-end.
 *
 * Prerequisite: the compose.test.yml postgres container must be running.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const userId = `eff-user-${runId}`;
const pointId = `eff-point-${runId}`;
const unmappedPointId = `eff-point-unmapped-${runId}`;
const nodeId = `eff-node-${runId}`;
const questionId = `eff-question-${runId}`;
const familyId = `eff-family-${runId}`;

const DAY = 86_400_000;

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
    const now = Date.now();
    const practiceDaysAgo = (days) => new Date(now - days * DAY);

    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@integration.test`,
        name: 'V6.3 Integration',
        role: 'STUDENT',
      },
    });
    await prisma.knowledgePoint.create({
      data: {
        id: pointId,
        subject: 'DATA_STRUCTURE',
        chapter: 'integration',
        title: `eff point ${runId}`,
        importance: 3,
        frequency: 3,
      },
    });
    await prisma.knowledgePoint.create({
      data: {
        id: unmappedPointId,
        subject: 'OPERATING_SYSTEM',
        chapter: 'integration',
        title: `eff unmapped ${runId}`,
        importance: 3,
        frequency: 3,
      },
    });
    await prisma.knowledgeNode.create({
      data: {
        id: nodeId,
        subject: 'DATA_STRUCTURE',
        nodeType: 'knowledge_point',
        name: `eff node ${runId}`,
        importance: 3,
        difficulty: 2,
        syllabusVersion: '2026',
      },
    });
    await prisma.knowledgePointNodeMap.create({
      data: { knowledgePointId: pointId, knowledgeNodeId: nodeId, mappingType: 'PRIMARY' },
    });
    await prisma.questionFamily.create({
      data: { id: familyId },
    });
    await prisma.question.create({
      data: {
        id: questionId,
        familyId,
        contentFingerprint: `eff-${runId}`,
        stem: 'integration seed question',
        options: ['A', 'B'],
        answer: 'A',
        analysis: 'seed',
        difficulty: 'BASIC',
        type: 'SINGLE_CHOICE',
        source: 'integration',
      },
    });

    // 5 window records on the mapped node (4 correct), 1 on an unmapped point
    // (must be dropped from node outcomes, not silently attributed).
    const practiceRows = [2, 3, 4, 5, 6].map((days, index) => ({
      userId,
      questionId,
      knowledgePointId: pointId,
      correct: index < 4,
      timeSpentSec: 60,
      expectedTimeSec: 100,
      submittedAt: practiceDaysAgo(days),
    }));
    practiceRows.push({
      userId,
      questionId,
      knowledgePointId: unmappedPointId,
      correct: true,
      timeSpentSec: 60,
      expectedTimeSec: 100,
      submittedAt: practiceDaysAgo(3),
    });
    await prisma.practiceRecord.createMany({ data: practiceRows });

    // Mastery snapshots: before-window 0.30, in-window 0.55 → gain 0.25.
    await prisma.userMasterySnapshot.create({
      data: { userId, knowledgeNodeId: nodeId, mastery: 0.3, attempts: 2, correctCount: 1, wrongCount: 1, snapshotDate: practiceDaysAgo(40) },
    });
    await prisma.userMasterySnapshot.create({
      data: { userId, knowledgeNodeId: nodeId, mastery: 0.55, attempts: 7, correctCount: 5, wrongCount: 2, snapshotDate: practiceDaysAgo(1) },
    });
    await prisma.userKnowledgeMastery.create({
      data: { userId, knowledgeNodeId: nodeId, mastery: 0.55, attempts: 7, correctCount: 5, wrongCount: 2 },
    });

    // Intervention chain: action → task (completed) → completion.
    const plan = await prisma.studyPlan.create({
      data: {
        userId,
        phase: 'integration',
        targetScore: 350,
        remainingDays: 100,
        dailyHours: 2,
        checkpoint: 'seed',
      },
    });
    const task = await prisma.studyTask.create({
      data: {
        planId: plan.id,
        knowledgePointId: pointId,
        knowledgeNodeId: nodeId,
        title: 'integration task',
        mode: 'practice',
        minutes: 30,
        questionCount: 5,
        scheduledDate: new Date(now - 3 * DAY).toISOString().slice(0, 10),
        startedAt: practiceDaysAgo(2),
        completedAt: practiceDaysAgo(1),
        completed: true,
        status: 'done',
      },
    });
    await prisma.recommendationAction.create({
      data: {
        userId,
        actionType: 'PRACTICE',
        targetType: 'KNOWLEDGE_NODE',
        targetId: nodeId,
        reason: 'seed',
        evidenceRefs: [],
        creationKey: `eff-key-${runId}`,
        studyTaskId: task.id,
        status: 'COMPLETED',
      },
    });
    await prisma.studyTaskCompletion.create({
      data: {
        userId,
        taskId: task.id,
        completedDate: new Date(now - 1 * DAY).toISOString().slice(0, 10),
        completedAt: practiceDaysAgo(1),
      },
    });
    await prisma.reviewSchedule.create({
      data: {
        userId,
        questionId,
        stability: 'learning',
        consecutiveCorrect: 0,
        nextReviewAt: practiceDaysAgo(-1),
        createdAt: practiceDaysAgo(2),
      },
    });

    // ---- Wire the V6.3 read model from dist classes ----
    const { PrismaService } = await import('../apps/api/dist/prisma/prisma.service.js');
    const { StudentStateProjectionService } = await import('../apps/api/dist/study/student-state-projection.service.js');
    const { PracticeProjectionService } = await import('../apps/api/dist/study/practice-projection.service.js');
    const { WrongQuestionProjectionService } = await import('../apps/api/dist/study/wrong-question-projection.service.js');
    const { TodayPlanProjectionService } = await import('../apps/api/dist/study/today-plan-projection.service.js');
    const { AssessmentProjectionService } = await import('../apps/api/dist/study/assessment-projection.service.js');
    const { StudentContextQueryService } = await import('../apps/api/dist/study/student-context.query.service.js');
    const { AiMetricsService } = await import('../apps/api/dist/ai-metrics/ai-metrics.service.js');
    const { EffectivenessService } = await import('../apps/api/dist/effectiveness/effectiveness.service.js');

    const prismaService = new PrismaService({ datasourceUrl: databaseUrl });
    const stateProjection = new StudentStateProjectionService(prismaService);
    const practiceProjection = new PracticeProjectionService(prismaService);
    const wrongProjection = new WrongQuestionProjectionService(prismaService);
    const todayPlanProjection = new TodayPlanProjectionService(prismaService, stateProjection, wrongProjection);
    const assessmentProjection = new AssessmentProjectionService(prismaService);
    const studentContext = new StudentContextQueryService(
      stateProjection,
      practiceProjection,
      wrongProjection,
      todayPlanProjection,
      assessmentProjection,
      prismaService,
    );
    const metrics = new AiMetricsService();
    const service = new EffectivenessService(prismaService, studentContext, metrics);

    // ---- Outcomes: real derivation through the pipeline ----
    const outcomes = await service.getOutcomes(userId, 30);
    assert.equal(outcomes.hasLearningData, true, 'outcomes should see window practice');
    assert.equal(outcomes.outcomes.length, 1, 'unmapped point must not produce a node outcome');
    const outcome = outcomes.outcomes[0];
    assert.equal(outcome.knowledgeNodeId, nodeId);
    assert.equal(outcome.masteryBefore, 0.3);
    assert.equal(outcome.masteryAfter, 0.55);
    assert.equal(outcome.masteryGain, 0.25);
    assert.equal(outcome.attemptsInWindow, 5);
    assert.equal(outcome.quality, 'ok');
    assert.equal(outcome.confidence, 'high');
    assert.equal(outcome.evidenceGate.passed, true, 'strong sample should pass the evidence gate');
    assert.equal(outcomes.summary.gatePassed, 1);

    // ---- Interventions: derived events + correlations ----
    const interventions = await service.getInterventions(userId);
    assert.equal(interventions.hasSourceFacts, true);
    const completedEvent = interventions.events.find((view) => view.event.type === 'study_plan_task');
    assert.ok(completedEvent, 'completed study plan task should derive an event');
    assert.equal(completedEvent.event.status, 'completed');
    assert.equal(completedEvent.event.targetKnowledgeNodeId, nodeId);
    assert.equal(completedEvent.outcomeCorrelation.matched, true, 'event should correlate to node outcome');
    assert.equal(completedEvent.outcomeCorrelation.method, 'knowledge_node');
    assert.equal(completedEvent.outcomeCorrelation.masteryGain, 0.25);
    const reviewEvent = interventions.events.find((view) => view.event.type === 'review_task');
    assert.ok(reviewEvent, 'review schedule should derive a review intervention');
    assert.equal(reviewEvent.event.status, 'delivered');
    assert.equal(interventions.byStatus.completed, 1);

    // ---- Profile: classifyStudent over real aggregates ----
    const profile = await service.getProfile(userId);
    assert.equal(profile.hasLearningData, true);
    assert.ok(profile.profile, 'student with practice data must classify');
    assert.ok(profile.inputs.avgMastery > 0, 'avg mastery should come from UserKnowledgeMastery');
    assert.ok(profile.inputs.recentAccuracy >= 0.8, 'recent accuracy = 5/6 mapped+unmapped records');

    // ---- Summary aggregation ----
    const summary = await service.getSummary(userId, 30);
    assert.equal(summary.outcomes.summary.gatePassed, 1);
    assert.equal(summary.interventions.byStatus.completed, 1);
    assert.ok(summary.profile.profile);

    // ---- Experiments: single-user population stays honest ----
    const experiments = await service.getExperiments(30);
    assert.equal(experiments.design, 'observational_cohort');
    assert.equal(experiments.experiment.verdict, 'insufficient_data', 'one-user population must not fabricate a verdict');
    assert.equal(experiments.proposals.length, 0, 'no proposals without sufficient evidence');

    // ---- Observability counters ----
    const snapshot = metrics.snapshotLearningIntelligence();
    assert.ok(snapshot.effectiveness.derivations >= 4, 'derivation events should be recorded');
    assert.ok(snapshot.effectiveness.gatePassed >= 1);

    console.log('V6.3 effectiveness integration: ALL PASS');
    console.log(JSON.stringify({
      outcome: { masteryGain: outcome.masteryGain, gatePassed: outcome.evidenceGate.passed },
      interventions: interventions.byStatus,
      profile: profile.profile?.archetype,
      experiments: experiments.experiment.verdict,
      metrics: snapshot.effectiveness,
    }, null, 2));
  } finally {
    await prisma.$transaction([
      prisma.user.deleteMany({ where: { id: userId } }),
      prisma.question.deleteMany({ where: { id: questionId } }),
      prisma.questionFamily.deleteMany({ where: { id: familyId } }),
      prisma.knowledgePoint.deleteMany({ where: { id: { in: [pointId, unmappedPointId] } } }),
      prisma.knowledgeNode.deleteMany({ where: { id: nodeId } }),
    ]);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('V6.3 effectiveness integration FAILED:', error);
  process.exitCode = 1;
});
