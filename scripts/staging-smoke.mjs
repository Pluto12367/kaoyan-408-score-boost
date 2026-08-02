const defaultOrigin = 'https://pluto12367.github.io';

export function readStagingSmokeConfig(env = process.env) {
  const apiUrl = required(env.STAGING_API_URL, 'STAGING_API_URL');
  const email = required(env.STAGING_SMOKE_EMAIL, 'STAGING_SMOKE_EMAIL');
  const password = required(env.STAGING_SMOKE_PASSWORD, 'STAGING_SMOKE_PASSWORD');
  const invitationCode = required(env.STAGING_SMOKE_INVITATION, 'STAGING_SMOKE_INVITATION');
  const adminEmail = required(env.STAGING_ADMIN_EMAIL, 'STAGING_ADMIN_EMAIL');
  const adminPassword = required(env.STAGING_ADMIN_PASSWORD, 'STAGING_ADMIN_PASSWORD');
  const webOrigin = (env.STAGING_WEB_ORIGIN || defaultOrigin).trim();

  const parsedApiUrl = parseUrl(apiUrl, 'STAGING_API_URL');
  const parsedWebOrigin = parseUrl(webOrigin, 'STAGING_WEB_ORIGIN');
  if (parsedApiUrl.protocol !== 'https:') throw new Error('STAGING_API_URL must use HTTPS');
  if (parsedWebOrigin.protocol !== 'https:') throw new Error('STAGING_WEB_ORIGIN must use HTTPS');
  if (password.length < 12) throw new Error('STAGING_SMOKE_PASSWORD must contain at least 12 characters');
  if (adminPassword.length < 12) throw new Error('STAGING_ADMIN_PASSWORD must contain at least 12 characters');

  return {
    apiUrl: trimTrailingSlash(parsedApiUrl.href),
    webOrigin: trimTrailingSlash(parsedWebOrigin.href),
    email: email.toLowerCase(),
    password,
    invitationCode,
    adminEmail: adminEmail.toLowerCase(),
    adminPassword,
  };
}

export async function runQuestionImportSmoke(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.log;
  const apiUrl = trimTrailingSlash(config.apiUrl);
  const checkpoint = (message) => log(`[staging-smoke] PASS question import: ${message}`);
  const unauthenticated = await request(fetchImpl, `${apiUrl}/admin/question-imports`, {
    method: 'POST', body: generatedQuestionCsv(),
  });
  ensure([401, 403].includes(unauthenticated.status), 'question-import upload must reject unauthenticated callers');
  checkpoint('unauthenticated upload rejection');

  const adminSession = await readJson(await request(fetchImpl, `${apiUrl}/auth/login`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
  }), 'administrator authentication');
  ensure(adminSession?.accessToken && adminSession.user?.role === 'admin', 'question-import smoke requires an administrator account');
  const headers = { Authorization: `Bearer ${adminSession.accessToken}` };
  const upload = await readJson(await request(fetchImpl, `${apiUrl}/admin/question-imports`, {
    method: 'POST', headers, body: generatedQuestionCsv(),
  }), 'question-import CSV upload');
  ensure(Boolean(upload.batchId), 'question-import upload must return batchId');
  checkpoint('generated CSV upload');

  const batch = await getImportBatch(fetchImpl, apiUrl, headers, upload.batchId);
  ensure(['review', 'parsing_partial_failure'].includes(batch.status), 'fake-provider batch must be ready for review or have a controlled partial failure');
  const failedJob = batch.jobs?.find((job) => job.state === 'failed');
  if (failedJob) {
    const retry = await readJson(await request(fetchImpl, `${apiUrl}/admin/question-imports/${encodeURIComponent(upload.batchId)}/retry`, {
      method: 'POST', headers: jsonHeaders(headers), body: JSON.stringify({ jobIds: [failedJob.id] }),
    }), 'failed import job retry');
    ensure(retry.retriedJobs === 1, 'failed import job must be restartable');
    checkpoint('failed page retry');
  }

  const candidates = await listImportCandidates(fetchImpl, apiUrl, headers, upload.batchId);
  ensure(candidates.length >= 2, 'fake provider smoke fixture must yield duplicate and version candidates');
  const duplicate = candidates.find((candidate) => candidate.duplicateAction === 'skip') ?? candidates[0];
  const version = candidates.find((candidate) => candidate.duplicateAction === 'new_version' && candidate.targetFamilyId) ?? candidates[1];
  await updateCandidate(fetchImpl, apiUrl, headers, duplicate, { status: 'approved', duplicateAction: 'skip' });
  await updateCandidate(fetchImpl, apiUrl, headers, version, { status: 'approved', duplicateAction: 'new_version', targetFamilyId: version.targetFamilyId });
  checkpoint('candidate edit, duplicate skip, and version selection');

  const idempotencyKey = `staging-smoke-${randomId()}`;
  const confirmation = await confirmCandidates(fetchImpl, apiUrl, headers, upload.batchId, [duplicate.id, version.id], idempotencyKey);
  const replay = await confirmCandidates(fetchImpl, apiUrl, headers, upload.batchId, [duplicate.id, version.id], idempotencyKey);
  ensure(JSON.stringify(replay) === JSON.stringify(confirmation), 'repeated confirmation must replay the original result');
  ensure((confirmation.skippedCandidateIds ?? []).includes(duplicate.id), 'duplicate skip must remain skipped after confirmation');
  ensure((confirmation.questionIds ?? []).length > 0, 'new-version confirmation must create a current question');
  checkpoint('partial confirmation, repeated confirm, and current-question visibility');
  return { ok: true, batchId: upload.batchId, importedQuestionId: confirmation.questionIds[0], checks: failedJob ? 7 : 6 };
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
    const rejectedRegistration = await request(fetchImpl, `${apiUrl}/auth/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: config.email,
        password: config.password,
        name: 'Staging Smoke Student',
      }),
    });
    ensure(rejectedRegistration.status === 400, 'registration without invitation must be rejected');
    checkpoint('registration rejects missing invitation');

    sessionResponse = await request(fetchImpl, `${apiUrl}/auth/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        inviteCode: config.invitationCode,
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
    checks: 10,
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

async function getImportBatch(fetchImpl, apiUrl, headers, batchId) {
  return readJson(await request(fetchImpl, `${apiUrl}/admin/question-imports/${encodeURIComponent(batchId)}`, { headers }), 'question-import batch detail');
}

async function listImportCandidates(fetchImpl, apiUrl, headers, batchId) {
  const response = await request(fetchImpl, `${apiUrl}/admin/question-imports/${encodeURIComponent(batchId)}/candidates?page=1&pageSize=100`, { headers });
  const body = await readJson(response, 'question-import candidate list');
  ensure(response.ok, 'question-import candidate list must succeed');
  return body.items ?? [];
}

async function updateCandidate(fetchImpl, apiUrl, headers, candidate, patch) {
  const response = await request(fetchImpl, `${apiUrl}/admin/question-imports/candidates/${encodeURIComponent(candidate.id)}`, {
    method: 'PATCH', headers: jsonHeaders(headers), body: JSON.stringify({ revision: candidate.revision, patch }),
  });
  ensure(response.ok, 'question-import candidate edit must succeed');
  return readJson(response, 'question-import candidate edit');
}

async function confirmCandidates(fetchImpl, apiUrl, headers, batchId, candidateIds, idempotencyKey) {
  const response = await request(fetchImpl, `${apiUrl}/admin/question-imports/${encodeURIComponent(batchId)}/confirm`, {
    method: 'POST', headers: jsonHeaders(headers), body: JSON.stringify({ candidateIds, idempotencyKey }),
  });
  ensure(response.ok, 'question-import confirmation must succeed');
  return readJson(response, 'question-import confirmation');
}

function generatedQuestionCsv() {
  const form = new FormData();
  form.append('file', new Blob(['科目,章节,知识点,题型,难度,题干,选项 A,选项 B,正确答案,答案解析,来源\n操作系统,进程管理,进程同步,选择题,基础,测试题,A,B,A,测试解析,staging smoke'], { type: 'text/csv' }), 'staging-question-import.csv');
  form.append('source', 'staging smoke generated CSV');
  form.append('rightsConfirmed', 'true');
  return form;
}

function randomId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

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
  if (!process.env.STAGING_API_URL) {
    console.log(JSON.stringify({ ok: true, mode: 'not-run', reason: 'STAGING_API_URL is unset; live staging smoke was not attempted' }, null, 2));
    return;
  }
  const config = readStagingSmokeConfig();
  const result = { ...(await runStagingSmoke(config)), questionImport: await runQuestionImportSmoke(config) };
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('staging-smoke.mjs')) {
  main().catch((error) => {
    console.error(`[staging-smoke] FAIL ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
