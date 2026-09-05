import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { LearningSessionActionService } = require('../apps/api/src/study/learning-session-action.service.ts');
const { LearningSessionRepository } = require('../apps/api/src/study/learning-session.repository.ts');
const { RecommendationActionService } = require('../apps/api/src/study/recommendation-action.service.ts');

test('Nest resolves the action session repository and invokes its persisted-session lookup', async () => {
  const persisted = { id: 'persisted-session', userId: 'u-1', actionId: 'a-1' };
  class FixtureModule {}
  Module({ providers: [LearningSessionActionService,
    { provide: RecommendationActionService, useValue: { getAction: async () => ({ status: 'STARTED' }) } },
    { provide: LearningSessionRepository, useValue: { findByActionId: async () => persisted } },
  ] })(FixtureModule);
  const app = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  try {
    const service = app.get(LearningSessionActionService);
    assert.deepEqual(await service.createLearningSessionFromAction({ userId: 'u-1', actionId: 'a-1', resourceId: 'r-1' }), persisted);
  } finally { await app.close(); }
});
