/**
 * M3 Phase-C migration switch contract.
 *
 * The switch exists so the approved candidate can be enabled by an operator
 * without a code change, and disabled just as cheaply. Two properties matter
 * more than anything else and are pinned here:
 *
 *   1. the default is bit-identical to today's production behaviour, so simply
 *      deploying the switch changes nothing;
 *   2. a typo or an unknown value falls back to the default rather than
 *      silently enabling a semantic change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  MASTERY_SEMANTICS_ENV,
  DEFAULT_MASTERY_SEMANTICS,
  MASTERY_SEMANTICS_MODEL,
  MASTERY_SEMANTICS_CATALOGUE,
  parseMasterySemantics,
  resolveMasterySemantics,
  isCandidateEnabled,
  applyMasterySemantics,
  describeMasterySemantics,
  updateMasteryAfterAttempt,
  updateMasteryDirectionPreserving,
} from '../packages/shared/dist/index.js';

function state(mastery) {
  return {
    mastery,
    accuracy: mastery,
    recentAccuracy: mastery,
    attempts: 4,
    correctCount: Math.round(4 * mastery),
    wrongCount: 4 - Math.round(4 * mastery),
    confidence: 0.3,
  };
}

const wrongAtEasy = { isCorrect: false, difficulty: 1, role: 'PRIMARY' };
const correctAtEasy = { isCorrect: true, difficulty: 1, role: 'PRIMARY' };

// ---------------------------------------------------------------------------
// Default is legacy — deploying the switch must change nothing
// ---------------------------------------------------------------------------

test('the default semantics is legacy', () => {
  assert.equal(DEFAULT_MASTERY_SEMANTICS, 'legacy');
  assert.equal(resolveMasterySemantics({}), 'legacy');
  assert.equal(isCandidateEnabled({}), false);
});

test('an unset variable, an empty value and any unknown value all resolve to legacy', () => {
  assert.equal(parseMasterySemantics(undefined), 'legacy');
  assert.equal(parseMasterySemantics(null), 'legacy');
  assert.equal(parseMasterySemantics(''), 'legacy');
  assert.equal(parseMasterySemantics('legacy'), 'legacy');
  assert.equal(parseMasterySemantics('C2'), 'legacy', 'a rejected candidate must not be selectable');
  assert.equal(parseMasterySemantics('direction_preserving'), 'legacy', 'mechanism names are not switch values');
  assert.equal(parseMasterySemantics('true'), 'legacy', 'a boolean-looking value must not enable it');
  assert.equal(parseMasterySemantics('c11'), 'legacy', 'prefix matching is not enough');
  assert.equal(parseMasterySemantics(' c1 '), 'c1', 'trimmed and case-insensitive');
  assert.equal(parseMasterySemantics('C1'), 'c1');
});

test('the legacy path is bit-identical to the production transition', () => {
  for (const mastery of [0.05, 0.22, 0.4, 0.6, 0.8, 0.95, 1]) {
    for (const difficulty of [1, 2, 3, 4, 5]) {
      for (const isCorrect of [true, false]) {
        const signal = { isCorrect, difficulty, role: 'PRIMARY' };
        const viaSwitch = applyMasterySemantics('legacy', state(mastery), signal);
        const direct = updateMasteryAfterAttempt(state(mastery), signal);
        assert.deepEqual(
          viaSwitch,
          direct,
          `legacy must be indistinguishable from production at mastery ${mastery}, d${difficulty}, correct=${isCorrect}`,
        );
      }
    }
  }
});

test('the c1 path is bit-identical to the measured candidate mechanism', () => {
  for (const mastery of [0.05, 0.22, 0.4, 0.6, 0.8, 0.95]) {
    for (const difficulty of [1, 3, 5]) {
      for (const isCorrect of [true, false]) {
        const signal = { isCorrect, difficulty, role: 'PRIMARY' };
        assert.deepEqual(
          applyMasterySemantics('c1', state(mastery), signal),
          updateMasteryDirectionPreserving(state(mastery), signal),
          `c1 must be the measured mechanism at mastery ${mastery}, d${difficulty}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Enabling and disabling
// ---------------------------------------------------------------------------

test('setting the variable to c1 enables the candidate, and only that value does', () => {
  assert.equal(resolveMasterySemantics({ [MASTERY_SEMANTICS_ENV]: 'c1' }), 'c1');
  assert.equal(isCandidateEnabled({ [MASTERY_SEMANTICS_ENV]: 'c1' }), true);
  assert.equal(isCandidateEnabled({ [MASTERY_SEMANTICS_ENV]: 'yes' }), false);
  assert.equal(isCandidateEnabled({ [MASTERY_SEMANTICS_ENV]: 'legacy' }), false);
});

test('enabling c1 changes the two symptom cases and nothing else', () => {
  const legacyOnFailure = applyMasterySemantics('legacy', state(0.22), wrongAtEasy);
  const c1OnFailure = applyMasterySemantics('c1', state(0.22), wrongAtEasy);
  assert.ok(legacyOnFailure.mastery > 0.22, 'legacy raises mastery on a failed easy review');
  assert.ok(c1OnFailure.mastery <= 0.22, 'c1 does not');

  const legacyOnSuccess = applyMasterySemantics('legacy', state(0.95), correctAtEasy);
  const c1OnSuccess = applyMasterySemantics('c1', state(0.95), correctAtEasy);
  assert.ok(legacyOnSuccess.mastery < 0.95, 'legacy lowers mastery on a correct easy review');
  assert.ok(c1OnSuccess.mastery >= 0.95, 'c1 does not');
});

test('switching back restores legacy behaviour for subsequent transitions', () => {
  const initial = state(0.22);
  const underC1 = applyMasterySemantics('c1', initial, wrongAtEasy);
  const backToLegacy = applyMasterySemantics('legacy', initial, wrongAtEasy);
  assert.ok(underC1.mastery <= initial.mastery);
  assert.ok(backToLegacy.mastery > initial.mastery, 'legacy behaviour is restored immediately');
  // The rollback does not rewrite what c1 already produced — it only governs the
  // next transition, which is what a mastery source of truth requires.
  assert.notEqual(underC1.mastery, backToLegacy.mastery);
});

// ---------------------------------------------------------------------------
// Auditability
// ---------------------------------------------------------------------------

test('the catalogue names every switch value and marks approval', () => {
  assert.equal(MASTERY_SEMANTICS_CATALOGUE.length, 2);
  assert.deepEqual(MASTERY_SEMANTICS_CATALOGUE.map((entry) => entry.id).sort(), ['c1', 'legacy']);
  for (const entry of MASTERY_SEMANTICS_CATALOGUE) {
    assert.ok(entry.label.length > 0);
    assert.ok(entry.description.length > 0);
    assert.equal(entry.approved, true);
    assert.equal(MASTERY_SEMANTICS_MODEL[entry.id], entry.model);
  }
  assert.equal(MASTERY_SEMANTICS_MODEL.c1, 'direction_preserving');
  assert.equal(MASTERY_SEMANTICS_MODEL.legacy, 'production');
});

test('the startup description names the active semantics and how it was chosen', () => {
  assert.match(describeMasterySemantics({}), /legacy/);
  assert.match(describeMasterySemantics({}), /未设置/);
  assert.match(describeMasterySemantics({ [MASTERY_SEMANTICS_ENV]: 'c1' }), /c1/);
  assert.match(describeMasterySemantics({ [MASTERY_SEMANTICS_ENV]: 'c1' }), /显式启用/);
  assert.match(describeMasterySemantics({ [MASTERY_SEMANTICS_ENV]: 'nonsense' }), /回落默认/);
});

// ---------------------------------------------------------------------------
// Reversibility must not require code or schema changes
// ---------------------------------------------------------------------------

test('the switch introduces no schema, no migration and no API change', () => {
  const source = readFileSync(
    new URL('../packages/shared/src/score-center/mastery-semantics-switch.ts', import.meta.url),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of ['prisma', 'fetch(', 'process.exit', 'throw new Error']) {
    assert.ok(!code.includes(forbidden), `the switch must not contain ${forbidden}`);
  }
  assert.ok(!/ALTER TABLE|CREATE TABLE/.test(source), 'no schema work belongs in the switch');
});

test('the switch is consulted only from the audited mastery entry points', () => {
  // V12-M3-C added a second mastery entry point (review→mastery projection), so
  // "exactly one occurrence" is no longer the right invariant. What must stay
  // true — and is what makes switching auditable — is that mastery has ONE owner
  // module, that only a KNOWN set of methods may apply the semantics, and that
  // every one of them resolves the switch instead of hard-coding a model. A
  // third silent site is precisely how a second 口径 would appear.
  const service = readFileSync(
    new URL('../apps/api/src/score-center/service.ts', import.meta.url),
    'utf8',
  );
  const applications = [...service.matchAll(/applyMasterySemantics\(/g)];
  assert.equal(applications.length, 2, 'mastery must be applied from the audited entry points only');

  const owners = applications.map((match) => enclosingAsyncMethod(service, match.index));
  assert.deepEqual(
    owners,
    ['applySingleAttempt', 'applyReviewObservation'],
    'a new call site must be a deliberate, reviewed decision — this list is the audit record',
  );
  for (const match of applications) {
    // Check the whole enclosing METHOD body, not just the text before the call:
    // one entry point inlines `applyMasterySemantics(resolveMasterySemantics(), …)`
    // and the other hoists the resolve into a local first, and both are correct.
    const methodStart = service.lastIndexOf('async ', match.index);
    const nextMethod = service.indexOf('\n  async ', match.index);
    const methodBody = service.slice(methodStart, nextMethod > match.index ? nextMethod : service.length);
    assert.ok(
      methodBody.includes('resolveMasterySemantics'),
      `${enclosingAsyncMethod(service, match.index)} must resolve the switch rather than hard-code a semantics`,
    );
  }

  // One owner module in the whole API: no other file may apply the transition.
  const offenders = [];
  for (const file of listTypeScriptFiles(new URL('../apps/api/src/', import.meta.url))) {
    const source = readFileSync(file, 'utf8');
    if (source.includes('applyMasterySemantics(')) {
      offenders.push(file.pathname.split('/src/').pop());
    }
  }
  assert.deepEqual(offenders, ['score-center/service.ts'], 'mastery semantics have exactly one owner module');
});

/** The nearest preceding `async name(` — enough to attribute a call site. */
function enclosingAsyncMethod(source, index) {
  const matches = [...source.slice(0, index).matchAll(/(?:private |public |protected )?async (\w+)\(/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function listTypeScriptFiles(dirUrl) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.ts')) found.push(child);
    }
  };
  walk(dirUrl);
  return found;
}

test('production no longer calls the legacy transition directly for attempts', () => {
  const service = readFileSync(
    new URL('../apps/api/src/score-center/service.ts', import.meta.url),
    'utf8',
  );
  const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !code.includes('updateMasteryAfterAttempt('),
    'the attempt path must go through the switch, otherwise the flag cannot take effect',
  );
});
