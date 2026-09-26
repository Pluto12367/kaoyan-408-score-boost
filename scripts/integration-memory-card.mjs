/**
 * V14-② — memory-card real PG + HTTP E2E (task book
 * docs/v14-memory-card-design.md §7.2; Owner-approved 2026-09-26).
 *
 * Chain: RULE-10 import chain → session queue (new cards + honest unset
 * exam-date fallback) → exam-date density switch (canonical exam-timeline)
 * → three-level self-assessment writes CARD state ONLY → NEGATIVE FENCE:
 * UserKnowledgeMastery / ReviewSchedule stay untouched → idempotent replay →
 * rejection paths (400 ×2, 404, 401 ×2, 409 cross-user) → due resurfacing.
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const root = process.cwd();
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const apiUrl = 'http://127.0.0.1:3272';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-memory-card-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Memory-Card-Integration-Password-1';

const ids = {
  admin: `mc-admin-${runId}`,
  nodeA: `mc-node-a-${runId}`,
  nodeB: `mc-node-b-${runId}`,
};
let prisma = null;
let activeApi = null;
let tmpDir = null;
let studentA = null;
let studentB = null;
// Baselines captured before any card review — the negative fence compares
// against these after every review.
let masteryBaseline = 0;
let scheduleBaseline = 0;

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

function runImporter(csvPath, extraArgs) {
  return spawnSync(process.execPath, ['scripts/import-memory-cards.mjs', csvPath, ...extraArgs], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
}

async function seedBeforeBoot() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: 'seed', role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: '记忆卡管理员', role: 'ADMIN',
      passwordHash: 'seed', trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.nodeA, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 操作 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.nodeB, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: `邻接表 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });

  tmpDir = mkdtempSync(join(tmpdir(), 'memory-card-'));
  const csvPath = join(tmpDir, 'cards.csv');
  writeFileSync(csvPath, [
    '知识节点ID,卡片类型,正面,背面',
    `${ids.nodeA},CONCLUSION,P 操作申请资源时调用哪个原语？,P(S)：申请一个资源，S 减 1`,
    `${ids.nodeA},FORMULA,信号量值 S 的含义是什么？,S>0 表示可用资源数；S<0 绝对值=等待进程数`,
    `${ids.nodeB},CONCLUSION,邻接表适合存哪种图？,适合存稀疏图；稠密图用邻接矩阵更省`,
  ].join('\n'), 'utf8');

  // RULE-10 refusal path: no --reviewed-by / --rights-confirmed → refuse.
  const refusal = spawnSync(process.execPath, ['scripts/import-memory-cards.mjs', csvPath], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
  });
  assert.notEqual(refusal.status, 0, 'import without RULE-10 flags must refuse');
  assert.match(refusal.stdout + refusal.stderr, /--reviewed-by/);
  assert.equal(await prisma.memoryCard.count(), 0, 'refused import wrote nothing');
  record('rule10-refusal', 'importer refused without --reviewed-by/--rights-confirmed; zero rows written');

  // Row validation: an invalid row (empty front) aborts the whole batch.
  const badRowPath = join(tmpDir, 'cards-bad-row.csv');
  writeFileSync(badRowPath, [
    '知识节点ID,卡片类型,正面,背面',
    `${ids.nodeA},CONCLUSION,P 操作申请资源时调用哪个原语？,P(S)：申请一个资源，S 减 1`,
    `${ids.nodeB},CONCLUSION,,背面不该被导入`,
  ].join('\n'), 'utf8');
  const badRow = runImporter(badRowPath, ['--reviewed-by', 'integration(Owner-authorized)', '--rights-confirmed']);
  assert.notEqual(badRow.status, 0, 'invalid row must abort the batch');
  assert.match(badRow.stdout + badRow.stderr, /正面为空/);
  assert.equal(await prisma.memoryCard.count(), 0, 'aborted batch wrote nothing');
  record('row-validation', 'empty-front row → whole batch refused, zero rows written');

  // Dry-run on the valid CSV: exit 0, still zero rows.
  const dry = runImporter(csvPath, ['--dry-run']);
  assert.equal(dry.status, 0, `dry-run failed: ${dry.stderr}`);
  assert.equal(await prisma.memoryCard.count(), 0, 'dry-run writes nothing');
  record('dry-run', 'structure validation passed (3 valid rows), zero rows written');

  // Real import: created=3 with RULE-10 provenance stamped per row.
  const imported = runImporter(csvPath, ['--reviewed-by', 'integration(Owner-authorized)', '--rights-confirmed']);
  assert.equal(imported.status, 0, `import failed: ${imported.stderr}`);
  assert.match(imported.stdout, /created=3 skipped=0/);
  const cards = await prisma.memoryCard.findMany({ where: { knowledgeNodeId: { in: [ids.nodeA, ids.nodeB] } } });
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.equal(card.reviewedBy, 'integration(Owner-authorized)');
    assert.equal(card.rightsConfirmed, true);
  }
  record('import', `created=3 with reviewedBy/rightsConfirmed stamped (RULE-10 chain): ${imported.stdout.trim().split('\n').pop()}`);

  // Idempotent re-run: same CSV → skipped, no duplicates.
  const rerun = runImporter(csvPath, ['--reviewed-by', 'integration(Owner-authorized)', '--rights-confirmed']);
  assert.equal(rerun.status, 0);
  assert.match(rerun.stdout, /created=0 skipped=3/);
  record('idempotent-import', 're-run created=0 skipped=3');
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env, PORT: '3272', WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, ALLOW_DEMO_AUTH: 'true',
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
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API did not become healthy in time');
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function createStudent(tag) {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: `mc ${tag}`,
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  const email = `mc-${tag}-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: `记忆卡学生${tag}`, inviteCode: invite });
  const userId = registered.body?.user?.id ?? registered.body?.id;
  await prisma.user.update({ where: { id: userId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email, password })).body.accessToken;
  return { userId, headers: { authorization: `Bearer ${token}` } };
}

async function assertFenceHolds(label) {
  const mastery = await prisma.userKnowledgeMastery.count({ where: { userId: studentA.userId } });
  const schedules = await prisma.reviewSchedule.count({ where: { userId: studentA.userId } });
  assert.equal(mastery, masteryBaseline, `${label}: UserKnowledgeMastery rows changed — card review leaked into the ability layer`);
  assert.equal(schedules, scheduleBaseline, `${label}: ReviewSchedule rows changed — card review leaked into the question-review domain`);
}

async function verifyAfterBoot() {
  studentA = await createStudent('a');
  studentB = await createStudent('b');
  masteryBaseline = await prisma.userKnowledgeMastery.count({ where: { userId: studentA.userId } });
  scheduleBaseline = await prisma.reviewSchedule.count({ where: { userId: studentA.userId } });
  assert.equal(masteryBaseline, 0);
  assert.equal(scheduleBaseline, 0);

  // Session with NO exam date: honest labelled fallback; queue = 2 new cards.
  const first = await getJson(`${apiUrl}/memory-cards/session`, studentA.headers);
  assert.equal(first.status, 200);
  assert.equal(first.body.storeAvailable, true);
  assert.equal(first.body.examContext.isFallback, true);
  assert.equal(first.body.examContext.basis, 'fallback_constant');
  assert.match(first.body.examContext.label, /考试日期未设置/);
  assert.equal(first.body.summary.newCount, 3);
  assert.equal(first.body.summary.dueCount, 0);
  assert.equal(first.body.queue.length, 3);
  for (const item of first.body.queue) {
    assert.equal(item.phase, 'new');
    assert.equal(item.retention, null, 'new cards report retention null, never 0.5');
    assert.ok(item.nodeName, 'node name resolved');
  }
  record('session-fallback', `unset exam date → fallback_constant label; queue=3 new cards (retention null)`);

  const anonA = await getJson(`${apiUrl}/memory-cards/session`);
  assert.equal(anonA.status, 401);
  record('guard-401', 'unauthenticated session read → 401');

  // Set the exam date 20 days out through the REAL exam-date endpoint →
  // density becomes exam_date / intensified ×0.7.
  const examDate = new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10);
  const set = await postJson(`${apiUrl}/coach/exam-date`, { examDate }, studentA.headers);
  assert.equal(set.status, 201, `exam-date set failed: ${JSON.stringify(set.body)}`);
  const after = await getJson(`${apiUrl}/memory-cards/session`, studentA.headers);
  assert.equal(after.body.examContext.basis, 'exam_date');
  assert.equal(after.body.examContext.isFallback, false);
  assert.equal(after.body.examContext.daysToExam, 20);
  assert.match(after.body.examContext.label, /距离考试 20 天/);
  assert.match(after.body.examContext.label, /加密/);
  record('exam-date-density', 'POST /coach/exam-date (D+20) → density basis exam_date, intensified ×0.7');

  const queue = after.body.queue;
  const cardA1 = queue.find((item) => item.front.includes('P 操作'));
  const cardA2 = queue.find((item) => item.front.includes('信号量'));
  const cardB1 = queue.find((item) => item.front.includes('邻接表'));

  // Review 1: 记住 → quality 4, stability null→1.7, interval 1.7×0.7=1.19d.
  const beforeReview = Date.now();
  const r1 = await postJson(`${apiUrl}/memory-cards/${cardA1.cardId}/review`, {
    rating: 'remembered', idempotencyKey: `mc-r1-${runId}`,
  }, studentA.headers);
  assert.equal(r1.status, 200, `review failed: ${JSON.stringify(r1.body)}`);
  assert.equal(r1.body.replayed, false);
  assert.equal(r1.body.applied.quality, 4);
  assert.equal(r1.body.applied.stabilityBefore, null);
  assert.equal(r1.body.applied.stabilityAfter, 1.7, 'shared multiplier ×1.7 for quality 4');
  assert.equal(r1.body.applied.densityFactor, 0.7);
  assert.equal(r1.body.applied.densityBasis, 'exam_date');
  assert.ok(Math.abs(r1.body.applied.intervalDays - 1.19) < 1e-9, `interval=${r1.body.applied.intervalDays}`);
  assert.equal(r1.body.state.reviewCount, 1);
  assert.equal(r1.body.state.retention, 1);
  const elapsedReal = (Date.now() - beforeReview) / 1000;
  const nextIn = (new Date(r1.body.state.nextReviewAt).getTime() - beforeReview) / 1000;
  assert.ok(nextIn > 1.19 * 86_400 - elapsedReal - 5_000, `nextReviewAt ≈ now + 1.19d (got ${Math.round(nextIn)}s)`);
  record('review-remembered', '记住 → quality 4, stability 1.7, interval 1.19d via shared math × exam density');

  await assertFenceHolds('after review 1');

  // Review 2: 没记住 → quality 0, stability 0.6, interval clamp(0.42→0.5d).
  const r2 = await postJson(`${apiUrl}/memory-cards/${cardA2.cardId}/review`, {
    rating: 'forgot', idempotencyKey: `mc-r2-${runId}`,
  }, studentA.headers);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.applied.quality, 0);
  assert.equal(r2.body.applied.stabilityAfter, 0.6, 'shared multiplier ×0.6 for quality 0');
  assert.equal(r2.body.applied.intervalDays, 0.5, 'interval floored at 0.5d so 没记住 resurfaces fast');
  record('review-forgot', '没记住 → quality 0, stability 0.6, interval 0.5d floor');
  await assertFenceHolds('after review 2');

  // Idempotent replay: same key → replayed, no double write.
  const replay = await postJson(`${apiUrl}/memory-cards/${cardA1.cardId}/review`, {
    rating: 'remembered', idempotencyKey: `mc-r1-${runId}`,
  }, studentA.headers);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const logCount = await prisma.memoryCardReviewLog.count({ where: { cardId: cardA1.cardId } });
  const stateRow = await prisma.userMemoryCardState.findUnique({
    where: { userId_cardId: { userId: studentA.userId, cardId: cardA1.cardId } },
  });
  assert.equal(logCount, 1, 'replay must not append a second log row');
  assert.equal(stateRow.reviewCount, 1, 'replay must not re-apply the review');
  record('idempotent-replay', 'same idempotencyKey → replayed=true, log=1, reviewCount=1');

  // Rejection paths.
  const badRating = await postJson(`${apiUrl}/memory-cards/${cardB1.cardId}/review`, {
    rating: 'easy', idempotencyKey: `mc-bad-${runId}`,
  }, studentA.headers);
  assert.equal(badRating.status, 400);
  const noKey = await postJson(`${apiUrl}/memory-cards/${cardB1.cardId}/review`, {
    rating: 'remembered',
  }, studentA.headers);
  assert.equal(noKey.status, 400);
  const missing = await postJson(`${apiUrl}/memory-cards/mc-does-not-exist/review`, {
    rating: 'remembered', idempotencyKey: `mc-missing-${runId}`,
  }, studentA.headers);
  assert.equal(missing.status, 404);
  const anonReview = await postJson(`${apiUrl}/memory-cards/${cardB1.cardId}/review`, {
    rating: 'remembered', idempotencyKey: `mc-anon-${runId}`,
  });
  assert.equal(anonReview.status, 401);
  record('rejections', 'bad rating → 400; missing key → 400; unknown card → 404; anonymous review → 401');

  // Cross-user isolation: B sees both of B's own cards as NEW (A's reviews
  // are invisible), and cannot replay A's idempotency key (409).
  const sessionB = await getJson(`${apiUrl}/memory-cards/session`, studentB.headers);
  assert.equal(sessionB.body.summary.newCount, 3, 'student B still sees all cards as their own new cards');
  assert.equal(sessionB.body.summary.dueCount, 0);
  assert.equal(sessionB.body.examContext.isFallback, true, 'B has no exam date — own honest fallback');
  const stolen = await postJson(`${apiUrl}/memory-cards/${cardA1.cardId}/review`, {
    rating: 'remembered', idempotencyKey: `mc-r1-${runId}`,
  }, studentB.headers);
  assert.equal(stolen.status, 409, 'idempotencyKey reuse across users must be refused');
  record('isolation', 'per-user state isolation holds; cross-user key replay → 409');

  // Due resurfacing: backdate card A1's schedule → due, shared-formula retention.
  await prisma.userMemoryCardState.update({
    where: { userId_cardId: { userId: studentA.userId, cardId: cardA1.cardId } },
    data: { nextReviewAt: new Date(Date.now() - 2 * 3_600_000) },
  });
  const dueSession = await getJson(`${apiUrl}/memory-cards/session`, studentA.headers);
  assert.equal(dueSession.body.summary.dueCount, 1);
  const dueItem = dueSession.body.queue[0];
  assert.equal(dueItem.cardId, cardA1.cardId);
  assert.equal(dueItem.phase, 'due');
  assert.ok(dueItem.retention > 0.9 && dueItem.retention < 1, `retention=${dueItem.retention} (shared exp decay)`);
  record('due-resurfacing', `backdated schedule → due queue with retention ${dueItem.retention.toFixed(4)}`);

  // FINAL FENCE: after every card write, ability + question-review domains
  // are still byte-for-byte untouched for this user.
  await assertFenceHolds('final');
  const logs = await prisma.memoryCardReviewLog.findMany({ where: { userId: studentA.userId } });
  assert.equal(logs.length, 2);
  for (const log of logs) {
    assert.ok([0, 2, 4].includes(log.rating), 'log ratings stay in the controlled subset');
    assert.ok(log.densityFactor > 0);
    assert.ok(log.densityBasis.length > 0);
  }
  record('final-fence', 'UserKnowledgeMastery=0 rows, ReviewSchedule=0 rows after 2 card reviews; log rows carry quality+density provenance');
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    console.log(`\nV14-② Memory Card integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nV14-② Memory Card integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    await runCleanup();
    process.exit(1);
  } finally {
    // Cleanup runs explicitly before each process.exit: process.exit()
    // terminates the process synchronously and never executes finally.
  }
})();

async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      await prisma.memoryCardReviewLog.deleteMany({ where: { card: { knowledgeNodeId: { in: [ids.nodeA, ids.nodeB] } } } }).catch(() => {});
      await prisma.userMemoryCardState.deleteMany({ where: { card: { knowledgeNodeId: { in: [ids.nodeA, ids.nodeB] } } } }).catch(() => {});
      await prisma.memoryCard.deleteMany({ where: { knowledgeNodeId: { in: [ids.nodeA, ids.nodeB] } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.nodeA, ids.nodeB] } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
  } catch {
    // cleanup is best-effort
  }
}
