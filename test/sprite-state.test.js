import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V10-1 Sprite Core — companion-layer mood engine + persona guardrails.
// Red lines under test (docs/v10-sprite-product-constitution.md §5/§7):
//   - 9-state deterministic mood ladder (evidence-guarded, first match wins)
//   - persona forbidden-word validation (constitution §3.3, six categories)
//   - insufficient_data vs context_unavailable degradation (never disguised)
//   - evidenceRefs completeness (every mood + every line carries evidence)
// The sprite is a companion layer, never a source of learning facts:
// pure derivation, zero storage, zero LLM, numbers only interpolated.

const STATE_URL = new URL('../apps/api/src/study/sprite-state.ts', import.meta.url);
const PERSONA_URL = new URL('../apps/api/src/study/sprite-persona.ts', import.meta.url);

async function loadModules() {
  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const personaSource = await readFile(PERSONA_URL, 'utf8');
  const personaModule = { exports: {} };
  new Function('require', 'module', 'exports', compile(personaSource))(
    (requested) => {
      throw new Error(`sprite-persona must stay dependency-free (requested: ${requested})`);
    },
    personaModule,
    personaModule.exports,
  );

  const stateSource = await readFile(STATE_URL, 'utf8');
  const stateModule = { exports: {} };
  new Function('require', 'module', 'exports', compile(stateSource))(
    (requested) => {
      if (requested === './sprite-persona') return personaModule.exports;
      throw new Error(`sprite-state must stay dependency-free except ./sprite-persona (requested: ${requested})`);
    },
    stateModule,
    stateModule.exports,
  );

  return { ...personaModule.exports, ...stateModule.exports };
}

// ---------------------------------------------------------------------------
// Fixtures: the full input snapshot (see docs/v10-1-sprite-core-design.md §3).
// ---------------------------------------------------------------------------

const baseInput = (overrides = {}) => ({
  asOf: '2026-09-07T10:00:00.000Z',
  userId: 'u-sprite',
  context: {
    momentum: { studyStreak: 0 },
    practice: {
      recentAccuracy: { status: 'insufficient_data', value: null, sampleSize: 0 },
      totalCount: 0,
    },
    review: { dueCount: 0, overdueCount: 0 },
  },
  plan: null,
  interventions: [],
  story: null,
  activeSession: false,
  unavailableSources: [],
  ...overrides,
});

const planLite = (overrides = {}) => ({
  completedTasks: 0,
  totalTasks: 0,
  recoveredFromGap: false,
  carryOverCount: 0,
  firstOpenTaskTitle: null,
  ...overrides,
});

const intervention = (overrides = {}) => ({
  id: 'review_debt-2026-09-07-0',
  trigger: 'review_debt',
  severity: 'high',
  headline: '有 13 项复习已逾期（共 11 项到期），先清偿复习债',
  actions: ['按到期顺序完成复习队列', '逾期项优先'],
  actorHint: 'review',
  ...overrides,
});

const storyLite = (overrides = {}) => ({
  weekDelta: null,
  gatesPassed: 0,
  resolvedCount: null,
  streak: 0,
  ...overrides,
});

// Order-agnostic: accepts either an overrides object or a full input, always
// returns a complete input whose practice trend is sufficient.
const withSufficientPractice = (overrides = {}) => {
  const input = baseInput(overrides);
  return {
    ...input,
    context: {
      ...input.context,
      practice: {
        recentAccuracy: { status: 'sufficient', value: 0.62, sampleSize: 40 },
        totalCount: 120,
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Contract sweep helper: resolve a dotted field path against the input.
// ---------------------------------------------------------------------------

function resolveField(input, field) {
  let node = input;
  for (const segment of field.split('.')) {
    if (node == null || typeof node !== 'object' || !(segment in Object(node))) {
      return { exists: false, value: undefined };
    }
    node = node[segment];
  }
  return { exists: true, value: node };
}

function collectEvidence(state) {
  const refs = [...state.moodReason.evidenceRefs];
  for (const line of state.lines) refs.push(...line.evidenceRefs);
  return refs;
}

// ---------------------------------------------------------------------------
// 1. Nine-state mood engine (ordered guards, first match wins)
// ---------------------------------------------------------------------------

test('mood ladder: guard #1 — unavailable context degrades to unknown/context_unavailable, transparently', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({ context: null, unavailableSources: ['student_context'] }));
  assert.equal(state.mood, 'unknown');
  assert.equal(state.moodReason.kind, 'context_unavailable');
  assert.equal(state.degraded.contextAvailable, false);
  assert.deepEqual([...state.degraded.unavailableSources], ['student_context']);
  assert.match(state.lines[0].text, /没读到你的学习数据/, 'upstream failure must be named, never disguised as a new user');
});

test('mood ladder: guard #2 — active session forces focused, quiet presence, zero lines', async () => {
  const { buildSpriteState } = await loadModules();
  const noisy = baseInput({
    activeSession: true,
    plan: planLite({ recoveredFromGap: true, totalTasks: 2 }),
    interventions: [intervention()],
  });
  const state = buildSpriteState(noisy);
  assert.equal(state.mood, 'focused');
  assert.equal(state.presence.mode, 'quiet');
  assert.deepEqual([...state.lines], [], 'low disturbance during a session means the sprite stays silent');
});

test('mood ladder: guard #3 — recovery beats concern (gap recovery and carry-over variants)', async () => {
  const { buildSpriteState } = await loadModules();
  const risky = [intervention()];

  const gap = buildSpriteState(baseInput(withSufficientPractice({
    plan: planLite({ recoveredFromGap: true, carryOverCount: 0, totalTasks: 2, firstOpenTaskTitle: '死锁避免' }),
    interventions: risky,
  })));
  assert.equal(gap.mood, 'recovery');
  assert.equal(gap.moodReason.kind, 'gap_recovery');

  const carry = buildSpriteState(baseInput(withSufficientPractice({
    plan: planLite({ recoveredFromGap: false, carryOverCount: 2, totalTasks: 2 }),
    interventions: risky,
  })));
  assert.equal(carry.mood, 'recovery');
  assert.equal(carry.moodReason.kind, 'carry_over');
  assert.match(carry.lines[0].text, /2 个未完成任务/);
});

test('mood ladder: guard #4 — concern from high, then medium severity; low never worries', async () => {
  const { buildSpriteState } = await loadModules();
  const high = buildSpriteState(baseInput(withSufficientPractice({
    interventions: [intervention({ severity: 'high' })],
  })));
  assert.equal(high.mood, 'concern');
  assert.equal(high.moodReason.kind, 'high_risk');
  assert.equal(high.lines[0].text, '有 13 项复习已逾期（共 11 项到期），先清偿复习债', 'intervention headline is reused verbatim — numbers are never recomputed');

  const medium = buildSpriteState(baseInput(withSufficientPractice({
    interventions: [intervention({ severity: 'medium', headline: '有 3 项复习到期，建议先完成复习' })],
  })));
  assert.equal(medium.mood, 'concern');
  assert.equal(medium.moodReason.kind, 'medium_risk');

  const lowOnly = buildSpriteState(withSufficientPractice(baseInput({
    interventions: [intervention({ severity: 'low' })],
  })));
  assert.notEqual(lowOnly.mood, 'concern', 'low-severity signals must not trouble the student');
});

test('mood ladder: guard #5 — celebrate from gain, evidence gate, then resolved count', async () => {
  const { buildSpriteState } = await loadModules();
  const gain = buildSpriteState(baseInput(withSufficientPractice({ story: storyLite({ weekDelta: 1.4 }) })));
  assert.equal(gain.mood, 'celebrate');
  assert.equal(gain.moodReason.kind, 'progress_gain');
  assert.match(gain.lines[0].text, /\+1\.4 点/);

  const gates = buildSpriteState(baseInput(withSufficientPractice({ story: storyLite({ gatesPassed: 3 }) })));
  assert.equal(gates.mood, 'celebrate');
  assert.equal(gates.moodReason.kind, 'evidence_milestone');
  assert.match(gates.lines[0].text, /3 个知识节点/);

  const resolved = buildSpriteState(baseInput(withSufficientPractice({
    story: storyLite({ weekDelta: 0.4, resolvedCount: 2 }),
  })));
  assert.equal(resolved.mood, 'celebrate');
  assert.match(resolved.lines[0].text, /2 道错题/);

  const flat = buildSpriteState(baseInput(withSufficientPractice({ story: storyLite({ weekDelta: 0.4 }) })));
  assert.notEqual(flat.mood, 'celebrate', 'no celebration without a real gain or milestone');
});

test('mood ladder: guard #6 — rest requires a finished plan AND zero review debt', async () => {
  const { buildSpriteState } = await loadModules();
  const done = baseInput(withSufficientPractice({
    plan: planLite({ totalTasks: 3, completedTasks: 3 }),
    context: {
      momentum: { studyStreak: 0 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
      review: { dueCount: 0, overdueCount: 0 },
    },
  }));
  const rest = buildSpriteState(done);
  assert.equal(rest.mood, 'rest');
  assert.equal(rest.moodReason.kind, 'plan_complete');

  const debtWhileDone = buildSpriteState(baseInput({
    plan: planLite({ totalTasks: 3, completedTasks: 3 }),
    context: {
      momentum: { studyStreak: 0 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
      review: { dueCount: 2, overdueCount: 0 },
    },
  }));
  assert.notEqual(debtWhileDone.mood, 'rest', 'review debt keeps the sprite from declaring the day closed');
  assert.notEqual(debtWhileDone.mood, 'encourage', 'no open tasks — "go do more" would be dishonest');
});

test('mood ladder: guard #7 — streak fires at three or more days', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({
    context: {
      momentum: { studyStreak: 5 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
      review: { dueCount: 0, overdueCount: 0 },
    },
  }));
  assert.equal(state.mood, 'streak');
  assert.equal(state.moodReason.kind, 'streak_active');
  assert.match(state.lines[0].text, /连续学习 5 天/);
  assert.equal(state.bond.streakDays, 5);
});

test('mood ladder: guard #8 — encourage names the first open task', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({
    plan: planLite({ totalTasks: 3, completedTasks: 1, firstOpenTaskTitle: 'Cache 映射与替换' }),
    context: {
      momentum: { studyStreak: 0 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.6, sampleSize: 25 }, totalCount: 60 },
      review: { dueCount: 0, overdueCount: 0 },
    },
  }));
  assert.equal(state.mood, 'encourage');
  assert.equal(state.moodReason.kind, 'plan_pending');
  assert.match(state.lines[0].text, /还有 2 个任务/);
  assert.match(state.lines[0].text, /Cache 映射与替换/);
});

test('mood ladder: guard #9 — a brand-new profile gets an honest insufficient_data invitation', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput());
  assert.equal(state.mood, 'unknown');
  assert.equal(state.moodReason.kind, 'insufficient_data');
  assert.equal(state.degraded.contextAvailable, true, 'context exists — this is a data-volume verdict, not a failure');
  assert.match(state.lines[0].text, /还不够了解你/);
});

test('mood ladder: guard #10 — idle is the quiet default with checked-sources evidence', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({
    context: {
      momentum: { studyStreak: 0 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.6, sampleSize: 20 }, totalCount: 40 },
      review: { dueCount: 0, overdueCount: 0 },
    },
  }));
  assert.equal(state.mood, 'idle');
  assert.equal(state.moodReason.kind, 'no_signal');
  assert.equal(state.lines.length, 1);
});

test('mood ladder priority shadowing: celebrate beats streak; concern beats celebrate; focused beats everything', async () => {
  const { buildSpriteState } = await loadModules();
  const hot = baseInput(withSufficientPractice({
    context: {
      momentum: { studyStreak: 7 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 40 }, totalCount: 140 },
      review: { dueCount: 0, overdueCount: 0 },
    },
    story: storyLite({ weekDelta: 1.2 }),
  }));
  assert.equal(buildSpriteState(hot).mood, 'celebrate', 'a real gain outranks the streak rhythm');

  const worried = baseInput({
    interventions: [intervention({ severity: 'high' })],
    story: storyLite({ weekDelta: 2.5 }),
  });
  assert.equal(buildSpriteState(worried).mood, 'concern', 'risk outranks celebration');

  const midSession = baseInput({
    activeSession: true,
    plan: planLite({ recoveredFromGap: true }),
    interventions: [intervention({ severity: 'high' })],
    story: storyLite({ weekDelta: 2.5 }),
  });
  const focused = buildSpriteState(midSession);
  assert.equal(focused.mood, 'focused');
  assert.deepEqual([...focused.lines], []);
});

// ---------------------------------------------------------------------------
// 2. Persona forbidden-word validation (constitution §3.3)
// ---------------------------------------------------------------------------

test('persona validator catches all six forbidden categories plus length', async () => {
  const { validatePersonaCopy, SPRITE_LINE_MAX_LENGTH } = await loadModules();
  assert.ok(Array.isArray(validatePersonaCopy('今天的计划已完成')), 'clean copy yields an empty violation list');
  assert.deepEqual(validatePersonaCopy('今天的计划已完成'), []);

  const samples = [
    ['你已经落后别的同学很多了', 'comparison'],
    ['你怎么又没完成，再不努力就白费了', 'guilt'],
    ['你最棒！相信自己，一定可以！', 'empty_cheer'],
    ['再不学就来不及了，危险！', 'anxiety'],
    ['人家帮你呜呜，主人要棒棒哒', 'childish'],
    ['我帮你把计划改好了，已经帮你提升掌握度', 'false_promise'],
  ];
  for (const [text, category] of samples) {
    const violations = validatePersonaCopy(text);
    assert.ok(
      violations.some((violation) => violation.category === category),
      `"${text}" must trip ${category} (got: ${JSON.stringify(violations)})`,
    );
  }

  const longText = '这'.repeat(SPRITE_LINE_MAX_LENGTH + 1);
  assert.ok(validatePersonaCopy(longText).some((violation) => violation.category === 'length'));
});

test('every mood output passes the persona validator and the 60-char budget', async () => {
  const { buildSpriteState, validatePersonaCopy, SPRITE_LINE_MAX_LENGTH } = await loadModules();
  const fixtures = [
    baseInput({ context: null, unavailableSources: ['student_context'] }),
    baseInput({ activeSession: true }),
    baseInput({ plan: planLite({ recoveredFromGap: true }), interventions: [intervention()] }),
    baseInput({ interventions: [intervention()] }),
    baseInput(withSufficientPractice({ story: storyLite({ weekDelta: 1.4 }) })),
    baseInput(withSufficientPractice({ story: storyLite({ gatesPassed: 3 }) })),
    baseInput(withSufficientPractice({ story: storyLite({ resolvedCount: 2 }) })),
    baseInput(withSufficientPractice({
      plan: planLite({ totalTasks: 3, completedTasks: 3 }),
      context: {
        momentum: { studyStreak: 0 },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
        review: { dueCount: 0, overdueCount: 0 },
      },
    })),
    baseInput({
      context: {
        momentum: { studyStreak: 5 },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
        review: { dueCount: 0, overdueCount: 0 },
      },
    }),
    baseInput({
      plan: planLite({ totalTasks: 3, completedTasks: 1, firstOpenTaskTitle: 'Cache 映射与替换' }),
      context: {
        momentum: { studyStreak: 0 },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.6, sampleSize: 25 }, totalCount: 60 },
        review: { dueCount: 0, overdueCount: 0 },
      },
    }),
    baseInput(),
    baseInput(withSufficientPractice({})),
  ];

  for (const fixture of fixtures) {
    const state = buildSpriteState(fixture);
    for (const line of state.lines) {
      assert.deepEqual(validatePersonaCopy(line.text), [], `line ${line.id} violates the persona constitution: ${line.text}`);
      assert.ok(line.text.length <= SPRITE_LINE_MAX_LENGTH, `line ${line.id} exceeds the ${SPRITE_LINE_MAX_LENGTH}-char budget`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. insufficient_data / degradation honesty
// ---------------------------------------------------------------------------

test('degradation: partial source failure is recorded without faking the missing part', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({
    story: null,
    unavailableSources: ['progress_story'],
  }));
  assert.deepEqual([...state.degraded.unavailableSources], ['progress_story']);
  assert.equal(state.degraded.contextAvailable, true);
  assert.equal(state.source, 'derived', 'V10-1 is pure derivation — no LLM anywhere');
});

test('degradation: proactive empty means quiet, not failure (CL-5)', async () => {
  const { buildSpriteState } = await loadModules();
  const state = buildSpriteState(baseInput({
    interventions: [],
    unavailableSources: [],
  }));
  assert.deepEqual([...state.degraded.unavailableSources], []);
  assert.notEqual(state.mood, 'concern', 'no risks is silence, not worry');
});

// ---------------------------------------------------------------------------
// 4. evidenceRefs completeness (contract sweep)
// ---------------------------------------------------------------------------

test('evidence contract: every mood reason and line carries resolvable evidence', async () => {
  const { buildSpriteState } = await loadModules();
  const fixtures = [
    baseInput({ context: null, unavailableSources: ['student_context'] }),
    baseInput({ activeSession: true }),
    baseInput(withSufficientPractice({ plan: planLite({ recoveredFromGap: true, carryOverCount: 0, totalTasks: 2 }), interventions: [intervention()] })),
    baseInput(withSufficientPractice({ plan: planLite({ recoveredFromGap: false, carryOverCount: 2, totalTasks: 2 }) })),
    baseInput(withSufficientPractice({ interventions: [intervention({ severity: 'medium', headline: '有 3 项复习到期，建议先完成复习' })] })),
    baseInput(withSufficientPractice({ story: storyLite({ weekDelta: 1.4 }) })),
    baseInput(withSufficientPractice({ story: storyLite({ gatesPassed: 3 }) })),
    baseInput(withSufficientPractice({ story: storyLite({ weekDelta: 0.4, resolvedCount: 2 }) })),
    baseInput(withSufficientPractice({ plan: planLite({ totalTasks: 3, completedTasks: 3 }) })),
    baseInput({
      context: {
        momentum: { studyStreak: 5 },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
        review: { dueCount: 0, overdueCount: 0 },
      },
    }),
    baseInput({
      plan: planLite({ totalTasks: 3, completedTasks: 1, firstOpenTaskTitle: 'Cache 映射与替换' }),
      context: {
        momentum: { studyStreak: 0 },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.6, sampleSize: 25 }, totalCount: 60 },
        review: { dueCount: 0, overdueCount: 0 },
      },
    }),
    baseInput(),
    baseInput(withSufficientPractice({})),
  ];

  for (const fixture of fixtures) {
    const input = { ...fixture };
    const state = buildSpriteState(input);
    assert.ok(state.moodReason.evidenceRefs.length >= 1, `${state.mood} must justify itself`);
    assert.ok(state.lines.length <= 3, 'at most 3 lines per state');

    for (const line of state.lines) {
      assert.ok(line.evidenceRefs.length >= 1, `line ${line.id} must carry evidence`);
      assert.equal(line.id, `${state.mood}.${state.moodReason.kind}`, 'line id is stable: mood.kind');
    }

    for (const ref of collectEvidence(state)) {
      assert.ok(
        ['student_context', 'today_plan', 'proactive', 'progress_story', 'recovery', 'session'].includes(ref.source),
        `unknown evidence source: ${ref.source}`,
      );
      const resolved = resolveField(input, ref.field);
      assert.ok(resolved.exists, `evidence field ${ref.source}#${ref.field} does not resolve on the input snapshot`);
      assert.ok(typeof ref.detail === 'string' && ref.detail.length > 0, 'evidence detail must state the fact');
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Wiring contract (source-level, V9 #P1 style)
// ---------------------------------------------------------------------------

test('V10-1 wiring: GET /sprite/state is read-only, isolated, and derived — no LLM', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/sprite.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('sprite\/state'\)/);
  assert.match(controller, /assertTeacherAuthorizedForStudent/, 'teacher access requires authorization');
  assert.match(controller, /ForbiddenException\('You can only access your own data'\)/);
  assert.match(controller, /buildSpriteState\(/);
  assert.match(controller, /unavailableSources/, 'source failures are surfaced, not swallowed');
  assert.doesNotMatch(controller, /deepseek|aiTutor|AiTutor/i, 'the sprite core never touches an LLM');
  assert.doesNotMatch(controller, /\.save\(|\.create\(|\.update\(|\.delete\(/, 'read-only endpoint — no write calls');

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /SpriteController/);
});

test('V10-1 purity: the pure modules import nothing and use no clock or randomness', async () => {
  const personaSource = await readFile(PERSONA_URL, 'utf8');
  assert.doesNotMatch(personaSource, /^import\s(?!type)/m, 'sprite-persona must stay dependency-free');

  const stateSource = await readFile(STATE_URL, 'utf8');
  const imports = [...stateSource.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(
    imports.filter((requested) => requested !== './sprite-persona'),
    [],
    'sprite-state may only import ./sprite-persona',
  );
  assert.doesNotMatch(stateSource, /Date\.now|Math\.random/, 'time is injected; no nondeterminism');
});

// ---------------------------------------------------------------------------
// V10-3: bond.milestones — achievements appear only with evidence
// ---------------------------------------------------------------------------

test('V10-3 milestones: each fact produces exactly its own milestone with resolvable evidence', async () => {
  const { buildSpriteState } = await loadModules();
  const gates = buildSpriteState(baseInput(withSufficientPractice({ story: storyLite({ gatesPassed: 3 }) })));
  assert.deepEqual(gates.bond.milestones.map((m) => m.kind), ['evidence_gate']);
  assert.match(gates.bond.milestones[0].label, /3 个知识节点/);
  assert.ok(resolveField(baseInput(withSufficientPractice({ story: storyLite({ gatesPassed: 3 }) })), gates.bond.milestones[0].evidenceRef.field).exists);

  const resolved = buildSpriteState(baseInput(withSufficientPractice({ story: storyLite({ resolvedCount: 2 }) })));
  assert.deepEqual(resolved.bond.milestones.map((m) => m.kind), ['resolved']);
  assert.match(resolved.bond.milestones[0].label, /2 道错题/);

  const streakInput = baseInput({
    context: {
      momentum: { studyStreak: 8 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 30 }, totalCount: 90 },
      review: { dueCount: 0, overdueCount: 0 },
    },
  });
  const streak = buildSpriteState(streakInput);
  assert.deepEqual(streak.bond.milestones.map((m) => m.kind), ['streak']);
  assert.match(streak.bond.milestones[0].label, /连续学习 8 天/);
  assert.ok(resolveField(streakInput, streak.bond.milestones[0].evidenceRef.field).exists);

  const recovery = buildSpriteState(baseInput({ plan: planLite({ recoveredFromGap: true }) }));
  assert.deepEqual(recovery.bond.milestones.map((m) => m.kind), ['gap_recovery']);
  assert.ok(resolveField(baseInput({ plan: planLite({ recoveredFromGap: true }) }), recovery.bond.milestones[0].evidenceRef.field).exists);
});

test('V10-3 milestones: no facts means an empty list, and the list is capped at three', async () => {
  const { buildSpriteState } = await loadModules();
  const empty = buildSpriteState(baseInput());
  assert.deepEqual([...empty.bond.milestones], [], 'no evidence, no milestones');

  const all = buildSpriteState(baseInput(withSufficientPractice({
    story: storyLite({ gatesPassed: 2, resolvedCount: 1, streak: 9 }),
    context: {
      momentum: { studyStreak: 9 },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.7, sampleSize: 40 }, totalCount: 120 },
      review: { dueCount: 0, overdueCount: 0 },
    },
    plan: planLite({ recoveredFromGap: true, totalTasks: 3, completedTasks: 3 }),
  })));
  assert.ok(all.bond.milestones.length <= 3, 'milestones stay bounded');
  assert.ok(all.bond.milestones.length >= 3, 'all four facts present → three shown (cap)');
  for (const milestone of all.bond.milestones) {
    assert.ok(typeof milestone.label === 'string' && milestone.label.length > 0);
    assert.ok(milestone.evidenceRef.detail.length > 0);
  }
});
