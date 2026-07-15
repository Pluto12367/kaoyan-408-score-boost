const defaultOrigin = 'https://pluto12367.github.io';

export function readStagingSmokeConfig(env = process.env) {
  const apiUrl = required(env.STAGING_API_URL, 'STAGING_API_URL');
  const email = required(env.STAGING_SMOKE_EMAIL, 'STAGING_SMOKE_EMAIL');
  const password = required(env.STAGING_SMOKE_PASSWORD, 'STAGING_SMOKE_PASSWORD');
  const webOrigin = (env.STAGING_WEB_ORIGIN || defaultOrigin).trim();

  const parsedApiUrl = parseUrl(apiUrl, 'STAGING_API_URL');
  const parsedWebOrigin = parseUrl(webOrigin, 'STAGING_WEB_ORIGIN');
  if (parsedApiUrl.protocol !== 'https:') throw new Error('STAGING_API_URL must use HTTPS');
  if (parsedWebOrigin.protocol !== 'https:') throw new Error('STAGING_WEB_ORIGIN must use HTTPS');
  if (password.length < 12) throw new Error('STAGING_SMOKE_PASSWORD must contain at least 12 characters');

  return {
    apiUrl: trimTrailingSlash(parsedApiUrl.href),
    webOrigin: trimTrailingSlash(parsedWebOrigin.href),
    email: email.toLowerCase(),
    password,
  };
}

export async function runStagingSmoke(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.log;
  const apiUrl = trimTrailingSlash(config.apiUrl);
  const checkpoint = (message) => log(`[staging-smoke] PASS ${message}`);

  const healthResponse = await request(fetchImpl, `${apiUrl}/health`);
  const health = await readJson(healthResponse, 'GET /health');
  ensure(healthResponse.ok, 'GET /health must succeed');
  ensure(health.status === 'ok', 'health status must be ok');
  ensure(health.dataSource === 'postgresql', 'health data source must be postgresql');
  ensure(health.checks?.database === 'connected', 'health database check must be connected');
  ensure(Boolean(healthResponse.headers.get('x-request-id')), 'health response must include x-request-id');
  checkpoint('health and PostgreSQL');

  await verifyCors(fetchImpl, apiUrl, config.webOrigin);
  checkpoint('CORS allow-list');

  const demoResponse = await request(fetchImpl, `${apiUrl}/auth/demo-login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ role: 'student' }),
  });
  ensure(demoResponse.status === 403, 'demo login must be disabled in staging');
  checkpoint('demo authentication disabled');

  let sessionResponse = await request(fetchImpl, `${apiUrl}/auth/login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (sessionResponse.status === 401) {
    sessionResponse = await request(fetchImpl, `${apiUrl}/auth/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: config.email,
        password: config.password,
        name: 'Staging Smoke Student',
      }),
    });
  }
  const session = await readJson(sessionResponse, 'dedicated smoke account authentication');
  ensure(sessionResponse.ok, 'dedicated smoke account authentication must succeed');
  assertSession(session);
  checkpoint('dedicated student authentication');

  let headers = authHeaders(session.accessToken);
  const targetScore = 126;
  const currentScore = 82;
  const onboardingResponse = await request(fetchImpl, `${apiUrl}/onboarding/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      examYear: new Date().getUTCFullYear() + 1,
      targetScore,
      currentScore,
      remainingDays: 88,
      dailyHours: 3,
      weakestSubject: '计算机组成原理',
    }),
  });
  const onboarding = await readJson(onboardingResponse, 'POST /onboarding/complete');
  ensure(onboardingResponse.ok, 'onboarding must succeed');
  ensure(onboarding.sevenDayPlan?.days?.length === 7, 'onboarding must create seven plan days');
  ensure(onboarding.todayPlan?.priorityTasks?.length === 3, 'onboarding must create three priority tasks');
  checkpoint('onboarding and seven-day plan');

  const overview = await getOverview(fetchImpl, apiUrl, headers);
  ensure(overview.source === 'postgresql', 'dashboard source must be postgresql');
  ensure(overview.student?.targetScore === targetScore, 'dashboard must persist the onboarding target score');
  ensure(overview.student?.currentScore === currentScore, 'dashboard must persist the onboarding current score');

  const forbiddenResponse = await request(
    fetchImpl,
    `${apiUrl}/dashboard/overview?userId=forged-student`,
    { headers },
  );
  ensure(forbiddenResponse.status === 403, 'a student must not read another student through userId');
  checkpoint('student ownership enforcement');

  const task = overview.plan?.dailyTasks?.find((item) => !item.completed);
  ensure(Boolean(task?.id), 'today plan must contain an incomplete task');
  const questionCount = positiveInteger(task.questionCount, 8);
  const minutes = positiveInteger(task.minutes, 30);
  const taskResponse = await request(fetchImpl, `${apiUrl}/study-tasks/${encodeURIComponent(task.id)}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      completedQuestionCount: questionCount,
      correctCount: Math.max(1, Math.floor(questionCount * 0.75)),
      minutesSpent: minutes,
      selfRating: 4,
    }),
  });
  const completedTask = await readJson(taskResponse, 'POST /study-tasks/:taskId/complete');
  ensure(taskResponse.ok, 'task completion must succeed');
  ensure(completedTask.completed === true, 'task completion must return completed=true');
  checkpoint('today task completion');

  if (session.refreshToken) {
    const logoutResponse = await request(fetchImpl, `${apiUrl}/auth/logout`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    ensure(logoutResponse.ok, 'logout must succeed');
  }

  const reloginResponse = await request(fetchImpl, `${apiUrl}/auth/login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  const relogin = await readJson(reloginResponse, 'POST /auth/login after logout');
  ensure(reloginResponse.ok, 'relogin must succeed');
  assertSession(relogin);
  headers = authHeaders(relogin.accessToken);

  const restored = await getOverview(fetchImpl, apiUrl, headers);
  const restoredTask = restored.plan?.dailyTasks?.find((item) => item.id === task.id);
  ensure(restored.source === 'postgresql', 'restored dashboard source must be postgresql');
  ensure(restored.student?.targetScore === targetScore, 'target score must survive relogin');
  ensure(restoredTask?.completed === true, 'completed task must survive relogin');
  checkpoint('logout, relogin, and persisted state');

  return {
    ok: true,
    dataSource: restored.source,
    persistedTargetScore: restored.student.targetScore,
    persistedCompletedTaskId: restoredTask.id,
    checks: 8,
  };
}

async function verifyCors(fetchImpl, apiUrl, webOrigin) {
  const allowed = await request(fetchImpl, `${apiUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: webOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  ensure(allowed.status === 204, 'allowed CORS preflight must return 204');
  ensure(allowed.headers.get('access-control-allow-origin') === webOrigin, 'allowed CORS origin must be echoed');

  const denied = await request(fetchImpl, `${apiUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.invalid',
      'Access-Control-Request-Method': 'GET',
    },
  });
  ensure(!denied.headers.get('access-control-allow-origin'), 'untrusted CORS origin must not be allowed');
}

async function getOverview(fetchImpl, apiUrl, headers) {
  const response = await request(fetchImpl, `${apiUrl}/dashboard/overview`, { headers });
  const overview = await readJson(response, 'GET /dashboard/overview');
  ensure(response.ok, 'dashboard overview must succeed');
  return overview;
}

async function request(fetchImpl, url, init = {}) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    throw new Error(`${method} ${path} could not be reached: ${error instanceof Error ? error.name : 'network error'}`);
  }
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned a non-JSON response with status ${response.status}`);
  }
}

function assertSession(session) {
  ensure(Boolean(session?.accessToken), 'authentication response must include an access token');
  ensure(session.user?.role === 'student', 'smoke account must have the student role');
}

function authHeaders(token) {
  return jsonHeaders({ Authorization: `Bearer ${token}` });
}

function jsonHeaders(extra = {}) {
  return { 'content-type': 'application/json; charset=utf-8', ...extra };
}

function parseUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or a fragment`);
  }
  return parsed;
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const result = await runStagingSmoke(readStagingSmokeConfig());
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('staging-smoke.mjs')) {
  main().catch((error) => {
    console.error(`[staging-smoke] FAIL ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
