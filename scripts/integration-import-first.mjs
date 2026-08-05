// Integration check for P1-2: a fresh database populated with an imported
// question bank BEFORE the first API boot must start cleanly. Demo seed
// records that reference absent built-in questions are skipped instead of
// crashing startup with a foreign key error.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';

const root = process.cwd();
const apiPort = 3201;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const integrationJwtSecret = 'integration-import-first-jwt-secret-with-more-than-32-characters';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const testDatabaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const importFirstDatabaseUrl = withDatabaseName(testDatabaseUrl, 'kaoyan408_test_import_first');
const maintenanceUrl = withDatabaseName(testDatabaseUrl, 'postgres');

let activeApi;

async function main() {
  await recreateDatabase();
  const schemaResult = spawnSync(npx, [
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: importFirstDatabaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (schemaResult.status !== 0) {
    throw new Error(`Prisma migration deploy failed: ${schemaResult.error?.message || schemaResult.stderr || schemaResult.stdout}`);
  }

  const fixturePrisma = new PrismaClient({ datasourceUrl: importFirstDatabaseUrl });
  await fixturePrisma.knowledgePoint.create({
    data: {
      id: 'fixture-imported-point',
      subject: 'DATA_STRUCTURE',
      chapter: '集成测试章节',
      title: '先导入后启动知识点',
      importance: 3,
      frequency: 3,
      prerequisites: [],
    },
  });
  await fixturePrisma.question.create({
    data: {
      id: 'q-fixture-imported',
      family: { create: {} },
      versionNumber: 1,
      isCurrent: true,
      contentFingerprint: 'fixture-import-first-fingerprint',
      stem: '先导入后启动的题目',
      options: ['A', 'B', 'C', 'D'],
      answer: 'A',
      analysis: 'fixture analysis',
      difficulty: 'BASIC',
      type: 'SINGLE_CHOICE',
      source: 'fixture-import',
      year: 2026,
      expectedTimeSec: 90,
      knowledgePoints: {
        create: [{ knowledgePointId: 'fixture-imported-point' }],
      },
    },
  });
  await fixturePrisma.$disconnect();

  activeApi = startApi();
  await waitForHealth(activeApi);

  const questionCatalog = await getJson(`${apiUrl}/questions`);
  assert(questionCatalog.some((question) => question.id === 'q-fixture-imported'), 'API should serve an imported bank that existed before first boot');
  assert(questionCatalog.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'imported bank must stay redacted for students');
  const demoLogin = await postJson(`${apiUrl}/auth/demo-login`, { role: 'teacher' });
  const demoHeaders = { Authorization: `Bearer ${demoLogin.token}` };
  const knowledgePointCatalog = await getJson(`${apiUrl}/knowledge-points`, demoHeaders);
  assert(knowledgePointCatalog.some((point) => point.id === 'fixture-imported-point'), 'imported knowledge point should join the learning engine');

  const verifyPrisma = new PrismaClient({ datasourceUrl: importFirstDatabaseUrl });
  const seedRecordCount = await verifyPrisma.practiceRecord.count({
    where: { id: { in: ['r-001', 'r-002', 'r-003'] } },
  });
  const absentQuestionRecordCount = await verifyPrisma.practiceRecord.count({
    where: { questionId: { in: ['q-001', 'q-002'] } },
  });
  await verifyPrisma.$disconnect();
  assert(seedRecordCount === 0, 'demo seed records referencing absent built-in questions should be skipped');
  assert(absentQuestionRecordCount === 0, 'no practice records should point at absent built-in questions');

  console.log(JSON.stringify({ ok: true, source: 'postgresql', scenario: 'import-first', apiPort }));
}

async function recreateDatabase() {
  const maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl });
  await maintenance.$executeRawUnsafe('DROP DATABASE IF EXISTS kaoyan408_test_import_first WITH (FORCE)');
  await maintenance.$executeRawUnsafe('CREATE DATABASE kaoyan408_test_import_first');
  await maintenance.$disconnect();
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: String(apiPort),
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: importFirstDatabaseUrl,
      JWT_SECRET: integrationJwtSecret,
      ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(output.trim());
  });
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`PostgreSQL API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.dataSource === 'postgresql' && child.exitCode == null) return;
      }
    } catch {}
    await delay(400);
  }
  throw new Error('Timed out waiting for import-first API health check');
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`);
  return response.json();
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill();
  await Promise.race([once(child, 'exit'), delay(2_000)]);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDatabaseName(url, databaseName) {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

main()
  .catch((error) => {
    console.error(error);
    const output = activeApi?.getOutput?.();
    if (output) console.error(output.slice(-4_000));
    process.exitCode = 1;
  })
  .finally(async () => {
    await stop(activeApi);
    try {
      const maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl });
      await maintenance.$executeRawUnsafe('DROP DATABASE IF EXISTS kaoyan408_test_import_first WITH (FORCE)');
      await maintenance.$disconnect();
    } catch {
      // Cleanup best effort: the test database is recreated on the next run.
    }
  });
