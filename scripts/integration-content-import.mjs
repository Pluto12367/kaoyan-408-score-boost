// Integration check for P1-4: the starter-320 question bank can be imported
// idempotently and the learning loop (catalog, knowledge points,
// recommendations, stage assessment) works afterwards.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';

const root = process.cwd();
const apiPort = 3202;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const integrationJwtSecret = 'integration-content-import-jwt-secret-with-more-than-32-characters';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const testDatabaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const contentDatabaseUrl = withDatabaseName(testDatabaseUrl, 'kaoyan408_test_content');
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
    env: { ...process.env, DATABASE_URL: contentDatabaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (schemaResult.status !== 0) {
    throw new Error(`Prisma migration deploy failed: ${schemaResult.error?.message || schemaResult.stderr || schemaResult.stdout}`);
  }

  const firstImport = runImport();
  assert(/Import complete\. created=320 updated=0 skipped=0/.test(firstImport), `first import should create all starter questions: ${firstImport}`);
  const secondImport = runImport();
  assert(/Import complete\. created=0 updated=0 skipped=320/.test(secondImport), `second import should be fully idempotent: ${secondImport}`);

  activeApi = startApi();
  await waitForHealth(activeApi);

  const questionCatalog = await getJson(`${apiUrl}/questions`);
  assert(questionCatalog.length === 320, `question catalog should contain 320 imported questions, got ${questionCatalog.length}`);
  assert(questionCatalog.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'imported catalog must stay redacted for students');
  const bankClient = new PrismaClient({ datasourceUrl: contentDatabaseUrl });
  const bankRows = await bankClient.question.findMany({
    select: {
      id: true,
      stem: true,
      createdAt: true,
      isCurrent: true,
      _count: { select: { knowledgePoints: true } },
    },
  });
  const { summarizeBank } = await import('./question-bank-dedupe.mjs');
  const bankSummary = summarizeBank(bankRows);
  assert(
    bankSummary.total === 320 && bankSummary.duplicateRows === 0,
    `fresh import should leave a deduplicated bank: ${JSON.stringify(bankSummary)}`,
  );
  await bankClient.$disconnect();

  const demoLogin = await postJson(`${apiUrl}/auth/demo-login`, { role: 'student' });
  const demoHeaders = { Authorization: `Bearer ${demoLogin.token}` };
  const knowledgePointCatalog = await getJson(`${apiUrl}/knowledge-points`, demoHeaders);
  assert(knowledgePointCatalog.length === 16, `knowledge point catalog should contain 16 starter points, got ${knowledgePointCatalog.length}`);
  assert(knowledgePointCatalog.some((point) => point.id === 'ds-list'), 'starter knowledge points should join the learning engine');

  const recommendedSet = await getJson(`${apiUrl}/practice-sets/recommended`, demoHeaders);
  assert(recommendedSet.questionCount > 0, 'recommended practice set should be non-empty after content import');
  const stageAssessment = await getJson(`${apiUrl}/assessments/stage`, demoHeaders);
  assert(stageAssessment.questions.length > 0, 'stage assessment should be non-empty after content import');

  console.log(JSON.stringify({ ok: true, source: 'postgresql', scenario: 'content-import', questions: questionCatalog.length, knowledgePoints: knowledgePointCatalog.length, apiPort }));
}

function runImport() {
  const result = spawnSync(process.execPath, ['scripts/import-questions.mjs'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: contentDatabaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Question import failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

async function recreateDatabase() {
  const maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl });
  await maintenance.$executeRawUnsafe('DROP DATABASE IF EXISTS kaoyan408_test_content WITH (FORCE)');
  await maintenance.$executeRawUnsafe('CREATE DATABASE kaoyan408_test_content');
  await maintenance.$disconnect();
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: String(apiPort),
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: contentDatabaseUrl,
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
  throw new Error('Timed out waiting for content-import API health check');
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
      await maintenance.$executeRawUnsafe('DROP DATABASE IF EXISTS kaoyan408_test_content WITH (FORCE)');
      await maintenance.$disconnect();
    } catch {
      // Cleanup best effort: the test database is recreated on the next run.
    }
  });
