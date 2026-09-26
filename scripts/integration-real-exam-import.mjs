/**
 * V14-P0 Real-Exam Bank Foundation — real PG + HTTP E2E.
 *
 * Chain under test (docs/v14-p0-real-exam-bank-design.md §11.3):
 *
 *   scaffold (pure, real 2026 bundle)      → 47 rows, scores + node ids prefilled
 *   importer CLI on a complete fixture year → versioned Question writes with
 *                                             optionAnalyses/examNo/maxScore/subtype
 *   node tags                               → HUMAN tags, source='real-exam-import'
 *   batch audit row                         → reviewedBy recorded (RULE-10)
 *   line-B isolation                        → ExamPaper/ExamQuestion counts unchanged
 *   idempotency                             → re-run skips; --replace versions with inheritance
 *   student strip                           → GET /questions carries neither answer nor traps
 *   ScoreLoss ignition                      → priced wrong → OBSERVED lost=maxScore, coverage>0
 *   rejection paths                         → trap-on-correct / essay-trap / unknown node /
 *                                             missing reviewed-by / missing rights-confirmed
 *   guards                                  → unauthenticated coach read → 401
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3271';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-real-exam-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const runStartedAt = new Date();
const DAY = 86_400_000;
const password = 'Real-Exam-Integration-Password-1';
const REVIEWED_BY = '集成验收教研';
const MARKER = `[re-integration ${runId}]`;
const ESSAY_SCORES = { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 };

const ids = {
  admin: `re-admin-${runId}`,
  student: null,
  nodeDs: `DS-C02-S02-RE-${runId}`,
  nodeDs2: `DS-C03-S01-RE-${runId}`,
  pointDs: `re-point-ds-${runId}`,
  paper: `re-paper-${runId}`,
};
let fixtureDir = null;
let qWrongA; let qWrongB;
let examPaperCountBefore; let examQuestionCountBefore;

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;
let prisma = null;

// ---------------------------------------------------------------- fixture CSV

/**
 * Complete fixture year 2026: 40 MCQ (2 分 each) + 7 essays with the OFFICIAL
 * 2026 score distribution read from the verified exam-mapping bundle (the
 * importer cross-checks against it — two-sided evidence). All authored content
 * is synthetic and marked with the run id; node/point ids are run-scoped
 * fixture dictionary rows (create-only upserts, cleaned afterwards).
 */
function buildFixtureRows() {
  const rows = [];
  for (let examNo = 1; examNo <= 40; examNo += 1) {
    const answer = examNo % 2 === 0 ? 'B' : 'A';
    const trapColumn = answer === 'B' ? '陷阱解析C' : '陷阱解析B';
    rows.push({
      stem: `${MARKER} 2026 单选第 ${examNo} 题`,
      options: 'A.选项甲|B.选项乙|C.选项丙|D.选项丁',
      answer,
      analysis: `${MARKER} 解析：第 ${examNo} 题逐项核对。`,
      knowledgePointIds: ids.pointDs,
      difficulty: '中等',
      type: '选择题',
      source: '2026-408-真题',
      year: '2026',
      expectedTimeSec: '100',
      questionSubtype: 'SINGLE_CHOICE',
      maxScore: '2',
      判分标准: '',
      examNo: String(examNo),
      knowledgeNodeIds: `${ids.nodeDs}|${ids.nodeDs2}`,
      陷阱解析A: '',
      陷阱解析B: trapColumn === '陷阱解析B' ? `${MARKER} 陷阱 B：把 X 笼统等同于 Y。` : '',
      陷阱解析C: trapColumn === '陷阱解析C' ? `${MARKER} 陷阱 C：把删除等同于移动。` : '',
      陷阱解析D: '',
      录入参考摘要: `${MARKER} 摘要`,
    });
  }
  for (const [examNo, score] of Object.entries(ESSAY_SCORES)) {
    rows.push({
      stem: `${MARKER} 2026 综合第 ${examNo} 题`,
      options: '',
      answer: '',
      analysis: `${MARKER} 解析：双指针一次遍历。`,
      knowledgePointIds: ids.pointDs,
      difficulty: '困难',
      type: '综合题',
      source: '2026-408-真题',
      year: '2026',
      expectedTimeSec: '600',
      questionSubtype: '',
      maxScore: String(score),
      判分标准: JSON.stringify({
        version: 1,
        totalPoints: score,
        criteria: [{
          id: 'c1', description: '算法设计思想', points: score,
          evidenceHint: '答案中出现"双指针"或等价描述',
          matchAny: ['双指针', '两次遍历'],
        }],
      }),
      examNo: String(examNo),
      knowledgeNodeIds: ids.nodeDs,
      陷阱解析A: '', 陷阱解析B: '', 陷阱解析C: '', 陷阱解析D: '',
      录入参考摘要: '',
    });
  }
  return rows;
}

function writeFixtureCsv(name, rows) {
  // Inline the header/column order so the CSV is exactly what the importer
  // documents (REAL_EXAM_HEADERS) — stringifying through the scaffold's
  // writer keeps escaping rules in one place.
  return import('../scripts/lib/csv.mjs').then(async ({ stringifyCsv }) => {
    const { REAL_EXAM_HEADERS } = await import('../scripts/import-real-exams.mjs');
    const target = join(fixtureDir, name);
    writeFileSync(target, stringifyCsv(rows, REAL_EXAM_HEADERS), 'utf8');
    return target;
  });
}

function runImporter(csvPath, extraArgs = [], env = {}) {
  return spawnSync(node, ['scripts/import-real-exams.mjs', csvPath, ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
  });
}

// ---------------------------------------------------------------- seed

async function seedBeforeBoot() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
  record('migrate', 'migration 20260926000000_real_exam_foundation deployed to the test database');

  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Real Exam Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });

  // Fixture dictionary rows: create-only upserts (update:{} — never clobber
  // real catalog rows if a full seed exists), cleaned up at the end.
  for (const nodeId of [ids.nodeDs, ids.nodeDs2]) {
    await prisma.knowledgeNode.upsert({
      where: { id: nodeId },
      update: {},
      create: { id: nodeId, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: nodeId, importance: 3, difficulty: 3, syllabusVersion: 'integration-fixture' },
    });
  }
  await prisma.knowledgePoint.upsert({
    where: { id: ids.pointDs },
    update: {},
    create: {
      id: ids.pointDs, subject: 'DATA_STRUCTURE', chapter: 'V14-P0', title: `真题链表考点 ${runId}`,
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeDs, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  record('seed', 'dictionary fixtures ready (create-only upserts; exam layer counts captured)');

  // Minimal exam-layer fixture (after the dictionary rows it references):
  // one paper for year 2026 + two ExamQuestion rows tagged to the fixture
  // node — powers the board's subject column and novel/returning derivation.
  await prisma.examPaper.upsert({
    where: { id: 'paper-408-2026-integration' },
    update: {},
    create: { id: 'paper-408-2026-integration', exam: '408', year: 2026, totalScore: 150, source: 'integration' },
  });
  for (const questionNo of [1, 2]) {
    const examQuestion = await prisma.examQuestion.upsert({
      where: { id: `re-exq-${runId}-${questionNo}` },
      update: {},
      create: {
        id: `re-exq-${runId}-${questionNo}`, paperId: 'paper-408-2026-integration',
        questionNo, subject: questionNo === 1 ? 'DS' : 'OS', questionType: '选择题', score: 2,
      },
    });
    await prisma.examQuestionKnowledgeTag.upsert({
      where: { questionId_knowledgeNodeId_role: { questionId: examQuestion.id, knowledgeNodeId: ids.nodeDs, role: 'PRIMARY' } },
      update: {},
      create: { questionId: examQuestion.id, knowledgeNodeId: ids.nodeDs, role: 'PRIMARY', confidence: 1, precision: 'EXACT_ATOMIC', taggedBy: 'HUMAN' },
    });
  }

  // Baseline counts captured AFTER the exam-layer fixture: the isolation
  // assertion verifies the IMPORTER leaves the exam layer untouched.
  examPaperCountBefore = await prisma.examPaper.count();
  examQuestionCountBefore = await prisma.examQuestion.count();
}

// ---------------------------------------------------------------- boot helpers

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3271',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy in time: ${child.getOutput?.().slice(-2000) ?? ''}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function createInvitation(maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6), label: 'v14 p0 real-exam integration',
      maxUses, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  return code;
}

// ---------------------------------------------------------------- verification

async function importAndVerify() {
  // ---- 0. scaffold proof against the REAL verified 2026 bundle (pure, no DB).
  const { loadYearBundle, buildScaffoldRows } = await import('../scripts/gen-real-exam-scaffold.mjs');
  const scaffold = buildScaffoldRows(loadYearBundle(2026));
  assert.equal(scaffold.length, 47, 'real 2026 bundle scaffolds all 47 slots');
  assert.equal(scaffold.filter((row) => row.maxScore !== '').length, 47, '2026 scaffold: every score prefilled');
  assert.equal(scaffold.filter((row) => row.knowledgeNodeIds !== '').length, 47, '2026 scaffold: every mapping prefilled');
  record('scaffold', 'real 2026 bundle → 47 rows, maxScore + knowledgeNodeIds fully prefilled (verified data reuse)');

  // ---- 1. importer CLI on the complete fixture year.
  fixtureDir = mkdtempSync(join(tmpdir(), `re-import-${runId}-`));
  const csvPath = await writeFixtureCsv('real-exam-2026-fixture.csv', buildFixtureRows());
  const dryRun = runImporter(csvPath, ['--dry-run']);
  assert.equal(dryRun.status, 0, `dry run failed: ${dryRun.stderr || dryRun.stdout}`);
  assert.ok(dryRun.stdout.includes('COMPLETE sum=80+70=150'), 'dry run reports the complete-year structure');
  assert.ok(dryRun.stdout.includes('mapping 47/47'), 'dry run cross-checks scores against the verified bundle');
  record('dryrun', 'CLI dry run: structure COMPLETE (80+70=150) + verified-bundle cross-check 47/47');

  const result = runImporter(csvPath, [
    '--reviewed-by', REVIEWED_BY,
    '--uploaded-by', ids.admin,
    '--rights-confirmed',
  ]);
  assert.equal(result.status, 0, `import failed: ${result.stderr || result.stdout}`);
  assert.ok(result.stdout.includes('created=47 updated=0 skipped=0'), `unexpected import counts: ${result.stdout}`);
  record('import', '47 fixture questions imported through the real CLI path');

  // ---- 2. database shape assertions.
  const imported = await prisma.question.findMany({
    where: { isCurrent: true, stem: { contains: MARKER } },
    include: { knowledgePoints: true, knowledgeNodeTags: true },
  });
  assert.equal(imported.length, 47);
  const mcqRows = imported.filter((row) => row.type === 'SINGLE_CHOICE');
  const essayRows = imported.filter((row) => row.type === 'COMPREHENSIVE');
  assert.equal(mcqRows.length, 40);
  assert.equal(essayRows.length, 7);
  assert.equal(mcqRows.every((row) => row.maxScore === 2), true, 'MCQs priced 2 each');
  assert.equal(mcqRows.reduce((total, row) => total + row.maxScore, 0) + essayRows.reduce((total, row) => total + row.maxScore, 0), 150, 'year total = 150');
  assert.equal(mcqRows.every((row) => row.examNo >= 1 && row.examNo <= 40), true);
  assert.equal(essayRows.every((row) => row.examNo >= 41 && row.examNo <= 47), true);
  assert.equal(essayRows.every((row) => row.questionSubtype === null), true, 'essay subtypes stay NULL (Owner D-3 deferral)');
  assert.equal(mcqRows.every((row) => row.questionSubtype === 'SINGLE_CHOICE'), true);
  const trapped = mcqRows.filter((row) => row.optionAnalyses != null);
  assert.equal(trapped.length, 40, 'every fixture MCQ carries traps (one wrong option each)');
  assert.ok(trapped.every((row) => {
    const correctLetter = row.answer;
    const traps = row.optionAnalyses?.traps ?? {};
    return Object.keys(traps).length === 1 && !(correctLetter in traps) && row.answer.length === 1;
  }), 'trap keys never touch the correct option');
  record('shape', 'year 2026 fixture: 40×2 + 7 essays = 150, slots/traps/subtypes all as designed');

  const tagCount = await prisma.questionKnowledgeNodeTag.count({ where: { source: 'real-exam-import', question: { stem: { contains: MARKER } } } });
  assert.equal(tagCount, 40 * 2 + 7 * 1, 'MCQ PRIMARY+SECONDARY (40×2) and essay PRIMARY (7×1) tags written (taggedBy=HUMAN)');
  const tagSample = await prisma.questionKnowledgeNodeTag.findFirst({ where: { source: 'real-exam-import', question: { stem: { contains: MARKER } } } });
  assert.equal(tagSample.taggedBy, 'HUMAN');
  assert.equal(tagSample.role, 'PRIMARY');
  record('nodetags', `HUMAN node tags written: ${tagCount} rows (source='real-exam-import', PRIMARY first)`);

  const batch = await prisma.questionImportBatch.findFirst({
    where: { source: 'real-exam-authoring', title: { contains: REVIEWED_BY }, createdAt: { gte: runStartedAt } },
  });
  assert.ok(batch, 'batch audit row created');
  assert.equal(batch.fileType, 'csv');
  assert.equal(batch.rightsConfirmed, true);
  assert.ok(batch.title.includes(REVIEWED_BY), 'batch records the named reviewer (RULE-10)');
  assert.equal(batch.statusCounts.created, 47);
  record('batch', `QuestionImportBatch audit row: reviewedBy=${REVIEWED_BY}, rightsConfirmed=true`);

  assert.equal(await prisma.examPaper.count(), examPaperCountBefore, 'ExamPaper untouched (line-B isolation)');
  assert.equal(await prisma.examQuestion.count(), examQuestionCountBefore, 'ExamQuestion untouched (line-B isolation)');
  record('isolation', `ExamPaper/ExamQuestion counts unchanged (${examPaperCountBefore}/${examQuestionCountBefore})`);

  // Two fixture MCQs reserved for the HTTP paper-submit phase. qWrongB is the
  // question the --replace/inheritance step re-versioned below; qWrongA stays
  // a first-version row.
  qWrongA = mcqRows.find((row) => row.answer === 'A').id;

  // ---- 3. idempotency + versioned inheritance.
  const rerun = runImporter(csvPath, ['--reviewed-by', REVIEWED_BY, '--uploaded-by', ids.admin, '--rights-confirmed']);
  assert.equal(rerun.status, 0);
  assert.ok(rerun.stdout.includes('created=0 updated=0 skipped=47'), `re-run must skip everything: ${rerun.stdout}`);
  record('idempotent', 're-import without --replace: 47 skipped, zero new versions');

  const anyMcq = mcqRows.find((row) => row.answer === 'B');
  // Same (stem, source, year) dedup key, trap columns EMPTIED: --replace must
  // create version 2 whose traps INHERIT from version 1 (design §7.2).
  const partialRows = buildFixtureRows().filter((row) => row.examNo === String(anyMcq.examNo))
    .map((row) => ({ ...row, 陷阱解析C: '' }));
  const partialPath = await writeFixtureCsv('real-exam-partial-reimport.csv', partialRows);
  const replaceRun = runImporter(partialPath, ['--replace', '--reviewed-by', REVIEWED_BY, '--uploaded-by', ids.admin, '--rights-confirmed']);
  assert.equal(replaceRun.status, 0, `--replace run failed: ${replaceRun.stderr || replaceRun.stdout}`);
  const versions = await prisma.question.findMany({
    where: { stem: anyMcq.stem },
    orderBy: { versionNumber: 'asc' },
  });
  assert.equal(versions.length, 2, '--replace creates exactly one new version');
  const historical = versions.find((row) => !row.isCurrent);
  const current = versions.find((row) => row.isCurrent);
  assert.equal(historical.optionAnalyses != null, true, 'historical version keeps its traps (never rewritten)');
  assert.ok(current.optionAnalyses?.traps && Object.keys(current.optionAnalyses.traps).length === 1,
    'omitted trap columns on re-import INHERIT the current version traps (design §7.2)');
  assert.equal(historical.examNo, current.examNo, 'examNo stable across versions');
  qWrongB = current.id;
  record('inherit', 'versioned re-import: traps inherited when omitted; historical row untouched');

  // ---- 4. paper for the HTTP submit phase — created BEFORE API boot (the
  // paper repository hydrates once at startup; the sibling suites do the same).
  qWrongA = mcqRows.find((row) => row.answer === 'A').id;
  const paperQuestions = [
    { id: qWrongA, stem: `${MARKER} 卷内单选 A`, type: '单选题', options: ['A.选项甲', 'B.选项乙', 'C.选项丙', 'D.选项丁'], answer: mcqRows.find((row) => row.id === qWrongA).answer, analysis: 'x' },
    { id: qWrongB, stem: `${MARKER} 卷内单选 B`, type: '单选题', options: ['A.选项甲', 'B.选项乙', 'C.选项丙', 'D.选项丁'], answer: anyMcq.answer, analysis: 'x' },
  ];
  await prisma.paper.create({
    data: {
      id: ids.paper, title: `${MARKER} 真题定价卷`, paperType: '模拟卷', questionCount: 2,
      knowledgePointIds: [ids.pointDs], questions: paperQuestions, estimatedMinutes: 5, createdBy: ids.admin,
    },
  });
  record('paper', `pre-boot paper ready (${ids.paper}) with two priced fixture MCQs`);
}

async function verifyAfterBoot() {
  const invite = await createInvitation(5);
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: `re-student-${runId}@integration.test`, password, name: '真题学生', inviteCode: invite,
  });
  const student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  ids.student = student;
  const login = async (email) => (await postJson(`${apiUrl}/auth/login`, { email, password }))?.accessToken;
  const studentHeaders = { authorization: `Bearer ${await login(`re-student-${runId}@integration.test`)}` };
  assert.ok(studentHeaders.authorization, 'student login must succeed');
  record('accounts', `student ready (${student})`);

  // ---- 4. student strip: no answer, no traps, pre-submission.
  const bank = await getJson(`${apiUrl}/questions`, studentHeaders);
  const items = bank.questions ?? bank;
  const fixtureInView = items.filter((row) => typeof row.stem === 'string' && row.stem.includes(MARKER));
  assert.ok(fixtureInView.length >= 45, `student bank must expose the imported questions, got ${fixtureInView.length}`);
  assert.ok(fixtureInView.every((row) => row.answer === '' || row.answer == null), 'student view strips the answer');
  assert.ok(
    fixtureInView.every((row) => row.optionAnalyses === undefined || row.optionAnalyses === null),
    'student pre-submission view NEVER carries optionAnalyses (design §10.1)',
  );
  const rawRow = await prisma.question.findUnique({ where: { id: fixtureInView[0].id }, select: { answer: true, optionAnalyses: true } });
  assert.notEqual(rawRow.answer, '', 'the strip is view-level, not a data loss');
  assert.ok(rawRow.optionAnalyses != null, 'the strip is view-level, not a data loss (traps still in DB)');
  record('strip', `student view: ${fixtureInView.length} questions, answers and traps structurally stripped`);

  // ---- 5. ScoreLoss ignition through the real paper submit path.
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qWrongA, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qWrongB, selectedAnswer: 'X', timeSpentSec: 30 },
    ],
  }, studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 2);
  record('submit', 'fixture paper submitted through the real endpoint (2 wrong answers)');

  // ---- 5b. post-answer trap presentation: single-question submit carries the
  // persisted traps (post-answer-only surface; design §10.3).
  const trapSource = await prisma.question.findUniqueOrThrow({
    where: { id: qWrongA },
    select: { optionAnalyses: true, answer: true },
  });
  const wrongLetter = trapSource.answer === 'A' ? 'B' : 'A';
  const singleAnswer = await postJson(`${apiUrl}/practice-records`, {
    questionId: qWrongA,
    knowledgePointId: ids.pointDs,
    selectedAnswer: wrongLetter,
    timeSpentSec: 40,
  }, { ...studentHeaders, 'idempotency-key': `re-trap-${runId}` });
  const presentedTraps = singleAnswer.optionAnalyses?.traps ?? null;
  assert.ok(presentedTraps && Object.keys(presentedTraps).length >= 1,
    'post-answer result must carry the persisted traps');
  assert.equal(presentedTraps[wrongLetter] === undefined, false,
    'the chosen wrong option has its trap text for「你为什么会选 X」');
  assert.ok(Object.keys(presentedTraps).every((letter) => letter !== trapSource.answer),
    'the correct option never carries a trap');
  record('trapview', `post-answer result carries traps for the chosen option ${wrongLetter} (post-answer-only surface)`);

  // ---- 5c. battle board: per-slot status from the student's real answers.
  const board = await getJson(`${apiUrl}/coach/real-exam-board?year=2026`, studentHeaders);
  assert.equal(board.storeAvailable, true);
  assert.equal(board.slots.length, 47);
  assert.equal(board.summary.total, 47);
  assert.equal(board.summary.answeredCount, 2, 'qWrongA + qWrongB answered');
  assert.equal(board.summary.correctCount, 0);
  assert.equal(board.summary.wrongCount, 2);
  assert.equal(board.summary.totalScore, 150);
  const wrongSlots = board.slots.filter((slot) => slot.status === 'wrong');
  assert.deepEqual(wrongSlots.map((slot) => slot.questionId).sort(), [qWrongA, qWrongB].sort());
  const slotA = board.slots.find((slot) => slot.questionId === qWrongA);
  assert.equal(slotA.subject, 'DS', 'subject comes from the exam-layer fixture');
  assert.equal(board.slots.find((slot) => slot.examNo === 47).status, 'unanswered');
  // novel KP: the fixture node's earliest recorded appearance is 2026.
  assert.ok(board.novelKps.some((row) => row.knowledgeNodeId === ids.nodeDs), 'fixture node is novel for 2026');
  assert.equal(board.returningKps.length, 0, 'no returning KPs within the single-year window');
  record('board', 'battle board: 47 slots, answered 2 / wrong 2 / unanswered 45, novel KP derived');

  // ---- 5d. data screens (public statistics). Relative invariants only —
  // the test DB may hold leftover dictionary rows from sibling suites.
  const dashboard = await getJson(`${apiUrl}/coach/real-exam-dashboard`, studentHeaders);
  assert.equal(dashboard.totalQuestions, 47);
  assert.deepEqual(dashboard.years, [{ year: 2026, count: 47 }]);
  assert.equal(dashboard.knowledgePointsTested, 1, 'only nodeDs is tagged in the exam layer');
  assert.ok(dashboard.knowledgePointsTotal >= 2, 'at least the two fixture nodes are active');
  assert.equal(dashboard.coveragePct, Math.round((dashboard.knowledgePointsTested / dashboard.knowledgePointsTotal) * 1000) / 10);
  const frequency = await getJson(`${apiUrl}/coach/real-exam-frequency?subject=DATA_STRUCTURE`, studentHeaders);
  assert.equal(frequency.levels.cold, 1);
  assert.equal(frequency.levels.high + frequency.levels.mid + frequency.levels.low, 0);
  const uncovered = await getJson(`${apiUrl}/coach/real-exam-uncovered`, studentHeaders);
  assert.equal(uncovered.total, dashboard.knowledgePointsTotal - 1, 'exactly one active node is untagged');
  record('screens', 'data screens: dashboard/frequency/uncovered counts all consistent with the fixture');

  // ---- 5e. 真题套卷 (R4-B): year composition → submit → priced loss chain.
  const paperRequest = await postJson(`${apiUrl}/exam/papers/prepare`, {
    paperType: '模拟卷', year: 2026,
  }, studentHeaders);
  const paperQuestions = paperRequest.questions ?? [];
  assert.equal(paperRequest.title.includes('2026'), true, `paper title carries the year: ${paperRequest.title}`);
  assert.equal(paperQuestions.length, 47, 'year paper composes all 47 questions');
  assert.deepEqual(paperQuestions.map((question) => question.examNo), Array.from({ length: 47 }, (_, index) => index + 1), 'examNo 1..47 in order');
  const composedScore = paperQuestions.reduce((total, question) => total + (question.maxScore ?? 0), 0);
  assert.equal(composedScore, 150, 'ΣmaxScore = 150 (卷面结构)');
  assert.equal(paperQuestions.every((question) => question.optionAnalyses == null), true, 'paper questions student-stripped (no traps)');
  assert.equal(paperQuestions.every((question) => question.answer == null || question.answer === ''), true, 'paper questions carry no answers');
  const paperConflict = await fetch(`${apiUrl}/exam/papers/prepare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...studentHeaders },
    body: JSON.stringify({ paperType: '专项卷', subject: '数据结构', year: 2026 }),
  });
  assert.equal(paperConflict.status, 400, '专项卷+year → 400');
  record('yearpaper', 'year paper: 47 questions / examNo ordered / ΣmaxScore 150 / student-stripped; 专项卷 conflict rejected');

  const answerFor = (question) => {
    if (question.questionSubtype === null || question.examNo > 40) {
      return { questionId: question.id, selectedAnswer: '', timeSpentSec: 60, selfScore: 3, maxScore: question.maxScore ?? 13 };
    }
    return { questionId: question.id, selectedAnswer: 'X', timeSpentSec: 30 };
  };
  const wrongObj = paperQuestions.find((question) => question.examNo === 3);
  const paperSubmission = await postJson(`${apiUrl}/papers/${paperRequest.id}/submit`, {
    answers: paperQuestions.map(answerFor),
  }, studentHeaders);
  assert.equal(paperSubmission.totalQuestions, 47, 'all 47 answers synced');
  assert.equal(paperSubmission.accuracyRate, Math.round((paperSubmission.correctCount / 47) * 100));
  const paperLossRows = await prisma.scoreLossItem.findMany({
    where: { userId: ids.student, questionId: { in: paperQuestions.map((question) => question.id) } },
  });
  // qWrongA/qWrongB also carry loss rows from the earlier 2-question paper —
  // the ledger is append-only per submission, so dedupe by question.
  const observedQuestionIds = new Set(
    paperLossRows.filter((row) => row.lossKind === 'OBSERVED' && row.lostScore === 2).map((row) => row.questionId),
  );
  assert.equal(observedQuestionIds.size, 40, 'all 40 priced MCQs priced at OBSERVED loss = 2');
  const proxyQuestionIds = new Set(paperLossRows.filter((row) => row.lossKind === 'PROXY').map((row) => row.questionId));
  assert.equal(proxyQuestionIds.size, 7, 'comprehensive self-scores stay PROXY (S1 语义零变更)');
  const yearBoardAfter = await getJson(`${apiUrl}/coach/real-exam-board?year=2026`, studentHeaders);
  assert.equal(yearBoardAfter.summary.answeredCount, 47, 'board flips to answered after the full paper');
  assert.equal(yearBoardAfter.summary.correctCount, 0);
  record('yearpaper-submit', 'full year paper submitted: accuracy over 47, OBSERVED 40×2 + PROXY 7 (D-R4-3 既有语义)');

  // ---- 5f. enhanced data screens (R4-C): 章节命题图谱 / 命题轨迹 / 难题榜.
  // Chapter map reads the EXAM tag layer (ExamQuestionKnowledgeTag): the
  // fixture seeds exactly one DS-C02 PRIMARY tag worth 2 分 (Q1).
  const chapters = await getJson(`${apiUrl}/coach/real-exam-chapters`, studentHeaders);
  assert.equal(chapters.storeAvailable, true);
  assert.deepEqual(chapters.yearAxis, [2026], 'year axis from the practice bank (single fixture year)');
  const chapterDs = chapters.chapters.find((chapter) => chapter.chapter === 'DS-C02');
  assert.ok(chapterDs, 'fixture exam tag DS-C02-… aggregates into the DS-C02 chapter');
  assert.equal(chapterDs.years[2026], 4, 'two fixture exam tags (Q1 DS + Q2 OS) both on nodeDs: 2+2 = 4 分');
  const trajectory = await getJson(`${apiUrl}/coach/real-exam-trajectory`, studentHeaders);
  assert.equal(trajectory.currentYear, new Date().getFullYear());
  assert.equal(trajectory.rows.length, 0, 'single-year window → nothing can be 沉默≥3年 yet (honest empty)');
  const hard = await getJson(`${apiUrl}/coach/real-exam-hard`, studentHeaders);
  assert.equal(hard.minAttempts, 2);
  // 全卷的 38 道选择题各只被作答 1 次 → 被样本门坎诚实排除；
  // qWrongA 作答 3 次（2 题卷 + 单题 + 全卷）、qWrongB 2 次（2 题卷 + 全卷）
  // → 唯二进榜，且同 100% 错误率下按样本量降序（排序规则钉死）。
  assert.equal(hard.total, 2, 'sample floor working: only questions with ≥2 attempts qualify');
  assert.deepEqual(hard.rows.map((row) => row.attempts), [3, 2], 'same wrong-rate → attempts desc');
  const hardTop = hard.rows[0];
  assert.equal(hardTop.wrongRatePct, 100, 'all-wrong questions rank first at 100%');
  assert.ok(hardTop.year === 2026 && hardTop.examNo >= 1 && hardTop.examNo <= 40, 'rank row carries year/examNo meta');
  assert.ok(hard.rows.every((row) => row.attempts >= 2), 'sample <2 never enters the ranking');
  record('screens-rc', 'R4-C screens: chapter map 4 分/DS-C02, trajectory honestly empty, hard ranking sample-floored');

  const lossRows = await prisma.scoreLossItem.findMany({ where: { userId: student } });
  // The full year-paper submission (5e) appends 47 more priced rows — the
  // ledger is append-only per submission. Pin the ORIGINAL two-question facts
  // (qWrongA/qWrongB) and the coverage ratio instead of a raw row count.
  const baseLossRows = lossRows.filter((row) => row.questionId === qWrongA || row.questionId === qWrongB);
  assert.ok(baseLossRows.length >= 2 && baseLossRows.every((row) => row.lossKind === 'OBSERVED' && row.lostScore === 2 && row.maxScore === 2),
    'importer-priced real exams → OBSERVED loss = maxScore (coverage ignition)');
  const pricedCount = lossRows.filter((row) => row.lostScore != null).length;
  assert.ok(pricedCount / lossRows.length > 0, `coverage = ${pricedCount}/${lossRows.length} > 0`);
  record('scoreloss', `coverage = ${pricedCount}/${lossRows.length} > 0 — V13 loss ledger priced by real-exam content`);

  // ---- 6. guards.
  const anon = await fetch(`${apiUrl}/coach/score-loss`);
  assert.equal(anon.status, 401, 'unauthenticated coach read → 401');
  for (const path of ['real-exam-board?year=2026', 'real-exam-dashboard', 'real-exam-frequency', 'real-exam-uncovered', 'real-exam-chapters', 'real-exam-trajectory', 'real-exam-hard']) {
    const response = await fetch(`${apiUrl}/coach/${path}`);
    assert.equal(response.status, 401, `unauthenticated /coach/${path} → 401`);
  }
  const badYear = await fetch(`${apiUrl}/coach/real-exam-board?year=abc`, { headers: studentHeaders });
  assert.equal(badYear.status, 400, `invalid year → 400 (got ${badYear.status}: ${await badYear.text().catch(() => '')})`);
  record('guards', 'unauthenticated score-loss + 4 new presentation endpoints → 401; invalid year → 400 (rejection paths)');
}

async function verifyRejectionPaths() {
  // Small CSVs exercising the hard-reject surface; every run must exit 1 with
  // a line-numbered reason and leave zero new questions behind.
  const questionsBefore = await prisma.question.count();

  const badTrapOnCorrect = await writeFixtureCsv('reject-trap-on-correct.csv', [
    {
      ...buildFixtureRows()[0],
      stem: `${MARKER} 拒绝-正确选项陷阱`,
      陷阱解析A: '正确选项不可能是陷阱',
    },
  ]);
  const trapRun = runImporter(badTrapOnCorrect, ['--dry-run']);
  assert.equal(trapRun.status, 1, 'trap on the correct option must be rejected');
  assert.ok(trapRun.stderr.includes('正确'), `expected the correct-option reason: ${trapRun.stderr}`);

  const badEssayTrap = await writeFixtureCsv('reject-essay-trap.csv', [
    { ...buildFixtureRows()[40], stem: `${MARKER} 拒绝-大题陷阱列`, 陷阱解析B: '大题没有陷阱' },
  ]);
  const essayRun = runImporter(badEssayTrap, ['--dry-run']);
  assert.equal(essayRun.status, 1, 'essay trap column must be rejected');
  assert.ok(essayRun.stderr.includes('陷阱解析'), essayRun.stderr);

  const badNode = await writeFixtureCsv('reject-unknown-node.csv', [
    { ...buildFixtureRows()[0], stem: `${MARKER} 拒绝-未知节点`, knowledgeNodeIds: 're-node-does-not-exist' },
  ]);
  const nodeRun = runImporter(badNode, ['--reviewed-by', REVIEWED_BY, '--uploaded-by', ids.admin, '--rights-confirmed']);
  assert.equal(nodeRun.status, 1, 'unknown knowledge node must be rejected');
  assert.ok(nodeRun.stderr.includes('re-node-does-not-exist'), nodeRun.stderr);

  const noReviewer = await writeFixtureCsv('reject-no-reviewer.csv', [buildFixtureRows()[0]]);
  const reviewerRun = runImporter(noReviewer, ['--uploaded-by', ids.admin, '--rights-confirmed']);
  assert.equal(reviewerRun.status, 1, 'missing --reviewed-by must be rejected (RULE-10)');
  assert.ok(reviewerRun.stderr.includes('--reviewed-by'), reviewerRun.stderr);

  const rightsRun = runImporter(noReviewer, ['--reviewed-by', REVIEWED_BY, '--uploaded-by', ids.admin]);
  assert.equal(rightsRun.status, 1, 'missing --rights-confirmed must be rejected (Owner D-1)');
  assert.ok(rightsRun.stderr.includes('--rights-confirmed'), rightsRun.stderr);

  assert.equal(await prisma.question.count(), questionsBefore, 'rejection paths leave zero new questions');
  record('rejections', 'trap-on-correct / essay-trap / unknown-node / no-reviewer / no-rights all rejected, zero writes');
}

// ---------------------------------------------------------------- cleanup

async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      // FK-safe order (sibling-suite discipline): redemptions → codes →
      // student evidence → paper → questions → orphan families → batch →
      // users → fixture dictionary rows. ReviewSchedule /
      // WrongQuestionReview / node tags / knowledge points cascade with the
      // questions; importBatch is Restrict so it goes AFTER the questions.
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.scoreLossItem.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.practiceRecord.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.wrongQuestionReview.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
      await prisma.question.deleteMany({ where: { stem: { contains: MARKER } } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { createdAt: { gte: runStartedAt }, versions: { none: {} } } }).catch(() => {});
      await prisma.questionImportBatch.deleteMany({ where: { source: 'real-exam-authoring', createdAt: { gte: runStartedAt } } }).catch(() => {});
      await prisma.examQuestion.deleteMany({ where: { id: { startsWith: `re-exq-${runId}-` } } }).catch(() => {});
      await prisma.examPaper.deleteMany({ where: { id: 'paper-408-2026-integration' } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: ids.pointDs } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.nodeDs, ids.nodeDs2] } } }).catch(() => {});
      if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
      await prisma.$disconnect();
    }
    if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
  } catch {
    // cleanup is best-effort; never masks the run result
  }
}

// ---------------------------------------------------------------- main

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    await seedBeforeBoot();
    await importAndVerify();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    await verifyRejectionPaths();
    console.log(`\nV14-P0 Real-Exam Import integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nV14-P0 Real-Exam Import integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output (full) ---');
      console.error(activeApi.getOutput());
    }
    await runCleanup();
    process.exit(1);
  } finally {
    // Cleanup runs explicitly before each process.exit (Node never executes
    // finally after process.exit) — same discipline as the sibling suites.
  }
})();
