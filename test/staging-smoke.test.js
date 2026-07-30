import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readStagingSmokeConfig,
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
    }),
    /must use HTTPS/,
  );

  assert.deepEqual(readStagingSmokeConfig({
    STAGING_API_URL: 'https://api.example.com/',
    STAGING_WEB_ORIGIN: 'https://web.example.com/',
    STAGING_SMOKE_EMAIL: 'smoke@example.com',
    STAGING_SMOKE_PASSWORD: 'ReliablePassword!408',
    STAGING_SMOKE_INVITATION: 'invite-smoke-code',
  }), {
    apiUrl: 'https://api.example.com',
    webOrigin: 'https://web.example.com',
    email: 'smoke@example.com',
    password: 'ReliablePassword!408',
    invitationCode: 'invite-smoke-code',
  });
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
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
