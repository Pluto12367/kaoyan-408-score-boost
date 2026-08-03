import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readStagingSmokeConfig,
  runQuestionImportSmoke,
  runStagingSmoke,
} from '../scripts/staging-smoke.mjs';

test('staging smoke configuration requires an HTTPS API and dedicated credentials', () => {
  assert.throws(
    () => readStagingSmokeConfig({}),
    /STAGING_API_URL is required/,
  );
  assert.throws(
    () => readStagingSmokeConfig({
      STAGING_API_URL: 'http://api.example.com',
      STAGING_SMOKE_EMAIL: 'smoke@example.com',
      STAGING_SMOKE_PASSWORD: 'ReliablePassword!408',
      STAGING_SMOKE_INVITATION: 'invite-smoke-code',
      STAGING_ADMIN_EMAIL: 'admin@example.com',
      STAGING_ADMIN_PASSWORD: 'AdminPassword!408',
    }),
    /must use HTTPS/,
  );

  assert.deepEqual(readStagingSmokeConfig({
    STAGING_API_URL: 'https://api.example.com/',
    STAGING_WEB_ORIGIN: 'https://web.example.com/',
    STAGING_SMOKE_EMAIL: 'smoke@example.com',
    STAGING_SMOKE_PASSWORD: 'ReliablePassword!408',
    STAGING_SMOKE_INVITATION: 'invite-smoke-code',
    STAGING_ADMIN_EMAIL: 'admin@example.com',
    STAGING_ADMIN_PASSWORD: 'AdminPassword!408',
  }), {
    apiUrl: 'https://api.example.com',
    webOrigin: 'https://web.example.com',
    email: 'smoke@example.com',
    password: 'ReliablePassword!408',
    invitationCode: 'invite-smoke-code',
    adminEmail: 'admin@example.com',
    adminPassword: 'AdminPassword!408',
  });
});

test('question-import staging smoke exercises the admin review and confirmation release gate', async () => {
  const calls = [];
  let confirmationCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: requestUrl.pathname, auth: headerValue(init.headers, 'authorization'), body: init.body });
    if (requestUrl.pathname === '/auth/login') return jsonResponse(200, { accessToken: 'admin-token', user: { role: 'admin' } });
    if (requestUrl.pathname === '/admin/question-imports' && method === 'POST' && !headerValue(init.headers, 'authorization')) return jsonResponse(401, { message: 'Unauthorized' });
    if (requestUrl.pathname === '/questions' && method === 'POST') return jsonResponse(201, { id: 'q-baseline', familyId: 'family-1' });
    if (requestUrl.pathname === '/admin/question-imports' && method === 'POST') return jsonResponse(202, { batchId: 'batch-1', status: 'queued' });
    if (requestUrl.pathname === '/admin/question-imports/batch-1') return jsonResponse(200, { id: 'batch-1', status: 'parsing_partial_failure', jobs: [{ id: 'failed-job', state: 'failed' }], assets: [{ pageNumber: 1 }] });
    if (requestUrl.pathname === '/admin/question-imports/batch-1/retry') return jsonResponse(201, { batchId: 'batch-1', retriedJobs: 1 });
    if (requestUrl.pathname === '/admin/question-imports/batch-1/candidates') return jsonResponse(200, { items: [
      { id: 'skip', revision: 0, status: 'duplicate_suspected', duplicateAction: 'skip', targetFamilyId: 'family-1', stem: 'hidden' },
      { id: 'version', revision: 0, status: 'pending_review', duplicateAction: 'new_version', targetFamilyId: 'family-1', stem: 'hidden' },
    ], total: 2 });
    if (requestUrl.pathname.startsWith('/admin/question-imports/candidates/') && method === 'PATCH') return jsonResponse(200, { id: 'version', revision: 1, status: 'approved' });
    if (requestUrl.pathname === '/admin/question-imports/batch-1/confirm') {
      confirmationCalls += 1;
      return jsonResponse(201, { importedCandidateIds: ['version'], skippedCandidateIds: ['skip'], questionIds: ['question-current'] });
    }
    throw new Error(`Unexpected request: ${method} ${requestUrl.pathname}`);
  };

  const result = await runQuestionImportSmoke({
    apiUrl: 'https://api.example.com', adminEmail: 'admin@example.com', adminPassword: 'AdminPassword!408',
  }, { fetchImpl, log: () => undefined });

  assert.equal(result.ok, true);
  assert.equal(result.importedQuestionId, 'question-current');
  assert.equal(confirmationCalls, 2, 'the same idempotency key must be replayed once');
  assert.equal(calls.some((call) => call.path === '/admin/question-imports' && !call.auth), true, 'unauthorized upload must be checked');
  assert.equal(calls.some((call) => call.path === '/questions' && call.auth), true, 'baseline duplicate fixture must be seeded by an administrator');
  assert.equal(calls.some((call) => call.path.endsWith('/retry')), true);
  assert.equal(calls.filter((call) => call.path.endsWith('/confirm')).length, 2);
});

test('staging smoke verifies the authenticated persistence path without exposing secrets', async () => {
  const password = 'SecretSmokePassword!408';
  const token = 'private-access-token';
  const calls = [];
  let onboardingCompleted = false;
  let taskCompleted = false;
  let loginCount = 0;

  const fetchImpl = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: requestUrl.href, method, headers: init.headers ?? {}, body });

    if (method === 'OPTIONS') {
      const origin = headerValue(init.headers, 'origin');
      return new Response(null, {
        status: 204,
        headers: origin === 'https://web.example.com'
          ? { 'access-control-allow-origin': origin }
          : {},
      });
    }
    if (requestUrl.pathname === '/health') {
      return jsonResponse(200, {
        status: 'ok',
        dataSource: 'postgresql',
        checks: { database: 'connected' },
      }, { 'x-request-id': 'request-1' });
    }
    if (requestUrl.pathname === '/auth/demo-login') return jsonResponse(403, { message: 'Forbidden' });
    if (requestUrl.pathname === '/auth/login') {
      loginCount += 1;
      if (loginCount === 1) return jsonResponse(401, { message: 'Not registered' });
      return jsonResponse(200, {
        accessToken: token,
        refreshToken: 'private-refresh-token',
        user: { id: 'student-smoke', role: 'student' },
      });
    }
    if (requestUrl.pathname === '/auth/register') {
      if (!body.inviteCode) return jsonResponse(400, { message: 'Invite code required' });
      assert.equal(body.inviteCode, 'invite-smoke-code');
      return jsonResponse(201, {
        accessToken: token,
        refreshToken: 'private-refresh-token',
        user: { id: 'student-smoke', role: 'student' },
      });
    }
    if (requestUrl.pathname === '/onboarding/complete') {
      onboardingCompleted = true;
      return jsonResponse(201, {
        sevenDayPlan: { days: Array.from({ length: 7 }, (_, index) => ({ day: index + 1 })) },
        todayPlan: { priorityTasks: [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }] },
      });
    }
    if (requestUrl.pathname === '/dashboard/overview' && requestUrl.searchParams.has('userId')) {
      return jsonResponse(403, { message: 'Forbidden' });
    }
    if (requestUrl.pathname === '/dashboard/overview') {
      return jsonResponse(200, {
        source: 'postgresql',
        student: {
          id: 'student-smoke',
          targetScore: onboardingCompleted ? 126 : 0,
          currentScore: onboardingCompleted ? 82 : 0,
        },
        plan: {
          dailyTasks: [
            { id: 'task-1', completed: taskCompleted },
            { id: 'task-2', completed: false },
            { id: 'task-3', completed: false },
          ],
        },
      });
    }
    if (requestUrl.pathname === '/study-tasks/task-1/complete') {
      assert.equal(body.selfRating, 4);
      taskCompleted = true;
      return jsonResponse(201, { id: 'task-1', completed: true });
    }
    if (requestUrl.pathname === '/auth/logout') return jsonResponse(201, { success: true });
    throw new Error(`Unexpected request: ${method} ${requestUrl.href}`);
  };

  const messages = [];
  const result = await runStagingSmoke({
    apiUrl: 'https://api.example.com',
    webOrigin: 'https://web.example.com',
    email: 'smoke@example.com',
    password,
    invitationCode: 'invite-smoke-code',
  }, {
    fetchImpl,
    log: (message) => messages.push(message),
  });

  assert.equal(result.ok, true);
  assert.equal(result.dataSource, 'postgresql');
  assert.equal(result.persistedTargetScore, 126);
  assert.equal(result.persistedCompletedTaskId, 'task-1');
  assert.equal(result.checks, 10);
  assert.equal(loginCount, 2, 'the smoke path must retry login after invitation registration');
  assert.equal(calls.some((call) => call.url.includes('userId=forged-student')), true);
  assert.equal(calls.some((call) => call.url.endsWith('/auth/register') && call.body?.inviteCode === 'invite-smoke-code'), true);
  assert.equal(calls.some((call) => call.url.endsWith('/auth/demo-login')), true);
  assert.equal(calls.filter((call) => call.method === 'OPTIONS').length, 2);
  assert.equal(calls.every((call) => call.url.startsWith('https://api.example.com/')), true);

  const output = `${messages.join('\n')}\n${JSON.stringify(result)}`;
  assert.doesNotMatch(output, new RegExp(password));
  assert.doesNotMatch(output, new RegExp(token));
  assert.doesNotMatch(output, /refresh-token/);
});

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
