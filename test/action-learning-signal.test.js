import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)); require('ts-node/register');
const { ActionLearningSignalService } = require('../apps/api/src/study/action-learning-signal.service.ts');
const { ActionDomainError } = require('../apps/api/src/study/recommendation-action.service.ts');
class Actions { constructor(action) { this.action = action; } async getAction(userId) { if (!this.action) throw new ActionDomainError('ACTION_NOT_FOUND'); if (this.action.userId !== userId) throw new ActionDomainError('ACTION_FORBIDDEN'); return this.action; } }
class Audits { constructor(audit) { this.audit = audit; } async buildOutcome() { return this.audit; } }
const run = (status, audit) => new ActionLearningSignalService(new Actions({ id: 'a-1', userId: 'u-1', status }), new Audits({ actionId: 'a-1', evidenceRefs: ['practice-record:p-1'], ...audit }));
test('COMPLETED with practice is SUCCESS', async () => assert.equal((await run('COMPLETED', { practiceCount: 1, reviewAttemptCount: 0, status: 'COMPLETED' }).buildSignal('u-1', 'a-1')).outcomeStatus, 'SUCCESS'));
test('COMPLETED with review is SUCCESS', async () => assert.equal((await run('COMPLETED', { practiceCount: 0, reviewAttemptCount: 1, status: 'COMPLETED' }).buildSignal('u-1', 'a-1')).outcomeStatus, 'SUCCESS'));
test('STARTED with outcome is PARTIAL', async () => assert.equal((await run('STARTED', { practiceCount: 1, reviewAttemptCount: 0, status: 'IN_PROGRESS' }).buildSignal('u-1', 'a-1')).outcomeStatus, 'PARTIAL'));
test('STARTED without outcome is NO_OUTCOME', async () => assert.equal((await run('STARTED', { practiceCount: 0, reviewAttemptCount: 0, status: 'IN_PROGRESS', evidenceRefs: [] }).buildSignal('u-1', 'a-1')).outcomeStatus, 'NO_OUTCOME'));
test('CANCELLED is FAILED', async () => assert.equal((await run('CANCELLED', { practiceCount: 0, reviewAttemptCount: 0, status: 'FAILED' }).buildSignal('u-1', 'a-1')).outcomeStatus, 'FAILED'));
test('EXPIRED is FAILED', async () => assert.equal((await run('EXPIRED', { practiceCount: 0, reviewAttemptCount: 0, status: 'FAILED' }).buildSignal('u-1', 'a-1')).outcomeStatus, 'FAILED'));
test('missing action propagates ACTION_NOT_FOUND', async () => { const s = new ActionLearningSignalService(new Actions(null), new Audits({})); await assert.rejects(() => s.buildSignal('u-1', 'missing'), (e) => e.code === 'ACTION_NOT_FOUND'); });
test('foreign action propagates ACTION_FORBIDDEN', async () => { const s = new ActionLearningSignalService(new Actions({ id: 'a-1', userId: 'u-2', status: 'STARTED' }), new Audits({})); await assert.rejects(() => s.buildSignal('u-1', 'a-1'), (e) => e.code === 'ACTION_FORBIDDEN'); });
test('evidence passes through without fabrication', async () => { const x = await run('COMPLETED', { practiceCount: 1, reviewAttemptCount: 1, status: 'COMPLETED', evidenceRefs: ['practice-record:p-1', 'review-attempt:r-1'] }).buildSignal('u-1', 'a-1'); assert.deepEqual(x.evidenceRefs, ['practice-record:p-1', 'review-attempt:r-1']); });
test('confidence is deterministic', async () => { assert.equal((await run('COMPLETED', { practiceCount: 1, status: 'COMPLETED' }).buildSignal('u-1', 'a-1')).confidence, 1); assert.equal((await run('STARTED', { practiceCount: 1, status: 'IN_PROGRESS' }).buildSignal('u-1', 'a-1')).confidence, 0.5); assert.equal((await run('CANCELLED', { status: 'FAILED' }).buildSignal('u-1', 'a-1')).confidence, 0.2); assert.equal((await run('STARTED', { status: 'NO_OUTCOME', evidenceRefs: [] }).buildSignal('u-1', 'a-1')).confidence, 0); });
