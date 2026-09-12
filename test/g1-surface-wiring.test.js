import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// G1 — surface wiring contract.
//
// The G1 acceptance list (task §24) is mostly about *where* things appear, not
// about new algorithms. These assertions pin the wiring so a later refactor
// cannot quietly undo the guidance work:
//   • exactly one primary learning action on the home screen (A4)
//   • the honest WHY selector is the only path from reason codes to copy (A1)
//   • verification and NEXT are rendered where the action happens
//   • the transfer re-test is on the learning path, not only in a report tab (A5)
//   • the guardrail card is actionable, never an inert list item
//   • guidance telemetry uses the allowlisted event names (A3)

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = 'apps/web/src/features/student/home/StudentHome.tsx';
const TODAY_MISSION = 'apps/web/src/features/student/home/components/TodayMission.tsx';
const PROACTIVE = 'apps/web/src/features/student/home/components/ProactiveCoachCard.tsx';
const PROBE = 'apps/web/src/features/transfer-probe/TransferProbeCard.tsx';
const PRACTICE = 'apps/web/src/features/practice/PracticePanel.tsx';
const REPORT = 'apps/web/src/features/report/ReportWorkspace.tsx';
const DELIVERY = 'apps/web/src/features/guidance/useGuidanceDelivery.ts';
const WRITER = 'apps/api/src/study/canonical-event-writer.service.ts';

test('G1.2/A4: the home has exactly one primary learning action and three levels', () => {
  const home = stripComments(read(HOME));
  assert.equal((home.match(/<PrimaryLearningActionCard/g) ?? []).length, 1, 'one primary card');
  assert.equal((home.match(/dashboard-secondary-level/g) ?? []).length, 1, 'one secondary level');
  assert.equal((home.match(/dashboard-context-level/g) ?? []).length, 1, 'one context level');
  // The demoted surfaces must still be mounted — the hierarchy changed their
  // level, not their existence.
  for (const marker of ['DashboardHero', 'StudentStateCard', 'TodayMission', 'AIInsightCard', 'LearningTrend', 'QuickActions', 'ProactiveCoachCard', 'StudentActionCard', 'TodaysScoreCenter', 'TodayPlan']) {
    assert.match(home, new RegExp(`<${marker}`), `${marker} must remain mounted`);
  }
  // Everything that competes for attention sits inside the collapsed context.
  const contextIndex = home.indexOf('dashboard-context-level');
  for (const marker of ['<DashboardHero', '<StudentActionCard', '<TodaysScoreCenter', '<AIInsightCard']) {
    assert.ok(home.indexOf(marker) > contextIndex, `${marker} must be demoted into Context`);
  }
});

test('G1.2: the primary card answers WHAT / WHY / TIME / VERIFY and carries a NEXT', () => {
  const cards = read('apps/web/src/features/guidance/GuidanceCards.tsx');
  for (const marker of ['contract.what', 'ReasonList', 'contract.time', 'contract.verify', 'NextButton', 'contract.boundary']) {
    assert.ok(cards.includes(marker), `the primary card must render ${marker}`);
  }
  assert.match(cards, /insufficientNote/, 'it must render the insufficiency sentence when there is no real reason');
});

test('G1.1: reason codes reach the student only through the shared selector', () => {
  const mission = stripComments(read(TODAY_MISSION));
  assert.match(mission, /resolveShownReasons/, 'the honest selector is the only reason path');
  assert.match(mission, /buildReasonDetailFromCode/);
  assert.doesNotMatch(mission, /REASON_LABELS/, 'the raw label map must not be used directly any more');
  assert.match(mission, /insufficientNote/, 'no reason must produce an explicit note');
  assert.match(mission, /COMPLETION_BOUNDARY_NOTE/, 'the completion boundary must be visible where completion happens');
  // Hardened A1: inferred statistics are labelled as sorting reference, never
  // presented under the why.
  assert.match(mission, /排序参考（考试统计，不是你的证据）/, 'inferred codes must be labelled as non-evidence');
});

// ------------------------------- hardened A1: the audit, made structural -------

test('G1.A1: every surface that maps reason codes applies the evidenced filter', () => {
  // `reason-copy.ts` is the code→Chinese map. Any file that renders it is a
  // student-visible WHY surface, so it must also apply the shared filter. This is
  // the guard that keeps the original defect from reappearing on a new surface.
  const surfaces = [
    'apps/web/src/features/today-score-center/WhyRecommendedDrawer.tsx',
    'apps/web/src/features/today-score-center/RecommendationCard.tsx',
  ];
  for (const path of surfaces) {
    const source = stripComments(read(path));
    assert.ok(source.includes('reasonCopy'), `${path} renders reason copy`);
    assert.ok(
      /filterEvidencedReasonCodes|resolveShownReasons/.test(source),
      `${path} renders reason codes but does not apply the evidenced-only filter`,
    );
  }
});

test('G1.A1: the persisted student-facing reason is evidenced-only on both writers', () => {
  const service = stripComments(read('apps/api/src/study/recommendation.service.ts'));
  assert.match(service, /filterEvidencedReasonCodes/, 'the service must filter before writing the reason string');
  assert.match(service, /INSUFFICIENT_REASON_NOTE/, 'and must say so when nothing is evidenced');
  // The machine-readable field keeps every code; only the human string is filtered.
  assert.match(service, /reasonCodes: draft\.reasonCodes/, 'reasonCodes must stay complete for downstream use');

  const nodePlan = stripComments(read('packages/shared/src/nodePlan.ts'));
  assert.match(nodePlan, /filterEvidencedReasonCodes/, 'the legacy node-plan string must use the same filter');
  assert.doesNotMatch(
    nodePlan,
    /reasonCodes\.map\(\(code\) => REASON_LABELS\[code\]/,
    'mapping every code through the label table is exactly the leak this filter closes',
  );
});

test('G1.A1: no surface can feed a bare code list into a why heading', () => {
  const files = [
    'apps/web/src/features/today-score-center/WhyRecommendedDrawer.tsx',
    'apps/web/src/features/today-score-center/RecommendationCard.tsx',
    'apps/web/src/features/student/home/components/TodayMission.tsx',
    'apps/web/src/features/guidance/GuidanceCards.tsx',
  ];
  for (const path of files) {
    const source = stripComments(read(path));
    assert.doesNotMatch(
      source,
      /为什么[\s\S]{0,80}\(item\.reasonCodes \?\? \[\]\)\.map/,
      `${path} feeds a raw code list straight into a why label`,
    );
  }
});

test('G1.A1: the legacy template producers no longer claim an unevidenced reason', () => {
  // Both of these were found by the E2E, not by the source audit: template
  // producers that asserted a why from position alone.
  const learning = stripComments(read('packages/shared/src/learning.ts'));
  assert.doesNotMatch(
    learning,
    /是当前最需要优先处理的章节/,
    'the legacy plan template must not assert a positional priority claim',
  );
  assert.match(learning, /当前证据不足/, 'it must fall back to an insufficiency statement');
  assert.match(learning, /weakIds\.has\(point\.id\)/, 'evidence must come from the weakness report');

  const adapter = stripComments(read('apps/api/src/study/practice-set-recommendation.adapter.ts'));
  assert.doesNotMatch(
    adapter,
    /当前薄弱点较少/,
    'an empty weak set cannot be reported as "few weak points" — it may simply mean no records',
  );
  assert.match(adapter, /当前证据不足/, 'it must state the absence of evidence instead');
});

test('G1.6: the proactive coach card is actionable, not an inert list item', () => {
  const source = stripComments(read(PROACTIVE));
  assert.match(source, /sectionForActorHint/, 'actorHint must drive the destination');
  assert.match(source, /onClick=/, 'the item must be clickable');
  assert.match(source, /<button[\s\S]{0,200}proactive-coach-action/, 'it renders a button');
  assert.doesNotMatch(source, /<li key=\{item\.id\}[\s\S]{0,80}>\s*<div className="proactive-coach-head">/, 'the old inert markup must be gone');
});

test('G1.7/A5: the transfer re-test is mounted on the learning path', () => {
  const home = read(HOME);
  assert.match(home, /<TransferProbeCard[^>]*mount="today"/, 'the probe must appear in the today area');
  const report = read(REPORT);
  assert.match(report, /<TransferProbeCard \/>/, 'the report keeps the historical surface');
  const probe = read(PROBE);
  assert.match(probe, /HOW_GUIDANCE\.first_transfer_probe/, 'first-use education comes from the shared copy');
  assert.match(probe, /不会直接等同于考试分数/, 'the not-a-score sentence is mandatory');
  assert.match(probe, /probe-next/, 'a probe result must carry a NEXT');
});

test('G1.4: verification guidance is rendered where the action happens', () => {
  const practice = read(PRACTICE);
  assert.match(practice, /describeVerification/, 'the shared verification view is the only source');
  assert.match(practice, /VerificationBanner/);
  const home = read(HOME);
  assert.match(home, /GuidanceLayer/);
});

test('G1.8: the exam-date entry exists and states the meaning', () => {
  const card = read('apps/web/src/features/report/ExamDateCard.tsx');
  assert.match(card, /deriveExamDateState/, 'client validation reuses the shared derivation');
  assert.match(card, /saveExamDate/);
  assert.match(card, /meaningNote/, 'the meaning of the date must be stated');
  assert.match(read(REPORT), /<ExamDateCard \/>/, 'reachable from the report workspace');
});

test('G1.9/A3: guidance telemetry uses the allowlisted event names only', async () => {
  const writer = read(WRITER);
  for (const event of [
    'guidance.shown',
    'guidance.accepted',
    'guidance.action_started',
    'guidance.action_completed',
    'guidance.dismissed',
    'guidance.correction_success',
  ]) {
    assert.ok(writer.includes(`'${event}'`), `${event} must be in TELEMETRY_EVENT_TYPES`);
  }
  const delivery = stripComments(read(DELIVERY));
  const emitted = [...delivery.matchAll(/emit\('([a-z_.]+)'/g)].map((match) => match[1]);
  assert.ok(emitted.length >= 5, 'the delivery hook must emit the funnel');
  for (const event of emitted) {
    assert.ok(writer.includes(`'${event}'`), `${event} is emitted but not allowlisted`);
  }
  // Payload discipline: identity + trigger + action, never learning content.
  assert.match(delivery, /guidanceId: triggerId/);
  assert.match(delivery, /trigger: triggerId/);
});

test('G1.9: telemetry payloads carry identity and trigger, never content', () => {
  const delivery = stripComments(read(DELIVERY));
  const allowedKeys = new Set(['guidanceId', 'trigger', 'action', 'surface', 'outcome', 'priority']);
  const payloads = [...delivery.matchAll(/emit\('[a-z_.]+',\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(payloads.length >= 5, 'every stage must report a payload');
  for (const payload of payloads) {
    const keys = [...payload.matchAll(/(\w+)\s*:/g)].map((match) => match[1]);
    for (const key of keys) {
      assert.ok(allowedKeys.has(key), `guidance telemetry leaked an unexpected field: ${key}`);
    }
  }
  // No answer text, stem, or analysis may ever be attached.
  for (const forbidden of ['selectedAnswer', 'questionText', 'analysis', 'stem:']) {
    assert.ok(!delivery.includes(forbidden), `guidance telemetry must not carry ${forbidden}`);
  }
});

test('G1: guidance state is a UI preference, never a second state system', async () => {
  const delivery = read(DELIVERY);
  assert.match(delivery, /localStorage/, 'delivery state is client-side only');
  const { GUIDANCE_DISMISS_STORAGE_KEY } = await import('../packages/shared/dist/index.js');
  assert.match(GUIDANCE_DISMISS_STORAGE_KEY, /^kaoyan408:/, 'it must follow the existing preference-key convention');
  assert.match(delivery, /GUIDANCE_DISMISS_STORAGE_KEY/, 'the key comes from the shared constant, not a literal');
  // No mastery/plan/score vocabulary may appear in the guidance layer.
  const layer = read('apps/web/src/features/guidance/GuidanceLayer.tsx');
  for (const forbidden of [/UserKnowledgeMastery/, /applyAttempts/, /applyReview/, /scorePrediction/]) {
    assert.ok(!forbidden.test(layer), `guidance must not touch ${forbidden}`);
  }
});
