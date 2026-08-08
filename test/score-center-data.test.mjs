import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

const requiredModels = [
  'KnowledgeNode',
  'KnowledgeRelation',
  'ExamPaper',
  'ExamQuestion',
  'ExamQuestionKnowledgeTag',
  'KnowledgeFrequencySnapshot',
  'KnowledgePointNodeMap',
  'QuestionKnowledgeNodeTag',
  'UserKnowledgeMastery',
];

const requiredEnums = [
  'KnowledgeRelationType',
  'ExamTagRole',
  'ExamTagPrecision',
  'ExamTagger',
  'TrendDirection',
  'EvidenceConfidence',
];

const requiredBridgeEnums = ['BridgeConfidence', 'BridgeSource', 'BridgeMatchMethod', 'BridgeStatus'];

const forbiddenModels = [
  'QuestionAttempt',
  'WrongQuestionRecord',
  'ReviewRecord',
  'DailyRecommendationBatch',
  'DailyRecommendationItem',
];

test('score-center prisma models exist', () => {
  for (const model of requiredModels) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`), `missing score-center model ${model}`);
  }
});

test('score-center enums exist', () => {
  for (const enumName of requiredEnums) {
    assert.match(schema, new RegExp(`enum\\s+${enumName}\\s+\\{`), `missing score-center enum ${enumName}`);
  }
});

test('bridge metadata enums exist', () => {
  for (const enumName of requiredBridgeEnums) {
    assert.match(schema, new RegExp(`enum\\s+${enumName}\\s+\\{`), `missing bridge enum ${enumName}`);
  }
  assert.match(schema, /enum\s+BridgeConfidence\s*\{\s*HIGH\s*MEDIUM\s*\}/);
  assert.match(schema, /enum\s+BridgeSource\s*\{\s*AUTO\s*MANUAL\s*\}/);
  assert.match(schema, /enum\s+BridgeMatchMethod\s*\{\s*EXACT_NAME\s*NORMALIZED_NAME\s*CONTEXT_MATCH\s*MANUAL\s*\}/);
  assert.match(schema, /enum\s+BridgeStatus\s*\{\s*ACTIVE\s*PENDING_REVIEW\s*REJECTED\s*INACTIVE\s*\}/);
});

test('KnowledgePointNodeMap carries bridge metadata', () => {
  const block = schema.match(/model\s+KnowledgePointNodeMap\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /confidenceLevel\s+BridgeConfidence/);
  assert.match(block, /source\s+BridgeSource/);
  assert.match(block, /matchMethod\s+BridgeMatchMethod/);
  assert.match(block, /status\s+BridgeStatus/);
  assert.doesNotMatch(block, /confidenceLevel\s+BridgeConfidence\s+@default/);
  assert.doesNotMatch(block, /source\s+BridgeSource\s+@default/);
  assert.doesNotMatch(block, /matchMethod\s+BridgeMatchMethod\s+@default/);
  assert.doesNotMatch(block, /status\s+BridgeStatus\s+@default/);
  assert.match(block, /mappingType\s+String\s+@default\("PRIMARY"\)/, 'legacy mappingType role field must be preserved, not repurposed');
  assert.match(block, /confidence\s+Float\?/, 'legacy confidence Float must be preserved');
  assert.match(block, /@@id\(\[knowledgePointId,\s*knowledgeNodeId\]\)/);
  assert.doesNotMatch(block, /@unique\s*\(\s*knowledgePointId\s*\)/, '1:N requires no single-column unique on knowledgePointId');
  assert.doesNotMatch(block, /@unique\s*\(\s*knowledgeNodeId\s*\)/, '1:N requires no single-column unique on knowledgeNodeId');
  assert.match(block, /@@index\(\[knowledgePointId,\s*status\]\)/);
  assert.match(block, /@@index\(\[knowledgeNodeId,\s*status\]\)/);
});

test('bridge migration is additive and backfills historical rows', () => {
  const dir = fs.readdirSync(new URL('../prisma/migrations', import.meta.url))
    .find((name) => name.includes('add_bridge_metadata'));
  assert.ok(dir, 'add_bridge_metadata migration must exist');
  const sql = fs.readFileSync(new URL(`../prisma/migrations/${dir}/migration.sql`, import.meta.url), 'utf8');
  assert.match(sql, /CREATE TYPE "BridgeConfidence" AS ENUM \('HIGH', 'MEDIUM'\)/);
  assert.match(sql, /"source" = 'MANUAL'/);
  assert.match(sql, /"confidenceLevel" = 'HIGH'/);
  assert.match(sql, /"status" = 'ACTIVE'/);
  assert.match(sql, /"matchMethod" = 'MANUAL'/);
  assert.match(sql, /ALTER COLUMN "confidenceLevel" SET NOT NULL/);
  assert.match(sql, /ALTER COLUMN "source" SET NOT NULL/);
  assert.match(sql, /ALTER COLUMN "status" SET NOT NULL/);
  assert.match(sql, /ALTER COLUMN "matchMethod" SET NOT NULL/);
  assert.doesNotMatch(sql, /"mappingType"/, 'migration must not alter the legacy mappingType column');
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM/);
});

test('no parallel second-source tables are added', () => {
  for (const model of forbiddenModels) {
    assert.doesNotMatch(schema, new RegExp(`^model\\s+${model}\\s+\\{`, 'm'), `forbidden model ${model}`);
  }
});

test('UserKnowledgeMastery keeps user and knowledge-node foreign keys', () => {
  const block = schema.match(/model\s+UserKnowledgeMastery\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /userId\s+String/);
  assert.match(block, /knowledgeNodeId\s+String/);
  assert.match(block, /user\s+User\s+@relation\([^)]*onDelete:\s*Cascade/);
  assert.match(block, /knowledgeNode\s+KnowledgeNode\s+@relation/);
  assert.match(block, /@@unique\(\[userId,\s*knowledgeNodeId\]\)/);
});

test('score-center columns extend existing tables', () => {
  const wrongReview = schema.match(/model\s+WrongQuestionReview\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(wrongReview, /\bresolved\s+Boolean\?/);
  assert.match(wrongReview, /\bresolvedAt\s+DateTime\?/);

  const plan = schema.match(/model\s+StudyPlan\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(plan, /\bsource\s+String\?/);
  assert.match(plan, /\bmodelVersion\s+String\?/);
  assert.match(plan, /\btargetExamDate\s+DateTime\?/);
  assert.match(plan, /\bavailableMinutes\s+Int\?/);
  assert.match(plan, /\bstale\s+Boolean/);

  const task = schema.match(/model\s+StudyTask\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(task, /\bknowledgeNodeId\s+String\?/);
  assert.match(task, /\bpriorityScore\s+Int\?/);
  assert.match(task, /\brecommendationAction\s+String\?/);
  assert.match(task, /\breasonCodes\s+Json\?/);
  assert.match(task, /\bscoreBreakdown\s+Json\?/);
  assert.match(task, /\bgeneratedRank\s+Int\?/);
  assert.match(task, /knowledgeNode\s+KnowledgeNode\?\s+@relation\([^)]*onDelete:\s*SetNull/);
});

test('2022-2026 exact mapping bundles keep canonical 150-point subject totals', () => {
  const expected = { DS: 45, CO: 45, OS: 35, CN: 25 };
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    const bundle = JSON.parse(
      fs.readFileSync(
        new URL(`../data/408/exam-mapping/408-${year}-question-knowledge-map.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.equal(bundle.questions.length, 47, `paper ${year} should have 47 questions`);
    const totals = {};
    for (const question of bundle.questions) {
      totals[question.subject] = (totals[question.subject] ?? 0) + (question.score ?? 0);
    }
    assert.deepEqual(totals, expected, `paper ${year} subject totals`);
  }
});
