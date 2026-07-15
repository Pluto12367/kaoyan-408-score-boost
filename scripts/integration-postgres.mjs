import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3200';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let activeApi;

async function main() {
  await prepareLegacyFeedbackMigrationFixture();
  const schemaResult = spawnSync(npx, [
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (schemaResult.status !== 0) {
    throw new Error(`Prisma migration deploy failed: ${schemaResult.error?.message || schemaResult.stderr || schemaResult.stdout}`);
  }

  const migrationPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const migratedLegacyFeedback = await migrationPrisma.$queryRawUnsafe(
    'SELECT "id", "scene", "message", "createdAt" FROM "FeedbackSubmission" WHERE "id" LIKE $1 ORDER BY "id"',
    'feedback-legacy-fixture-%',
  );
  await migrationPrisma.$disconnect();
  const migratedShortFeedback = migratedLegacyFeedback.find((item) => item.id === 'feedback-legacy-fixture-short');
  assert(migratedShortFeedback?.message === '短反馈', 'migration should retain legacy feedback with 1 to 9 characters');
  assert(migratedShortFeedback?.scene === 'overall', 'migration should map unknown legacy scenes to overall');
  assert(
    migratedShortFeedback?.createdAt.toISOString() === '2026-07-01T01:02:03.000Z',
    'migration should preserve a valid legacy createdAt timestamp',
  );
  const migratedInvalidDateFeedback = migratedLegacyFeedback.find((item) => item.id === 'feedback-legacy-fixture-invalid-date');
  assert(
    migratedInvalidDateFeedback?.createdAt instanceof Date && !Number.isNaN(migratedInvalidDateFeedback.createdAt.getTime()),
    'migration should fall back safely for an invalid legacy createdAt timestamp',
  );

  activeApi = startApi();
  await waitForHealth(activeApi);

  const credentials = {
    email: `integration.student.${Date.now()}@example.com`,
    password: 'ReliableTestPassword!408',
    name: '集成测试学生',
  };
  const registered = await postJson(`${apiUrl}/auth/register`, credentials);
  assert(registered.user.email === undefined && registered.user.role === 'student', 'registration should return a safe student profile');
  assert(registered.accessToken && registered.refreshToken, 'registration should issue access and refresh tokens');
  const loggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(loggedIn.user.id === registered.user.id, 'password login should return the registered user');
  let studentHeaders = { Authorization: `Bearer ${loggedIn.accessToken}` };
  let initial = await waitForOverview(studentHeaders);
  assert(initial.source === 'postgresql', 'API should report the real PostgreSQL data source');
  assert(initial.student.id === registered.user.id && initial.student.name === credentials.name, 'dashboard should use the authenticated student identity');
  assert(initial.student.targetSchool === undefined, 'new student must not inherit another student\'s target school');
  const onboardingBefore = await getJson(`${apiUrl}/onboarding/status`, studentHeaders);
  assert(onboardingBefore.completed === false, 'new student should require onboarding');
  const onboarding = await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: new Date().getUTCFullYear() + 1,
    targetScore: 126,
    currentScore: 82,
    remainingDays: 88,
    dailyHours: 3,
    weakestSubject: '计算机组成原理',
  }, studentHeaders);
  assert(onboarding.sevenDayPlan.days.length === 7, 'onboarding should create a seven-day plan');
  assert(onboarding.todayPlan.priorityTasks.length === 3, 'onboarding should return three actionable tasks for today');
  initial = await waitForOverview(studentHeaders, (data) => data.student?.targetScore === 126 && data.plan?.dailyTasks?.length === 3);
  assert(initial.student.name === credentials.name, 'onboarding must preserve the authenticated student identity');
  await expectGetStatus(`${apiUrl}/wrong-questions?userId=u-001`, studentHeaders, 403);
  await expectPostStatus(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'A',
    correct: false,
    timeSpentSec: 30,
    expectedTimeSec: 100,
  }, 403, studentHeaders);
  await expectPostStatus(`${apiUrl}/auth/login`, { email: credentials.email, password: 'wrong-password' }, 401);
  await expectGetStatus(`${apiUrl}/teacher/questions`, { Authorization: `Bearer ${loggedIn.accessToken}` }, 403);
  await expectPostStatus(`${apiUrl}/questions`, {
    stem: 'student should not create this question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: 'forbidden',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: 'forbidden',
  }, 403, { Authorization: `Bearer ${loggedIn.accessToken}` });
  const teacherSession = await postJson(`${apiUrl}/auth/demo-login`, { role: 'teacher' });
  const teacherHeaders = { Authorization: `Bearer ${teacherSession.token}` };
  await expectGetStatus(`${apiUrl}/dashboard/overview?userId=${registered.user.id}`, teacherHeaders, 403);
  const teacherQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'integration teacher protected write question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: 'teacher can create questions',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: 'integration',
  }, { Authorization: `Bearer ${teacherSession.token}` });
  assert(teacherQuestion.id, 'teacher role should create questions');
  const subjectiveQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'Explain the key steps of direct-mapped cache address decomposition.',
    options: ['subjective response', 'self assessment'],
    answer: 'Address is split into tag, line index, and block offset.',
    analysis: 'Scoring points: identify tag, line index, block offset, and explain the mapping rule.',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '综合题',
    source: 'integration subjective',
  }, { Authorization: `Bearer ${teacherSession.token}` });
  assert(subjectiveQuestion.type === '综合题', 'teacher should create a comprehensive question for self assessment');
  const preparedMockPaper = await postJson(`${apiUrl}/exam/papers/prepare`, {
    paperType: '模拟卷',
    questionCount: 4,
    createdBy: 'forged-owner',
  }, studentHeaders);
  assert(preparedMockPaper.paperType === '模拟卷' && preparedMockPaper.questionCount > 0, 'student should prepare a full mock paper from the available bank');
  assert(preparedMockPaper.createdBy === registered.user.id, 'prepared exam must use the authenticated student as its owner');
  const preparedSpecialPaper = await postJson(`${apiUrl}/exam/papers/prepare`, {
    paperType: '专项卷',
    subject: '计算机组成原理',
    questionCount: 10,
  }, studentHeaders);
  assert(preparedSpecialPaper.paperType === '专项卷' && preparedSpecialPaper.title.includes('计算机组成原理'), 'student should prepare a subject-specific paper');
  await expectPostStatus(`${apiUrl}/exam/papers/prepare`, {
    paperType: '专项卷',
    questionCount: 10,
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/exam/papers/prepare`, {
    paperType: '伪造试卷类型',
    questionCount: 10,
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/exam/papers/prepare`, {
    paperType: '模拟卷',
    questionCount: 2.5,
  }, 400, studentHeaders);
  const generatedPaper = await postJson(`${apiUrl}/papers/generate`, {
    title: 'PostgreSQL restart paper',
    paperType: '专项卷',
    knowledgePointIds: ['co-cache'],
    questionCount: 2,
    createdBy: teacherSession.user.id,
  }, { Authorization: `Bearer ${teacherSession.token}` });
  const submittedPaper = await postJson(`${apiUrl}/papers/${generatedPaper.id}/submit`, {
    answers: generatedPaper.questions.map((question) => ({
      questionId: question.id,
      selectedAnswer: question.answer,
      timeSpentSec: question.expectedTimeSec,
    })),
  }, studentHeaders);
  assert(submittedPaper.paperId === generatedPaper.id, 'generated paper should be submittable');
  await expectPostStatus(`${apiUrl}/feedback`, null, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 0,
    scene: 'overall',
    message: 'rating below the supported range',
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 4.5,
    scene: 'overall',
    message: 'rating must be an integer value',
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'overall',
    message: 'too short',
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'unsupported-scene',
    message: 'unsupported feedback scene should be rejected',
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'overall',
    message: { text: 'feedback must be plain text' },
  }, 400, studentHeaders);
  const unicodeFeedback = await postJson(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'overall',
    message: '😀'.repeat(1000),
  }, studentHeaders);
  assert(Array.from(unicodeFeedback.message).length === 1000, 'feedback length should count Unicode code points');
  await expectPostStatus(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'overall',
    message: '😀'.repeat(1001),
  }, 400, studentHeaders);
  const feedback = await postJson(`${apiUrl}/feedback`, {
    rating: 5,
    scene: 'overall',
    message: '  verify feedback persistence across restart  ',
    surveyUrl: 'https://attacker.example/overridden-survey',
  }, studentHeaders);
  assert(feedback.id, 'student feedback should be accepted');
  assert(feedback.message === 'verify feedback persistence across restart', 'feedback message should be trimmed');
  assert(feedback.surveyUrl === 'https://wj.qq.com/s2/27160624/40fe/', 'feedback response should use the official survey URL');
  await expectGetStatus(`${apiUrl}/admin/feedback`, studentHeaders, 403);
  await expectGetStatus(`${apiUrl}/admin/feedback`, {}, 401);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const persistedFeedbackRows = await prisma.$queryRawUnsafe(
    'SELECT "id", "userId", "rating", "scene", "message", "status" FROM "FeedbackSubmission" WHERE "id" = $1',
    feedback.id,
  );
  assert(persistedFeedbackRows.length === 1, 'feedback should be written to its dedicated PostgreSQL table');
  assert(persistedFeedbackRows[0].userId === registered.user.id, 'persisted feedback should belong to the authenticated user');
  assert(persistedFeedbackRows[0].rating === 5 && persistedFeedbackRows[0].scene === 'overall', 'persisted feedback should retain structured fields');
  assert(persistedFeedbackRows[0].message === feedback.message && persistedFeedbackRows[0].status === 'new', 'persisted feedback should retain normalized content and status');
  const externalCredentials = {
    email: `external.feedback.${Date.now()}@example.com`,
    password: 'ExternalFeedbackPassword!408',
    name: '外部反馈测试学生',
  };
  const externalStudent = await postJson(`${apiUrl}/auth/register`, externalCredentials);
  const externalStudentHeaders = { Authorization: `Bearer ${externalStudent.accessToken}` };
  await prisma.feedbackSubmission.create({
    data: {
      userId: externalStudent.user.id,
      rating: 4,
      scene: 'overall',
      message: 'feedback inserted outside the running API process',
      status: 'new',
    },
  });
  const externalTrialProgress = await getJson(`${apiUrl}/trial-progress`, externalStudentHeaders);
  assert(
    externalTrialProgress.items.some((item) => item.id === 'feedback' && item.completed),
    'trial progress should see feedback inserted outside the running API process',
  );
  await expectDatabaseRejection(() => prisma.feedbackSubmission.create({
    data: { userId: externalStudent.user.id, rating: 0, scene: 'overall', message: 'invalid database rating', status: 'new' },
  }), 'database should reject feedback ratings outside 1 to 5');
  await expectDatabaseRejection(() => prisma.feedbackSubmission.create({
    data: { userId: externalStudent.user.id, rating: 5, scene: 'other', message: 'invalid database scene', status: 'new' },
  }), 'database should reject unsupported feedback scenes');
  await expectDatabaseRejection(() => prisma.feedbackSubmission.create({
    data: { userId: externalStudent.user.id, rating: 5, scene: 'overall', message: 'invalid database status', status: 'pending' },
  }), 'database should reject unsupported feedback statuses');
  await expectDatabaseRejection(() => prisma.feedbackSubmission.create({
    data: { userId: externalStudent.user.id, rating: 5, scene: 'overall', message: '', status: 'new' },
  }), 'database should reject an empty feedback message');
  await expectDatabaseRejection(() => prisma.feedbackSubmission.create({
    data: { userId: externalStudent.user.id, rating: 5, scene: 'overall', message: 'a'.repeat(1001), status: 'new' },
  }), 'database should reject feedback messages longer than 1000 characters');
  await prisma.$disconnect();
  const adminSession = await postJson(`${apiUrl}/auth/demo-login`, { role: 'admin' });
  const adminHeaders = { Authorization: `Bearer ${adminSession.token}` };
  const adminUsers = await getJson(`${apiUrl}/admin/users`, adminHeaders);
  const registeredAdminUser = adminUsers.users.find((user) => user.id === registered.user.id);
  assert(adminUsers.source === 'postgresql', 'admin user management should report the real PostgreSQL source');
  assert(registeredAdminUser?.name === credentials.name, 'admin user management should list the real registered student');
  assert(registeredAdminUser?.trialStatus === 'active', 'completing onboarding should activate the student trial');
  assert(adminUsers.users.some((user) => user.id === teacherSession.user.id && user.role === 'teacher' && user.trialStatus === 'active'), 'admin user management should list active teacher accounts');
  assert(adminUsers.users.some((user) => user.id === adminSession.user.id && user.role === 'admin' && user.trialStatus === 'active'), 'admin user management should list active administrator accounts');
  const followUpUser = await postJson(`${apiUrl}/admin/users/${registered.user.id}/trial-status`, {
    trialStatus: 'follow_up',
  }, adminHeaders);
  assert(followUpUser.trialStatus === 'follow_up', 'admin should persist a student trial follow-up status');
  await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: new Date().getUTCFullYear() + 1,
    targetScore: 126,
    currentScore: 82,
    remainingDays: 88,
    dailyHours: 3,
    weakestSubject: '计算机组成原理',
  }, studentHeaders);
  const adminUsersAfterRepeatedOnboarding = await getJson(`${apiUrl}/admin/users`, adminHeaders);
  assert(
    adminUsersAfterRepeatedOnboarding.users.find((user) => user.id === registered.user.id)?.trialStatus === 'follow_up',
    'repeating onboarding must not overwrite an administrator-managed trial status',
  );
  await expectPostStatus(`${apiUrl}/admin/users/${registered.user.id}/trial-status`, {
    trialStatus: 'completed',
  }, 403, studentHeaders);
  await expectPostStatus(`${apiUrl}/admin/teacher-authorizations`, {
    teacherId: teacherSession.user.id,
    studentId: registered.user.id,
  }, 403, studentHeaders);
  await expectPostStatus(`${apiUrl}/admin/teacher-authorizations`, {
    teacherId: adminSession.user.id,
    studentId: registered.user.id,
  }, 400, adminHeaders);
  const grantedAuthorization = await postJson(`${apiUrl}/admin/teacher-authorizations`, {
    teacherId: teacherSession.user.id,
    studentId: registered.user.id,
  }, adminHeaders);
  assert(grantedAuthorization.studentName === credentials.name, 'admin should grant a teacher access to the selected student');
  const authorizedOverview = await getJson(`${apiUrl}/dashboard/overview?userId=${registered.user.id}`, teacherHeaders);
  assert(authorizedOverview.student.name === credentials.name, 'authorized teacher should see the selected student profile');
  const authorizationList = await getJson(`${apiUrl}/admin/teacher-authorizations?teacherId=${teacherSession.user.id}`, adminHeaders);
  assert(authorizationList.items.some((item) => item.studentId === registered.user.id), 'admin should list persisted teacher-student authorizations');
  const authorizedClass = await getJson(`${apiUrl}/teacher/class-analytics`, teacherHeaders);
  const authorizedStudentIds = new Set(authorizationList.items.map((item) => item.studentId));
  assert(authorizedClass.atRiskStudents.some((item) => item.userId === registered.user.id), 'teacher analytics should include the newly authorized student');
  assert(authorizedClass.atRiskStudents.every((item) => authorizedStudentIds.has(item.userId)), 'teacher analytics must only include authorized students');
  const revokedAuthorization = await deleteJson(`${apiUrl}/admin/teacher-authorizations/${teacherSession.user.id}/${registered.user.id}`, adminHeaders);
  assert(revokedAuthorization.revoked === true, 'admin should revoke teacher access');
  await expectGetStatus(`${apiUrl}/dashboard/overview?userId=${registered.user.id}`, teacherHeaders, 403);
  await postJson(`${apiUrl}/admin/teacher-authorizations`, {
    teacherId: teacherSession.user.id,
    studentId: registered.user.id,
  }, adminHeaders);
  const config = await postJson(`${apiUrl}/admin/system-config`, {
    recommendation: { stageAssessmentQuestionLimit: 2 },
  }, { Authorization: `Bearer ${adminSession.token}` });
  assert(config.recommendation.stageAssessmentQuestionLimit === 2, 'admin role should update system configuration');
  const refreshed = await postJson(`${apiUrl}/auth/refresh`, { refreshToken: loggedIn.refreshToken });
  assert(refreshed.refreshToken !== loggedIn.refreshToken, 'refresh should rotate the refresh token');
  await expectPostStatus(`${apiUrl}/auth/refresh`, { refreshToken: loggedIn.refreshToken }, 401);
  await postJson(`${apiUrl}/auth/logout`, { refreshToken: refreshed.refreshToken });
  await expectPostStatus(`${apiUrl}/auth/refresh`, { refreshToken: refreshed.refreshToken }, 401);

  const created = await postJson(`${apiUrl}/practice-records`, {
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'integration-test-wrong-answer',
    timeSpentSec: 137,
  }, studentHeaders);
  assert(created.id && created.correct === false && created.userId === registered.user.id, 'practice submission without userId should use the authenticated student');
  await expectPostStatus(`${apiUrl}/practice-records`, {
    userId: 'u-001',
    questionId: 'q-002',
    knowledgePointId: 'net-tcp',
    selectedAnswer: 'A',
    timeSpentSec: 88,
  }, 403, studentHeaders);

  const reviewed = await postJson(`${apiUrl}/wrong-questions/q-001/review`, { userId: registered.user.id }, studentHeaders);
  assert(reviewed.reviewStatus === 'reviewed' && reviewed.reviewedAt, 'wrong-question review should be persisted');

  const autoScheduledDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(autoScheduledDetail.reviewSchedule?.stability === 'learning', 'first wrong answer should enter the review schedule automatically');
  assert(autoScheduledDetail.reviewSchedule?.reviewCount === 0, 'automatic scheduling should not count as a completed review');
  await expectPostStatus(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: ' ', redoCorrect: false, timeSpentSec: 137, isReview: false,
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear', redoCorrect: false, timeSpentSec: -1, isReview: false,
  }, 400, studentHeaders);
  const initialReason = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: false,
    timeSpentSec: 137,
    isReview: false,
  }, studentHeaders);
  assert(initialReason.reviewCount === 0 && initialReason.nextReviewInDays === 1, 'initial mistake classification should keep the next-day schedule without counting a review');
  const detailAfterInitialReason = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(detailAfterInitialReason.reviewHistory.length === 0, 'initial mistake classification should not create a redo history item');
  assert(detailAfterInitialReason.reviewSchedule.selfReportedReason === 'concept unclear', 'initial self-reported reason should be retained');
  const savedNote = await patchJson(`${apiUrl}/wrong-questions/q-001/note`, {
    note: 'Cache mapping: check block number modulo line count before choosing.',
  }, studentHeaders);
  assert(savedNote.note.includes('Cache mapping'), 'wrong-question note should be saved');
  const failedRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: false,
    timeSpentSec: 145,
  }, studentHeaders);
  assert(failedRedo.nextReviewInDays === 1 && failedRedo.stability === 'learning', 'failed redo should return to a one-day interval');
  const firstCorrectRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 95,
  }, studentHeaders);
  assert(firstCorrectRedo.nextReviewInDays === 3 && firstCorrectRedo.consecutiveCorrect === 1, 'first correct redo should advance to three days');
  const secondCorrectRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 82,
  }, studentHeaders);
  assert(secondCorrectRedo.nextReviewInDays === 7 && secondCorrectRedo.consecutiveCorrect === 2, 'second correct redo should advance to seven days');
  const masteredRedo = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: 'concept unclear',
    redoCorrect: true,
    timeSpentSec: 76,
  }, studentHeaders);
  assert(masteredRedo.nextReviewInDays === 14 && masteredRedo.stability === 'mastered', 'third correct redo should reach stable mastery with a fourteen-day interval');

  const todayPlanBeforeTask = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  const taskId = todayPlanBeforeTask.priorityTasks?.[0]?.id;
  assert(taskId, 'dashboard should expose a study task for completion testing');
  const taskKnowledgePointId = todayPlanBeforeTask.priorityTasks[0].knowledgePointId;
  const masteryBeforeTask = await getJson(`${apiUrl}/mastery-map`, studentHeaders);
  const masteryPointBefore = masteryBeforeTask.subjects.flatMap((subject) => subject.points).find((point) => point.knowledgePointId === taskKnowledgePointId);
  const startedTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(taskId)}/start`, {}, studentHeaders);
  assert(startedTask.status === 'in_progress' && startedTask.startedAt, 'today task should enter an in-progress state');
  await expectPostStatus(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {}, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    completedQuestionCount: 5,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  }, 400, studentHeaders);
  const completedTask = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(taskId)}/complete`, {
    userId: registered.user.id,
    completedQuestionCount: 8,
    correctCount: 6,
    minutesSpent: 24,
    selfRating: 4,
  }, studentHeaders);
  assert(completedTask.completed === true, 'study-task completion should be persisted');
  assert(completedTask.nextDayAdjustment?.scheduledDate, 'task completion should adjust the next matching task');
  const masteryAfterTask = await getJson(`${apiUrl}/mastery-map`, studentHeaders);
  const masteryPointAfter = masteryAfterTask.subjects.flatMap((subject) => subject.points).find((point) => point.knowledgePointId === taskKnowledgePointId);
  assert(masteryPointAfter.practiceCount > masteryPointBefore.practiceCount, 'task quality should update mastery evidence');
  const postponeTaskId = todayPlanBeforeTask.priorityTasks.find((task) => task.id !== taskId)?.id;
  assert(postponeTaskId, 'dashboard should expose another task for postponement testing');
  const postponedTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(postponeTaskId)}/postpone`, {}, studentHeaders);
  assert(postponedTask.taskId === postponeTaskId && postponedTask.rescheduledDate, 'study-task postponement should automatically reschedule the task');
  const todayPlanAfterPostpone = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(!todayPlanAfterPostpone.priorityTasks.some((task) => task.id === postponeTaskId), 'rescheduled task should leave today plan');

  await expectPostStatus(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-invalid-exam',
    questionIds: ['question-outside-bank'],
  }, 400, studentHeaders);
  const sessionInput = {
    type: 'paper',
    resourceId: 'integration-traceable-exam',
    questionIds: ['q-001', subjectiveQuestion.id],
  };
  const startedSession = await postJson(`${apiUrl}/sessions/practice/start`, sessionInput, studentHeaders);
  const idempotentSession = await postJson(`${apiUrl}/sessions/practice/start`, sessionInput, studentHeaders);
  assert(idempotentSession.id === startedSession.id, 'starting the same active resource should be idempotent');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    answers: { 'question-outside-session': { selectedAnswer: 'A', timeSpentSec: 10 } },
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    currentIndex: 9,
  }, 400, studentHeaders);
  const savedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    answers: { 'q-001': { selectedAnswer: 'A', timeSpentSec: 73 } },
    currentIndex: 1,
    markedQuestions: [subjectiveQuestion.id],
    totalActiveMs: 1250,
  }, studentHeaders);
  assert(savedSession.currentIndex === 1 && savedSession.markedQuestions.includes(subjectiveQuestion.id), 'session progress should be saved');

  const partialExamSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-partial-exam',
    questionIds: ['q-001', subjectiveQuestion.id],
  }, studentHeaders);
  const partialSavedSession = await postJson(`${apiUrl}/sessions/practice/${partialExamSession.id}/save`, {
    answers: {
      'q-001': { selectedAnswer: 'B', timeSpentSec: 60 },
      [subjectiveQuestion.id]: { selectedAnswer: '', timeSpentSec: 20 },
    },
    currentIndex: 1,
    totalActiveMs: 80_000,
  }, studentHeaders);
  assert(partialSavedSession.answeredCount === 1 && partialSavedSession.progressRate === 50, 'blank comprehensive answers must remain unanswered');
  await postJson(`${apiUrl}/sessions/practice/${partialExamSession.id}/submit`, {
    answers: [
      { questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 60 },
      { questionId: subjectiveQuestion.id, selectedAnswer: '', timeSpentSec: 20 },
    ],
    totalActiveMs: 80_000,
  }, studentHeaders);
  const partialExamReport = await getJson(`${apiUrl}/exam/report/${partialExamSession.id}`, studentHeaders);
  assert(partialExamReport.summary.answeredCount === 1 && partialExamReport.summary.unansweredCount === 1, 'blank comprehensive answer should be traceable as unanswered');
  assert(partialExamReport.summary.subjectiveQuestionCount === 1, 'report should count unanswered comprehensive questions in the paper structure');
  assert(partialExamReport.subjectBreakdown.reduce((sum, item) => sum + item.totalQuestions, 0) === 2, 'subject breakdown should cover the whole paper including unanswered questions');
  assert(partialExamReport.knowledgePointLosses.some((item) => item.title), 'unanswered questions should contribute to knowledge-point losses');

  const recommendedPracticeSet = await getJson(`${apiUrl}/practice-sets/recommended`, studentHeaders);
  const practiceSessionQuestions = recommendedPracticeSet.questions.slice(0, Math.min(2, recommendedPracticeSet.questions.length));
  assert(practiceSessionQuestions.length > 0, 'recommended practice set should contain resumable questions');
  const practiceSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'practice_set',
    resourceId: recommendedPracticeSet.id,
    questionIds: practiceSessionQuestions.map((question) => question.id),
  }, studentHeaders);
  await postJson(`${apiUrl}/sessions/practice/${practiceSession.id}/save`, {
    answers: {
      [practiceSessionQuestions[0].id]: sessionAnswerFor(practiceSessionQuestions[0], 61),
    },
    currentIndex: Math.min(1, practiceSessionQuestions.length - 1),
    markedQuestions: [practiceSessionQuestions[0].id],
    totalActiveMs: 2100,
  }, studentHeaders);

  const stageAssessment = await getJson(`${apiUrl}/assessments/stage`, studentHeaders);
  const stageSessionQuestions = stageAssessment.questions.slice(0, Math.min(2, stageAssessment.questions.length));
  assert(stageSessionQuestions.length > 0, 'stage assessment should contain resumable questions');
  const stageSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'stage_assessment',
    resourceId: stageAssessment.id,
    questionIds: stageSessionQuestions.map((question) => question.id),
  }, studentHeaders);
  await postJson(`${apiUrl}/sessions/practice/${stageSession.id}/save`, {
    answers: {
      [stageSessionQuestions[0].id]: sessionAnswerFor(stageSessionQuestions[0], 79),
    },
    currentIndex: Math.min(1, stageSessionQuestions.length - 1),
    totalActiveMs: 3300,
  }, studentHeaders);
  await expectGetStatus(`${apiUrl}/sessions/practice/${startedSession.id}`, { Authorization: `Bearer ${teacherSession.token}` }, 403);

  await stop(activeApi);
  activeApi = startApi();
  await waitForHealth(activeApi);
  const reloggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(reloggedIn.user.id === registered.user.id, 'student should log in again after an API restart');
  studentHeaders = { Authorization: `Bearer ${reloggedIn.accessToken}` };
  const restored = await waitForOverview(studentHeaders, (data) =>
    data.practiceRecords?.some((record) => record.id === created.id)
      && data.plan?.dailyTasks?.some((task) => task.id === taskId && task.completed)
      && data.student?.targetScore === 126
      && data.questions?.some((question) => question.id === teacherQuestion.id),
  );
  const restoredRecord = restored.practiceRecords.find((record) => record.id === created.id);
  assert(restoredRecord.timeSpentSec === 137, 'record should survive an API restart');
  const restoredWrongDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(restoredWrongDetail.note === savedNote.note, 'wrong-question note should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.stability === 'mastered', 'review mastery should survive an API restart');
  assert(restoredWrongDetail.reviewHistory?.length === 4, 'complete review trajectory should survive an API restart');
  assert(restoredWrongDetail.reviewHistory[0].nextIntervalDays === 1, 'review history should retain interval decisions');
  assert(restoredWrongDetail.reviewHistory.at(-1)?.reviewedAt === masteredRedo.lastReviewedAt, 'latest wrong-question review timestamp should survive an API restart');
  const restoredTask = restored.plan.dailyTasks.find((task) => task.id === taskId);
  assert(restoredTask.completed === true, 'study-task completion should survive an API restart');
  const restoredOnboarding = await getJson(`${apiUrl}/onboarding/status`, studentHeaders);
  assert(restoredOnboarding.completed === true && restoredOnboarding.profile.examYear, 'onboarding profile should survive an API restart');
  const restoredTodayPlan = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(restoredTodayPlan.weekProgress.length === 7, 'seven-day plan should survive an API restart');
  assert(!restoredTodayPlan.priorityTasks.some((task) => task.id === postponeTaskId), 'task rescheduling should survive an API restart');
  const restoredSession = await getJson(`${apiUrl}/sessions/practice/${startedSession.id}`, studentHeaders);
  assert(restoredSession.answers['q-001']?.selectedAnswer === 'A', 'saved answer should survive an API restart');
  assert(restoredSession.currentIndex === 1, 'current question should survive an API restart');
  assert(restoredSession.markedQuestions.includes(subjectiveQuestion.id), 'marked question should survive an API restart');
  assert(restoredSession.totalActiveMs === 1250, 'foreground active time should survive an API restart without adding downtime');
  const restoredPracticeSession = await getJson(`${apiUrl}/sessions/practice/${practiceSession.id}`, studentHeaders);
  assert(restoredPracticeSession.answers[practiceSessionQuestions[0].id]?.selectedAnswer, 'practice-set answer should survive an API restart');
  assert(restoredPracticeSession.markedQuestions.includes(practiceSessionQuestions[0].id), 'practice-set mark should survive an API restart');
  assert(restoredPracticeSession.totalActiveMs === 2100, 'practice-set active time should survive an API restart');
  const restoredStageSession = await getJson(`${apiUrl}/sessions/practice/${stageSession.id}`, studentHeaders);
  assert(restoredStageSession.answers[stageSessionQuestions[0].id]?.selectedAnswer, 'stage-assessment answer should survive an API restart');
  assert(restoredStageSession.totalActiveMs === 3300, 'stage-assessment active time should survive an API restart');

  const submittedPracticeSession = await postJson(`${apiUrl}/sessions/practice/${practiceSession.id}/submit`, {
    answers: practiceSessionQuestions.map((question, index) => ({
      questionId: question.id,
      ...sessionAnswerFor(question, 61 + index),
    })),
    totalActiveMs: 4100,
  }, studentHeaders);
  assert(submittedPracticeSession.workflowResult?.practiceSetId === recommendedPracticeSet.id, 'practice-set session should return its workflow result');
  assert(submittedPracticeSession.workflowResult.totalQuestions === practiceSessionQuestions.length, 'practice-set result should cover the session questions');
  await expectPostStatus(`${apiUrl}/sessions/practice/${practiceSession.id}/submit`, {
    answers: practiceSessionQuestions.map((question) => ({ questionId: question.id, ...sessionAnswerFor(question, 1) })),
  }, 400, studentHeaders);

  const submittedStageSession = await postJson(`${apiUrl}/sessions/practice/${stageSession.id}/submit`, {
    answers: stageSessionQuestions.map((question, index) => ({
      questionId: question.id,
      ...sessionAnswerFor(question, 79 + index),
    })),
    totalActiveMs: 5200,
  }, studentHeaders);
  assert(submittedStageSession.workflowResult?.score === 100, 'stage-assessment session should return its scored workflow result');
  assert(submittedStageSession.workflowResult.adjustment.stage === '冲刺', 'stage assessment should adjust only the authenticated student profile');
  await expectPostStatus(`${apiUrl}/sessions/practice/${stageSession.id}/submit`, {
    answers: stageSessionQuestions.map((question) => ({ questionId: question.id, ...sessionAnswerFor(question, 1) })),
  }, 400, studentHeaders);
  await expectGetStatus(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders, 400);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'question-outside-session', selectedAnswer: 'A', timeSpentSec: 10 }],
  }, 400, studentHeaders);
  const submittedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [
      { questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 73 },
      { questionId: subjectiveQuestion.id, selectedAnswer: 'tag, line index, block offset', timeSpentSec: 240, selfScore: 7, maxScore: 10 },
    ],
    totalActiveMs: 2500,
  }, studentHeaders);
  assert(submittedSession.completed === true, 'restored session should be submittable');
  assert(submittedSession.records.some((record) => record.questionId === subjectiveQuestion.id && record.gradingMode === 'self_assessed'), 'comprehensive question should use self assessment');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 73 }],
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    currentIndex: 0,
    totalActiveMs: 3000,
  }, 400, studentHeaders);
  const examReport = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(examReport.summary.totalQuestions === 2 && examReport.summary.answeredCount === 2, 'exam report should use the submitted session question set');
  assert(examReport.summary.objectiveQuestionCount === 1 && examReport.summary.objectiveCorrectCount === 1, 'objective question should be graded automatically');
  assert(examReport.summary.subjectiveQuestionCount === 1 && examReport.summary.subjectiveEarnedScore === 7, 'subjective question should retain the student self score');
  assert(examReport.summary.subjectiveMaxScore === 10, 'subjective report should retain the maximum score');
  assert(examReport.subjectBreakdown.reduce((sum, item) => sum + item.totalQuestions, 0) === 2, 'old practice records must not contaminate the exam report');
  const overviewAfterSessionSubmissions = await waitForOverview(studentHeaders);
  assert(overviewAfterSessionSubmissions.practiceRecords.filter((record) => record.sessionId === practiceSession.id).length === practiceSessionQuestions.length, 'practice-set duplicate submission must not create duplicate records');
  assert(overviewAfterSessionSubmissions.practiceRecords.filter((record) => record.sessionId === stageSession.id).length === stageSessionQuestions.length, 'stage-assessment duplicate submission must not create duplicate records');
  const examReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders);
  assert(examReviewPlan.days.length === 3, 'submitted exam should generate a three-day review plan');
  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  assert(examReviewPlan.days[0].date > localToday, 'post-exam review plan should start on the next local calendar day');
  const scoreHistory = await getJson(`${apiUrl}/exam/score-history`, studentHeaders);
  assert(scoreHistory.history.some((item) => item.sessionId === startedSession.id), 'submitted exam should appear in score history');
  await delay(300);
  const betaMetrics = await getJson(`${apiUrl}/admin/metrics`, { Authorization: `Bearer ${adminSession.token}` });
  assert(betaMetrics.source === 'postgresql', 'admin metrics should come from PostgreSQL in beta mode');
  assert(betaMetrics.core.registrationCompletionRate.denominator >= 1, 'registration attempts should be traceable in operation logs');
  assert(betaMetrics.core.registrationCompletionRate.numerator >= 1, 'successful registration should be counted');
  assert(betaMetrics.core.diagnosticCompletionRate.numerator >= 1, 'completed onboarding should contribute to diagnostic completion');
  assert(betaMetrics.core.firstTaskCompletionRate.numerator >= 1, 'completed first task should be counted');
  assert(betaMetrics.core.wrongQuestionSecondAccuracyRate.denominator >= 1, 'first due-review attempts should be measurable');
  assert(betaMetrics.core.mockExamCompletionRate.numerator >= 1, 'completed paper session should be counted');
  assert(betaMetrics.core.sessionRecoverySuccessRate.numerator >= 1, 'successful session recovery should be counted');
  assert(betaMetrics.core.apiFailureRate.denominator >= 1, 'API failure rate should expose its request sample size');
  assert(restored.student.targetScore === 126, 'diagnostic profile should survive an API restart');
  assert(restored.student.weakestSubject === '计算机组成原理', 'diagnostic weakest subject should survive an API restart');
  assert(restored.questions.some((question) => question.id === teacherQuestion.id), 'teacher-created question should survive an API restart');
  const restoredPapers = await getJson(`${apiUrl}/papers`, { Authorization: `Bearer ${teacherSession.token}` });
  assert(restoredPapers.some((paper) => paper.id === generatedPaper.id), 'generated paper should survive an API restart');
  const restoredHistory = await getJson(`${apiUrl}/assessment-history`, studentHeaders);
  assert(restoredHistory.items.some((item) => item.paperId === generatedPaper.id), 'assessment history should survive an API restart');
  const restoredConfig = await getJson(`${apiUrl}/admin/system-config`, { Authorization: `Bearer ${adminSession.token}` });
  assert(restoredConfig.recommendation.stageAssessmentQuestionLimit === 2, 'system configuration should survive an API restart');
  const restoredFeedback = await getJson(`${apiUrl}/admin/feedback`, { Authorization: `Bearer ${adminSession.token}` });
  assert(restoredFeedback.items.some((item) => item.id === feedback.id), 'feedback should survive an API restart');
  const restoredAdminUsers = await getJson(`${apiUrl}/admin/users`, adminHeaders);
  const restoredManagedStudent = restoredAdminUsers.users.find((user) => user.id === registered.user.id);
  assert(restoredManagedStudent?.trialStatus === 'follow_up', 'student trial status should survive an API restart');
  assert(restoredManagedStudent?.name === credentials.name, 'real registered student should remain visible to administrators after restart');
  const restoredAuthorizations = await getJson(`${apiUrl}/admin/teacher-authorizations?teacherId=${teacherSession.user.id}`, adminHeaders);
  assert(restoredAuthorizations.items.some((item) => item.studentId === registered.user.id), 'teacher authorization should survive an API restart');
  const restoredAuthorizedOverview = await getJson(`${apiUrl}/dashboard/overview?userId=${registered.user.id}`, teacherHeaders);
  assert(restoredAuthorizedOverview.student.name === credentials.name, 'teacher access should remain authorized after an API restart');

  await stop(activeApi);
  activeApi = startApi();
  await waitForHealth(activeApi);
  const twiceRestoredExamReport = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(twiceRestoredExamReport.summary.subjectiveEarnedScore === 7, 'traceable exam report should survive a second API restart');
  const twiceRestoredReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders);
  assert(twiceRestoredReviewPlan.generatedAt === examReviewPlan.generatedAt, 'post-exam review plan should be restored instead of regenerated');

  console.log(JSON.stringify({
    ok: true,
    source: restored.source,
    persistedRecordId: created.id,
    reviewedQuestionId: restoredWrongDetail.questionId,
    completedTaskId: restoredTask.id,
    restoredSessionId: restoredSession.id,
    restoredReviewHistoryCount: restoredWrongDetail.reviewHistory.length,
    traceableExamSessionId: startedSession.id,
    persistedExamReviewDays: twiceRestoredReviewPlan.days.length,
    persistedDiagnosticTarget: restored.student.targetScore,
    persistedTeacherQuestionId: teacherQuestion.id,
    persistedPaperId: generatedPaper.id,
    persistedFeedbackId: feedback.id,
    practiceRecordCount: restored.practiceRecords.length,
  }, null, 2));

  await stop(activeApi);
  activeApi = undefined;
}

async function prepareLegacyFeedbackMigrationFixture() {
  const resetPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await resetPrisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
  await resetPrisma.$executeRawUnsafe('CREATE SCHEMA "public"');
  await resetPrisma.$disconnect();

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kaoyan-feedback-migration-'));
  const temporaryPrisma = join(temporaryRoot, 'prisma');
  try {
    await cp(join(root, 'prisma'), temporaryPrisma, { recursive: true });
    await rm(join(temporaryPrisma, 'migrations', '20260715160000_feedback_submissions'), { recursive: true, force: true });
    const legacyDeploy = spawnSync(npx, [
      'prisma',
      'migrate',
      'deploy',
      '--schema',
      join(temporaryPrisma, 'schema.prisma'),
    ], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (legacyDeploy.status !== 0) {
      throw new Error(`Legacy Prisma migration deploy failed: ${legacyDeploy.error?.message || legacyDeploy.stderr || legacyDeploy.stdout}`);
    }

    const fixturePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await fixturePrisma.$executeRawUnsafe(
      'INSERT INTO "User" ("id", "name", "role", "createdAt", "updatedAt") VALUES ($1, $2, \'STUDENT\', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      'legacy-feedback-user',
      '历史反馈用户',
    );
    await fixturePrisma.$executeRawUnsafe(
      'INSERT INTO "RuntimeState" ("key", "value", "updatedAt") VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)',
      'feedbackItems',
      JSON.stringify([
        {
          id: 'feedback-legacy-fixture-short',
          userId: 'legacy-feedback-user',
          rating: 4,
          scene: 'legacy-scene',
          message: '短反馈',
          status: 'new',
          createdAt: '2026-07-01T01:02:03.000Z',
        },
        {
          id: 'feedback-legacy-fixture-invalid-date',
          userId: 'legacy-feedback-user',
          rating: 5,
          scene: 'overall',
          message: '历史反馈时间戳无效时仍应安全迁移',
          status: 'reviewed',
          createdAt: 'not-a-valid-timestamp',
        },
      ]),
    );
    await fixturePrisma.$disconnect();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3200',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'integration-test-jwt-secret-with-more-than-32-characters',
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
  throw new Error('Timed out waiting for PostgreSQL API health check');
}

async function waitForOverview(headers, predicate = () => true) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/dashboard/overview`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (predicate(data)) return data;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for PostgreSQL API: ${lastError?.message ?? 'no matching response'}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function patchJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PATCH ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function deleteJson(url, headers = {}) {
  const response = await fetch(url, { method: 'DELETE', headers });
  if (!response.ok) throw new Error(`DELETE ${url} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function expectPostStatus(url, body, expectedStatus, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  assert(response.status === expectedStatus, `POST ${url} should return ${expectedStatus}, received ${response.status}`);
}

async function expectGetStatus(url, headers, expectedStatus) {
  const response = await fetch(url, { headers });
  assert(response.status === expectedStatus, `GET ${url} should return ${expectedStatus}, received ${response.status}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill();
  await Promise.race([once(child, 'exit'), delay(2_000)]);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function expectDatabaseRejection(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function sessionAnswerFor(question, timeSpentSec) {
  if (question.type === '综合题') {
    return {
      selectedAnswer: question.answer || 'Integration self-assessed response',
      timeSpentSec,
      selfScore: 10,
      maxScore: 10,
    };
  }
  return { selectedAnswer: question.answer, timeSpentSec };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => stop(activeApi));
