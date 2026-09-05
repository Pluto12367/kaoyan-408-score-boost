import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)); require('ts-node/register');
const { ActionOutcomeAuditService } = require('../apps/api/src/study/action-outcome-audit.service.ts');
const { ActionDomainError } = require('../apps/api/src/study/recommendation-action.service.ts');

class FakeActions { constructor(action) { this.action = action; } async getAction(userId) { if (!this.action) throw new ActionDomainError('ACTION_NOT_FOUND'); if (this.action.userId !== userId) throw new ActionDomainError('ACTION_FORBIDDEN'); return this.action; } }
class FakeAuditRepo { constructor(practice = [], reviews = []) { this.practice = practice; this.reviews = reviews; } async aggregate(actionId, userId) { return { practice: this.practice.filter((x) => x.actionId === actionId && x.userId === userId), reviews: this.reviews.filter((x) => x.actionId === actionId && x.userId === userId) }; } }
const build = (status, practice = [], reviews = []) => new ActionOutcomeAuditService(new FakeActions({ id: 'a-1', userId: 'u-1', status }), new FakeAuditRepo(practice, reviews));
const p = (id, actionId = 'a-1') => ({ id, actionId, userId: 'u-1', submittedAt: new Date('2026-01-01T00:00:00Z') });
const r = (id, actionId = 'a-1') => ({ id, actionId, userId: 'u-1', reviewedAt: new Date('2026-01-02T00:00:00Z') });

test('CREATED without outcomes is NO_OUTCOME', async () => assert.equal((await build('CREATED').buildOutcome('u-1', 'a-1')).status, 'NO_OUTCOME'));
test('STARTED with practice is IN_PROGRESS', async () => assert.equal((await build('STARTED', [p('p-1')]).buildOutcome('u-1', 'a-1')).status, 'IN_PROGRESS'));
test('STARTED with review is IN_PROGRESS', async () => assert.equal((await build('STARTED', [], [r('r-1')]).buildOutcome('u-1', 'a-1')).status, 'IN_PROGRESS'));
test('COMPLETED with outcome is COMPLETED', async () => assert.equal((await build('COMPLETED', [p('p-1')]).buildOutcome('u-1', 'a-1')).status, 'COMPLETED'));
test('CANCELLED is FAILED', async () => assert.equal((await build('CANCELLED', [p('p-1')]).buildOutcome('u-1', 'a-1')).status, 'FAILED'));
test('EXPIRED is FAILED', async () => assert.equal((await build('EXPIRED').buildOutcome('u-1', 'a-1')).status, 'FAILED'));
test('aggregates multiple practice records', async () => { const x = await build('STARTED', [p('p-1'), p('p-2')]).buildOutcome('u-1', 'a-1'); assert.equal(x.practiceCount, 2); assert.deepEqual(x.evidenceRefs, ['practice-record:p-1', 'practice-record:p-2']); });
test('aggregates multiple review attempts', async () => { const x = await build('STARTED', [], [r('r-1'), r('r-2')]).buildOutcome('u-1', 'a-1'); assert.equal(x.reviewAttemptCount, 2); assert.deepEqual(x.evidenceRefs, ['review-attempt:r-1', 'review-attempt:r-2']); });
test('aggregates practice and review outcomes', async () => { const x = await build('STARTED', [p('p-1')], [r('r-1')]).buildOutcome('u-1', 'a-1'); assert.equal(x.practiceCount, 1); assert.equal(x.reviewAttemptCount, 1); });
test('missing action returns ACTION_NOT_FOUND', async () => { const s = new ActionOutcomeAuditService(new FakeActions(null), new FakeAuditRepo()); await assert.rejects(() => s.buildOutcome('u-1', 'missing'), (e) => e.code === 'ACTION_NOT_FOUND'); });
test('foreign action returns ACTION_FORBIDDEN', async () => { const s = new ActionOutcomeAuditService(new FakeActions({ id: 'a-1', userId: 'u-2', status: 'STARTED' }), new FakeAuditRepo()); await assert.rejects(() => s.buildOutcome('u-1', 'a-1'), (e) => e.code === 'ACTION_FORBIDDEN'); });
test('action identity differs from outcome identities', async () => { const x = await build('STARTED', [p('p-1')], [r('r-1')]).buildOutcome('u-1', 'a-1'); assert.notEqual(x.actionId, 'p-1'); assert.notEqual(x.actionId, 'r-1'); });
test('timestamps and evidence are derived only from supplied facts', async () => { const x = await build('STARTED', [p('p-1')], [r('r-1')]).buildOutcome('u-1', 'a-1'); assert.equal(x.firstOutcomeAt.toISOString(), '2026-01-01T00:00:00.000Z'); assert.equal(x.lastOutcomeAt.toISOString(), '2026-01-02T00:00:00.000Z'); });
