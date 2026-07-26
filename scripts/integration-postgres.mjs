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
  const migratedReviewSchedules = await migrationPrisma.reviewSchedule.findMany({
    where: { userId: 'legacy-review-user' },
    orderBy: { id: 'asc' },
  });
  const migratedRelapseSchedule = migratedReviewSchedules.find((item) => item.id === 'legacy-review-relapse');
  assert(migratedRelapseSchedule?.lastWrongRecordId === null, 'migration should leave a mastered-then-wrong schedule for startup compensation');
  assert(migratedRelapseSchedule?.redoCorrect === false && migratedRelapseSchedule.timeSpentSec === 131, 'migration should recover the latest unprocessed wrong result and time');
  const migratedLearningSchedule = migratedReviewSchedules.find((item) => item.id === 'legacy-review-learning');
  assert(migratedLearningSchedule?.lastWrongRecordId === 'legacy-record-learning', 'migration should acknowledge an existing active wrong schedule');
  assert(migratedLearningSchedule?.redoCorrect === false && migratedLearningSchedule.timeSpentSec === 88, 'migration should recover a first wrong-answer time without review attempts');
  await migrationPrisma.feedbackSubmission.deleteMany({
    where: { id: { startsWith: 'feedback-legacy-fixture-' } },
  });
  await migrationPrisma.user.deleteMany({ where: { id: 'legacy-review-user' } });
  await migrationPrisma.question.deleteMany({
    where: { id: { startsWith: 'legacy-review-question-' } },
  });
  await migrationPrisma.knowledgePoint.deleteMany({
    where: { id: { startsWith: 'legacy-review-point-' } },
  });
  await migrationPrisma.$disconnect();

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
  assert(initial.questions.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'student dashboard must redact objective answers and explanations');
  const publicQuestionCatalog = await getJson(`${apiUrl}/questions`, studentHeaders);
  assert(publicQuestionCatalog.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'general question catalog must redact objective answers and explanations');
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
  const teacherQuestionCatalog = await getJson(`${apiUrl}/teacher/questions`, teacherHeaders);
  const teacherQuestionsById = new Map(teacherQuestionCatalog.map((question) => [question.id, question]));
  assert(teacherQuestionCatalog.some((question) => question.answer && question.analysis), 'teacher question catalog should retain answers and explanations');
  const filteredTeacherQuestionCatalog = await getJson(`${apiUrl}/teacher/questions?knowledgePointId=co-cache`, teacherHeaders);
  assert(filteredTeacherQuestionCatalog.length > 0 && filteredTeacherQuestionCatalog.every((question) => question.knowledgePointIds.includes('co-cache')), 'teacher question catalog should retain knowledge point filtering');
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
  teacherQuestionsById.set(teacherQuestion.id, teacherQuestion);
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
  teacherQuestionsById.set(subjectiveQuestion.id, subjectiveQuestion);
  assert(subjectiveQuestion.type === '综合题', 'teacher should create a comprehensive question for self assessment');
  const preparedMockPaper = await postJson(`${apiUrl}/exam/papers/prepare`, {
    paperType: '模拟卷',
    questionCount: 4,
    createdBy: 'forged-owner',
  }, studentHeaders);
  assert(preparedMockPaper.paperType === '模拟卷' && preparedMockPaper.questionCount > 0, 'student should prepare a full mock paper from the available bank');
  assert(preparedMockPaper.createdBy === registered.user.id, 'prepared exam must use the authenticated student as its owner');
  assert(preparedMockPaper.questions.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'prepared student papers must not expose objective answers or explanations');
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
  const studentPaperCatalog = await getJson(`${apiUrl}/papers`, studentHeaders);
  assert(studentPaperCatalog.flatMap((paper) => paper.questions).every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'student paper catalog must redact objective answers and explanations');
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
  assert(Math.abs(Date.now() - Date.parse(created.submittedAt)) < 60_000, 'practice submissions should retain their real submission time for deterministic recovery ordering');
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
  assert(detailAfterInitialReason.reviewSchedule.inferredReason.includes('concept unclear'), 'combined mistake reasoning should retain the student self-assessment');
  assert(detailAfterInitialReason.reviewSchedule.inferredReason !== detailAfterInitialReason.reviewSchedule.selfReportedReason, 'combined mistake reasoning should use historical answer behavior');
  assert(detailAfterInitialReason.analysis && detailAfterInitialReason.similarQuestions.length > 0, 'wrong-question detail should include analysis and similar questions');
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

  const relapseRecord = await postJson(`${apiUrl}/practice-records`, {
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'integration-test-relapse',
    timeSpentSec: 128,
  }, studentHeaders);
  assert(relapseRecord.correct === false, 'a mastered question should still record a later wrong answer');
  const reopenedDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(reopenedDetail.reviewSchedule?.stability === 'learning', 'a new wrong answer should reopen a mastered review schedule');
  assert(reopenedDetail.reviewSchedule?.consecutiveCorrect === 0, 'a new wrong answer should reset the mastery streak');
  assert(reopenedDetail.reviewSchedule?.reviewCount === 4, 'reopening should preserve the completed review count');
  assert(!reopenedDetail.reviewSchedule?.selfReportedReason, 'a reopened schedule should wait for a new self-reported reason');
  const reopenedDelayHours = (Date.parse(reopenedDetail.reviewSchedule.nextReviewAt) - Date.now()) / 3_600_000;
  assert(reopenedDelayHours > 23 && reopenedDelayHours <= 24, 'a reopened schedule should return to a next-day review');
  assert(reopenedDetail.reviewHistory?.length === 4, 'reopening should preserve the earlier review trajectory');

  const historicalReasonQuestion = teacherQuestionsById.get('q-002');
  assert(historicalReasonQuestion, 'historical reason verification requires q-002');
  const historicalWrongRecord = await postJson(`${apiUrl}/practice-records`, {
    questionId: historicalReasonQuestion.id,
    knowledgePointId: historicalReasonQuestion.knowledgePointIds[0],
    selectedAnswer: '__wrong__',
    timeSpentSec: historicalReasonQuestion.expectedTimeSec,
  }, studentHeaders);
  await postJson(`${apiUrl}/practice-records`, {
    questionId: historicalReasonQuestion.id,
    knowledgePointId: historicalReasonQuestion.knowledgePointIds[0],
    selectedAnswer: historicalReasonQuestion.answer,
    timeSpentSec: historicalReasonQuestion.expectedTimeSec,
  }, studentHeaders);
  const reasonAfterCorrectAnswer = await postJson(`${apiUrl}/wrong-questions/${historicalReasonQuestion.id}/reason`, {
    selfReportedReason: '审题问题',
    redoCorrect: true,
    timeSpentSec: historicalReasonQuestion.expectedTimeSec,
  }, studentHeaders);
  assert(reasonAfterCorrectAnswer.inferredReason.includes('审题问题'), 'combined reasoning should retain the self-reported reason after a correct answer');
  assert(reasonAfterCorrectAnswer.inferredReason.includes(historicalWrongRecord.mistakeReason), 'combined reasoning should retain the latest historical mistake after a correct answer');

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
  assert(startedSession.questions?.map((question) => question.id).join(',') === sessionInput.questionIds.join(','), 'started session should include its ordered question snapshot');
  const startedObjectiveQuestion = startedSession.questions.find((question) => question.id === 'q-001');
  const startedSubjectiveQuestion = startedSession.questions.find((question) => question.id === subjectiveQuestion.id);
  assert(startedObjectiveQuestion?.answer === '' && startedObjectiveQuestion.analysis === '', 'active exams must redact objective answers and explanations');
  assert(startedSubjectiveQuestion?.answer === '' && startedSubjectiveQuestion.analysis.includes('Scoring points'), 'active exams should expose subjective scoring points without the standard answer');
  assert(startedSession.revision === 0, 'a new session should start at revision zero');

  const atomicQuestion = await postJson(`${apiUrl}/questions`, {
    stem: 'Atomic submission integration question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: 'Used to verify that a failed multi-record submission rolls back completely.',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: 'integration atomic submission',
    expectedTimeSec: 90,
  }, teacherHeaders);
  const atomicSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-atomic-submission',
    questionIds: ['q-001', atomicQuestion.id],
  }, studentHeaders);
  await deleteJson(`${apiUrl}/questions/${atomicQuestion.id}`, teacherHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${atomicSession.id}/submit`, {
    answers: [
      { questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 80 },
      { questionId: atomicQuestion.id, selectedAnswer: 'A', timeSpentSec: 90 },
    ],
  }, 500, studentHeaders);
  await delay(100);
  const failedAtomicSessionView = await getJson(`${apiUrl}/sessions/practice/${atomicSession.id}`, studentHeaders);
  assert(
    failedAtomicSessionView.completed === false
      && failedAtomicSessionView.revision === 0
      && failedAtomicSessionView.answeredCount === 0,
    'failed submission must not publish candidate answers, revision, or completion to the in-memory session',
  );
  const atomicFailurePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const failedAtomicSession = await atomicFailurePrisma.learningSession.findUnique({ where: { id: atomicSession.id } });
  const partialAtomicRecordCount = await atomicFailurePrisma.practiceRecord.count({ where: { sessionId: atomicSession.id } });
  assert(failedAtomicSession?.completed === false && partialAtomicRecordCount === 0, 'failed session submission must roll back both the completion flag and every practice record');
  await atomicFailurePrisma.question.create({
    data: {
      id: atomicQuestion.id,
      stem: atomicQuestion.stem,
      options: atomicQuestion.options,
      answer: atomicQuestion.answer,
      analysis: atomicQuestion.analysis,
      difficulty: 'MEDIUM',
      type: 'SINGLE_CHOICE',
      source: atomicQuestion.source,
      expectedTimeSec: atomicQuestion.expectedTimeSec,
    },
  });
  await atomicFailurePrisma.questionKnowledgePoint.create({
    data: { questionId: atomicQuestion.id, knowledgePointId: 'co-cache' },
  });
  await atomicFailurePrisma.$disconnect();
  const retriedAtomicSubmission = await postJson(`${apiUrl}/sessions/practice/${atomicSession.id}/submit`, {
    answers: [
      { questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 80 },
      { questionId: atomicQuestion.id, selectedAnswer: 'A', timeSpentSec: 90 },
    ],
  }, studentHeaders);
  assert(retriedAtomicSubmission.completed === true && retriedAtomicSubmission.records.length === 2, 'a rolled-back submission should be retryable exactly once');
  const atomicSuccessPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const retriedAtomicRecordCount = await atomicSuccessPrisma.practiceRecord.count({ where: { sessionId: atomicSession.id } });
  await atomicSuccessPrisma.$disconnect();
  assert(retriedAtomicRecordCount === 2, 'a retried session submission must persist one record per answered question without duplicates');

  const emptyAnswerSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-empty-answer-submission',
    questionIds: ['q-002'],
  }, studentHeaders);
  const emptyAnswerSubmission = await postJson(`${apiUrl}/sessions/practice/${emptyAnswerSession.id}/submit`, {
    answers: [],
  }, studentHeaders);
  assert(
    emptyAnswerSubmission.completed === true
      && emptyAnswerSubmission.totalQuestions === 1
      && emptyAnswerSubmission.records.length === 0,
    'an all-unanswered paper should commit once without creating fabricated practice records',
  );
  const emptyAnswerPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const emptyAnswerRecordCount = await emptyAnswerPrisma.practiceRecord.count({ where: { sessionId: emptyAnswerSession.id } });
  await emptyAnswerPrisma.$disconnect();
  assert(emptyAnswerRecordCount === 0, 'an all-unanswered paper must persist no practice records');
  await expectPostStatus(`${apiUrl}/sessions/practice/${emptyAnswerSession.id}/submit`, { answers: [] }, 400, studentHeaders);

  const postCommitFailureSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-post-commit-failure',
    questionIds: ['q-002'],
  }, studentHeaders);
  const postCommitFailurePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await postCommitFailurePrisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION integration_fail_review_schedule() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'integration review schedule failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await postCommitFailurePrisma.$executeRawUnsafe(`
    CREATE TRIGGER integration_fail_review_schedule_trigger
    BEFORE INSERT OR UPDATE ON "ReviewSchedule"
    FOR EACH ROW
    WHEN (NEW."userId" = '${registered.user.id}' AND NEW."questionId" = 'q-002')
    EXECUTE FUNCTION integration_fail_review_schedule()
  `);
  const postCommitFailureResult = await postJson(`${apiUrl}/sessions/practice/${postCommitFailureSession.id}/submit`, {
    answers: [{ questionId: 'q-002', selectedAnswer: '__post_commit_wrong__', timeSpentSec: 100 }],
  }, studentHeaders);
  assert(
    postCommitFailureResult.completed === true
      && postCommitFailureResult.synchronizationWarnings.includes('review_schedule:q-002'),
    'post-commit review synchronization failure must return a successful submission with an explicit warning',
  );
  const postCommitPersistedSession = await postCommitFailurePrisma.learningSession.findUnique({ where: { id: postCommitFailureSession.id } });
  const postCommitRecordCount = await postCommitFailurePrisma.practiceRecord.count({ where: { sessionId: postCommitFailureSession.id } });
  assert(postCommitPersistedSession?.completed === true && postCommitRecordCount === 1, 'post-commit side-effect failure must retain the committed session and record');
  await postCommitFailurePrisma.$executeRawUnsafe('DROP TRIGGER integration_fail_review_schedule_trigger ON "ReviewSchedule"');
  await postCommitFailurePrisma.$executeRawUnsafe('DROP FUNCTION integration_fail_review_schedule()');
  await postCommitFailurePrisma.$disconnect();

  const concurrentSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-concurrent-submission',
    questionIds: ['q-001'],
  }, studentHeaders);
  const concurrentSubmit = () => fetch(`${apiUrl}/sessions/practice/${concurrentSession.id}/submit`, {
    method: 'POST',
    headers: { ...studentHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 80 }] }),
  });
  const concurrentResponses = await Promise.all([concurrentSubmit(), concurrentSubmit()]);
  const concurrentStatuses = concurrentResponses.map((response) => response.status).sort((left, right) => left - right).join(',');
  assert(
    concurrentStatuses === '201,400',
    `two simultaneous submissions must produce exactly one success and one duplicate rejection; received ${concurrentStatuses}`,
  );
  const concurrentPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const concurrentRecordCount = await concurrentPrisma.practiceRecord.count({ where: { sessionId: concurrentSession.id } });
  await concurrentPrisma.$disconnect();
  assert(concurrentRecordCount === 1, 'simultaneous submission attempts must persist exactly one record');

  const crossInstanceSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-cross-instance-submission',
    questionIds: ['q-001'],
  }, studentHeaders);
  const crossInstanceRecordId = `r-cross-instance-${Date.now()}`;
  const crossInstancePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await crossInstancePrisma.$transaction([
    crossInstancePrisma.learningSession.update({
      where: { id: crossInstanceSession.id },
      data: {
        answers: { 'q-001': { selectedAnswer: 'B', timeSpentSec: 80 } },
        revision: 1,
        completed: true,
        submittedAt: new Date(),
        lastActiveAt: new Date(),
      },
    }),
    crossInstancePrisma.practiceRecord.create({
      data: {
        id: crossInstanceRecordId,
        userId: registered.user.id,
        questionId: 'q-001',
        knowledgePointId: 'co-cache',
        selectedAnswer: 'B',
        correct: true,
        timeSpentSec: 80,
        expectedTimeSec: 100,
        sessionId: crossInstanceSession.id,
        gradingMode: 'objective',
      },
    }),
  ]);
  await crossInstancePrisma.$disconnect();
  await expectPostStatus(`${apiUrl}/sessions/practice/${crossInstanceSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 80 }],
  }, 400, studentHeaders);
  const reloadedCrossInstanceSession = await getJson(`${apiUrl}/sessions/practice/${crossInstanceSession.id}`, studentHeaders);
  assert(
    reloadedCrossInstanceSession.completed === true
      && reloadedCrossInstanceSession.revision === 1
      && reloadedCrossInstanceSession.answers['q-001']?.selectedAnswer === 'B',
    'a losing API instance must reload the winning session state after duplicate rejection',
  );
  const overviewAfterCrossInstanceSubmit = await waitForOverview(studentHeaders);
  assert(
    overviewAfterCrossInstanceSubmit.practiceRecords.some((record) => record.id === crossInstanceRecordId),
    'a losing API instance must reload the winning submission records before serving reports',
  );

  const preCommitValidationSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-pre-commit-validation',
    questionIds: [subjectiveQuestion.id],
  }, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${preCommitValidationSession.id}/submit`, {
    answers: [{ questionId: subjectiveQuestion.id, selectedAnswer: 'partial subjective answer', timeSpentSec: 120 }],
  }, 400, studentHeaders);
  const preCommitFailureView = await getJson(`${apiUrl}/sessions/practice/${preCommitValidationSession.id}`, studentHeaders);
  assert(
    preCommitFailureView.completed === false
      && preCommitFailureView.revision === 0
      && preCommitFailureView.answeredCount === 0,
    'pre-commit validation failure must release the lock without publishing candidate progress',
  );
  const recoveredPreCommitSubmission = await postJson(`${apiUrl}/sessions/practice/${preCommitValidationSession.id}/submit`, {
    answers: [{
      questionId: subjectiveQuestion.id,
      selectedAnswer: 'tag, line index, block offset',
      timeSpentSec: 120,
      selfScore: 7,
      maxScore: 10,
    }],
  }, studentHeaders);
  assert(recoveredPreCommitSubmission.completed === true, 'a session must remain retryable after record construction validation fails');

  const profileBeforeWorkflowFailure = await waitForOverview(studentHeaders);
  const workflowFailureSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'stage_assessment',
    resourceId: 'integration-workflow-sync-failure',
    questionIds: ['q-001'],
  }, studentHeaders);
  const workflowFailurePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await workflowFailurePrisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION integration_fail_profile_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'integration profile update failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await workflowFailurePrisma.$executeRawUnsafe(`
    CREATE TRIGGER integration_fail_profile_update_trigger
    BEFORE UPDATE ON "User"
    FOR EACH ROW
    WHEN (NEW."id" = '${registered.user.id}')
    EXECUTE FUNCTION integration_fail_profile_update()
  `);
  const workflowFailureResult = await postJson(`${apiUrl}/sessions/practice/${workflowFailureSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 80 }],
  }, studentHeaders);
  assert(
    workflowFailureResult.completed === true
      && workflowFailureResult.synchronizationWarnings.includes('workflow_result')
      && workflowFailureResult.workflowResult === undefined,
    'post-commit workflow synchronization failure must return a successful submission with an explicit warning',
  );
  const profileAfterWorkflowFailure = await waitForOverview(studentHeaders);
  assert(
    profileAfterWorkflowFailure.student.stage === profileBeforeWorkflowFailure.student.stage
      && profileAfterWorkflowFailure.student.remainingDays === profileBeforeWorkflowFailure.student.remainingDays,
    'failed workflow synchronization must not publish an unpersisted profile adjustment to memory',
  );
  const persistedWorkflowFailureSession = await workflowFailurePrisma.learningSession.findUnique({ where: { id: workflowFailureSession.id } });
  const workflowFailureRecordCount = await workflowFailurePrisma.practiceRecord.count({ where: { sessionId: workflowFailureSession.id } });
  assert(persistedWorkflowFailureSession?.completed === true && workflowFailureRecordCount === 1, 'workflow synchronization failure must retain the committed session and record');
  await workflowFailurePrisma.$executeRawUnsafe('DROP TRIGGER integration_fail_profile_update_trigger ON "User"');
  await workflowFailurePrisma.$executeRawUnsafe('DROP FUNCTION integration_fail_profile_update()');
  await workflowFailurePrisma.$disconnect();

  const originalSessionStem = startedSession.questions[0].stem;
  const idempotentSession = await postJson(`${apiUrl}/sessions/practice/start`, sessionInput, studentHeaders);
  assert(idempotentSession.id === startedSession.id, 'starting the same active resource should be idempotent');
  const newerSave = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    revision: 2,
    answers: { 'q-001': { selectedAnswer: 'B', timeSpentSec: 70 } },
  }, studentHeaders);
  assert(newerSave.revision === 2 && newerSave.answers['q-001'].selectedAnswer === 'B', 'a newer save should advance the session revision');
  const staleSave = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    revision: 1,
    answers: { 'q-001': { selectedAnswer: 'A', timeSpentSec: 71 } },
  }, studentHeaders);
  assert(staleSave.revision === 2 && staleSave.answers['q-001'].selectedAnswer === 'B', 'an out-of-order save must not overwrite newer progress');
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    revision: 3,
    answers: { 'question-outside-session': { selectedAnswer: 'A', timeSpentSec: 10 } },
  }, 400, studentHeaders);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    revision: 3,
    currentIndex: 9,
  }, 400, studentHeaders);
  const savedSession = await postJson(`${apiUrl}/sessions/practice/${startedSession.id}/save`, {
    revision: 3,
    answers: { 'q-001': { selectedAnswer: 'A', timeSpentSec: 73 } },
    currentIndex: 1,
    markedQuestions: [subjectiveQuestion.id],
    totalActiveMs: 1250,
  }, studentHeaders);
  assert(savedSession.currentIndex === 1 && savedSession.markedQuestions.includes(subjectiveQuestion.id), 'session progress should be saved');
  const updatedCatalogQuestion = await patchJson(`${apiUrl}/questions/q-001`, {
    stem: `${originalSessionStem}（题库已更新）`,
    answer: 'A',
    knowledgePointIds: ['net-tcp'],
    expectedTimeSec: 999,
  }, teacherHeaders);
  teacherQuestionsById.set(updatedCatalogQuestion.id, updatedCatalogQuestion);

  const partialExamSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-partial-exam',
    questionIds: ['q-001', subjectiveQuestion.id],
  }, studentHeaders);
  const partialSavedSession = await postJson(`${apiUrl}/sessions/practice/${partialExamSession.id}/save`, {
    revision: 1,
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
  const missingSnapshotPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await missingSnapshotPrisma.learningSession.update({
    where: { id: partialExamSession.id },
    data: { questionSnapshot: [] },
  });
  await missingSnapshotPrisma.$disconnect();

  const recommendedPracticeSet = await getJson(`${apiUrl}/practice-sets/recommended`, studentHeaders);
  assert(recommendedPracticeSet.questions.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'recommended practice questions must redact objective answers and explanations');
  const practiceSessionQuestions = recommendedPracticeSet.questions.slice(0, Math.min(2, recommendedPracticeSet.questions.length));
  assert(practiceSessionQuestions.length > 0, 'recommended practice set should contain resumable questions');
  const practiceSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'practice_set',
    resourceId: recommendedPracticeSet.id,
    questionIds: practiceSessionQuestions.map((question) => question.id),
  }, studentHeaders);
  await postJson(`${apiUrl}/sessions/practice/${practiceSession.id}/save`, {
    revision: 1,
    answers: {
      [practiceSessionQuestions[0].id]: sessionAnswerFor(teacherQuestionsById.get(practiceSessionQuestions[0].id) ?? practiceSessionQuestions[0], 61),
    },
    currentIndex: Math.min(1, practiceSessionQuestions.length - 1),
    markedQuestions: [practiceSessionQuestions[0].id],
    totalActiveMs: 2100,
  }, studentHeaders);

  const stageAssessment = await getJson(`${apiUrl}/assessments/stage`, studentHeaders);
  assert(stageAssessment.questions.every((question) => question.answer === '' && (question.type === '综合题' || question.analysis === '')), 'stage assessment questions must redact objective answers and explanations');
  const stageSessionQuestions = stageAssessment.questions.slice(0, Math.min(2, stageAssessment.questions.length));
  assert(stageSessionQuestions.length > 0, 'stage assessment should contain resumable questions');
  const stageSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'stage_assessment',
    resourceId: stageAssessment.id,
    questionIds: stageSessionQuestions.map((question) => question.id),
  }, studentHeaders);
  await postJson(`${apiUrl}/sessions/practice/${stageSession.id}/save`, {
    revision: 1,
    answers: {
      [stageSessionQuestions[0].id]: sessionAnswerFor(teacherQuestionsById.get(stageSessionQuestions[0].id) ?? stageSessionQuestions[0], 79),
    },
    currentIndex: Math.min(1, stageSessionQuestions.length - 1),
    totalActiveMs: 3300,
  }, studentHeaders);
  await expectGetStatus(`${apiUrl}/sessions/practice/${startedSession.id}`, { Authorization: `Bearer ${teacherSession.token}` }, 403);

  const restartRelapseRecord = await postJson(`${apiUrl}/practice-records`, {
    questionId: 'q-001',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'restart-relapse',
    timeSpentSec: 131,
  }, studentHeaders);
  const restartClassification = await postJson(`${apiUrl}/wrong-questions/q-001/reason`, {
    selfReportedReason: '重启前自评',
    redoCorrect: false,
    timeSpentSec: 131,
    isReview: false,
  }, studentHeaders);
  const restartDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(restartDetail.reviewSchedule.selfReportedReason === '重启前自评', 'restart verification should begin with a classified latest wrong answer');
  assert(restartDetail.reviewSchedule.inferredReason === restartClassification.inferredReason, 'pre-restart combined reason should be traceable');
  await stop(activeApi);
  const dueReviewPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const forcedDueAt = new Date(Date.now() - 60_000);
  await dueReviewPrisma.reviewSchedule.update({
    where: { userId_questionId: { userId: registered.user.id, questionId: 'q-001' } },
    data: { nextReviewAt: forcedDueAt },
  });
  await dueReviewPrisma.$disconnect();
  activeApi = startApi();
  await waitForHealth(activeApi);
  const reloggedIn = await postJson(`${apiUrl}/auth/login`, credentials);
  assert(reloggedIn.user.id === registered.user.id, 'student should log in again after an API restart');
  studentHeaders = { Authorization: `Bearer ${reloggedIn.accessToken}` };
  await expectGetStatus(`${apiUrl}/exam/report/${partialExamSession.id}`, studentHeaders, 400);
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
  assert(restoredWrongDetail.reviewSchedule?.stability === 'learning', 'a reopened review schedule should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.consecutiveCorrect === 0, 'the reset mastery streak should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.reviewCount === 4, 'the completed review count should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.selfReportedReason === '重启前自评', 'the latest self-reported reason should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.inferredReason === restartClassification.inferredReason, 'the combined reason should survive an API restart');
  assert(restoredWrongDetail.reviewSchedule?.nextReviewAt === forcedDueAt.toISOString(), 'API restart must not move an existing review deadline');
  assert(restoredWrongDetail.reviewHistory?.length === 4, 'complete review trajectory should survive an API restart');
  assert(restoredWrongDetail.reviewHistory[0].nextIntervalDays === 1, 'review history should retain interval decisions');
  assert(restoredWrongDetail.reviewHistory.at(-1)?.reviewedAt === masteredRedo.lastReviewedAt, 'latest wrong-question review timestamp should survive an API restart');
  const restoredDueReviews = await getJson(`${apiUrl}/review/due`, studentHeaders);
  const restoredDueReview = restoredDueReviews.items.find((item) => item.questionId === 'q-001');
  assert(restoredDueReview, 'a reopened schedule should appear in today\'s due reviews when its time arrives');
  assert(restoredDueReview.redoCorrect === false, 'a reopened schedule should retain the latest wrong result after restart');
  assert(restoredDueReview.timeSpentSec === 131, 'a reopened schedule should retain the latest wrong-answer time after restart');
  const restoredSchedulePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const restoredScheduleRow = await restoredSchedulePrisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: registered.user.id, questionId: 'q-001' } },
  });
  await restoredSchedulePrisma.$disconnect();
  assert(restoredScheduleRow?.reviewCount === 4, 'PostgreSQL should retain the completed review count after restart');
  assert(restoredScheduleRow?.selfReportedReason === '重启前自评', 'PostgreSQL should retain the latest self-reported reason after restart');
  assert(restoredScheduleRow?.inferredReason === restartClassification.inferredReason, 'PostgreSQL should retain the combined reason after restart');
  assert(restoredScheduleRow?.lastReviewedAt?.toISOString() === masteredRedo.lastReviewedAt, 'PostgreSQL should retain the last completed review time after reopening');
  assert(restoredScheduleRow?.nextReviewAt.toISOString() === forcedDueAt.toISOString(), 'PostgreSQL should retain the exact review deadline after restart');

  await stop(activeApi);
  const interruptedSchedulePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await interruptedSchedulePrisma.reviewSchedule.update({
    where: { userId_questionId: { userId: registered.user.id, questionId: 'q-001' } },
    data: {
      lastWrongRecordId: relapseRecord.id,
      selfReportedReason: 'stale reason',
      redoCorrect: true,
      timeSpentSec: 76,
      consecutiveCorrect: 3,
      stability: 'mastered',
      nextReviewAt: new Date(Date.now() + 14 * 86_400_000),
    },
  });
  await interruptedSchedulePrisma.$disconnect();
  activeApi = startApi();
  await waitForHealth(activeApi);
  const recoveredLogin = await postJson(`${apiUrl}/auth/login`, credentials);
  studentHeaders = { Authorization: `Bearer ${recoveredLogin.accessToken}` };
  const compensatedDetail = await getJson(`${apiUrl}/wrong-questions/q-001/detail`, studentHeaders);
  assert(compensatedDetail.reviewSchedule?.stability === 'learning', 'startup should compensate an unprocessed latest wrong record');
  assert(compensatedDetail.reviewSchedule?.consecutiveCorrect === 0, 'crash compensation should reset the stale mastery streak');
  assert(!compensatedDetail.reviewSchedule?.selfReportedReason, 'crash compensation should clear the stale self-reported reason');
  assert(compensatedDetail.reviewHistory?.length === 4, 'crash compensation should preserve the earlier review trajectory');
  const compensatedSchedulePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const compensatedScheduleRow = await compensatedSchedulePrisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: registered.user.id, questionId: 'q-001' } },
  });
  await compensatedSchedulePrisma.$disconnect();
  assert(compensatedScheduleRow?.lastWrongRecordId === restartRelapseRecord.id, 'crash compensation should acknowledge the latest wrong record');
  assert(compensatedScheduleRow?.redoCorrect === false && compensatedScheduleRow.timeSpentSec === 131, 'crash compensation should persist the latest wrong result and time');
  const restoredTask = restored.plan.dailyTasks.find((task) => task.id === taskId);
  assert(restoredTask.completed === true, 'study-task completion should survive an API restart');
  const restoredOnboarding = await getJson(`${apiUrl}/onboarding/status`, studentHeaders);
  assert(restoredOnboarding.completed === true && restoredOnboarding.profile.examYear, 'onboarding profile should survive an API restart');
  const restoredTodayPlan = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(restoredTodayPlan.weekProgress.length >= 7, 'the original seven-day plan and any capacity extension should survive an API restart');
  assert(!restoredTodayPlan.priorityTasks.some((task) => task.id === postponeTaskId), 'task rescheduling should survive an API restart');
  const restoredSession = await getJson(`${apiUrl}/sessions/practice/${startedSession.id}`, studentHeaders);
  assert(restoredSession.questions?.map((question) => question.id).join(',') === sessionInput.questionIds.join(','), 'restored session should include its ordered question snapshot');
  assert(restoredSession.questions[0].stem === originalSessionStem, 'restored session should preserve the question content captured when it started');
  assert(restoredSession.revision === 3, 'the latest accepted save revision should survive an API restart');
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
      ...sessionAnswerFor(teacherQuestionsById.get(question.id) ?? question, 61 + index),
    })),
    totalActiveMs: 4100,
  }, studentHeaders);
  assert(submittedPracticeSession.workflowResult?.practiceSetId === recommendedPracticeSet.id, 'practice-set session should return its workflow result');
  assert(submittedPracticeSession.workflowResult.totalQuestions === practiceSessionQuestions.length, 'practice-set result should cover the session questions');
  await expectPostStatus(`${apiUrl}/sessions/practice/${practiceSession.id}/submit`, {
    answers: practiceSessionQuestions.map((question) => ({ questionId: question.id, ...sessionAnswerFor(teacherQuestionsById.get(question.id) ?? question, 1) })),
  }, 400, studentHeaders);

  const submittedStageSession = await postJson(`${apiUrl}/sessions/practice/${stageSession.id}/submit`, {
    answers: stageSessionQuestions.map((question, index) => ({
      questionId: question.id,
      ...sessionAnswerFor(teacherQuestionsById.get(question.id) ?? question, 79 + index),
    })),
    totalActiveMs: 5200,
  }, studentHeaders);
  assert(submittedStageSession.workflowResult?.score === 100, 'stage-assessment session should return its scored workflow result');
  assert(submittedStageSession.workflowResult.adjustment.stage === '冲刺', 'stage assessment should adjust only the authenticated student profile');
  await expectPostStatus(`${apiUrl}/sessions/practice/${stageSession.id}/submit`, {
    answers: stageSessionQuestions.map((question) => ({ questionId: question.id, ...sessionAnswerFor(teacherQuestionsById.get(question.id) ?? question, 1) })),
  }, 400, studentHeaders);
  await expectGetStatus(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders, 400);
  await expectPostStatus(`${apiUrl}/sessions/practice/${startedSession.id}/submit`, {
    answers: [{ questionId: 'question-outside-session', selectedAnswer: 'A', timeSpentSec: 10 }],
  }, 400, studentHeaders);
  await patchJson(`${apiUrl}/questions/${subjectiveQuestion.id}`, {
    type: '选择题',
    answer: 'A',
    knowledgePointIds: ['net-tcp'],
  }, teacherHeaders);
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
    revision: 4,
    currentIndex: 0,
    totalActiveMs: 3000,
  }, 400, studentHeaders);
  const examReport = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(examReport.summary.totalQuestions === 2 && examReport.summary.answeredCount === 2, 'exam report should use the submitted session question set');
  assert(examReport.summary.objectiveQuestionCount === 1 && examReport.summary.objectiveCorrectCount === 1, 'objective question should be graded automatically');
  assert(examReport.summary.subjectiveQuestionCount === 1 && examReport.summary.subjectiveEarnedScore === 7, 'subjective question should retain the student self score');
  assert(examReport.summary.subjectiveMaxScore === 10, 'subjective report should retain the maximum score');
  assert(examReport.subjectBreakdown.reduce((sum, item) => sum + item.totalQuestions, 0) === 2, 'old practice records must not contaminate the exam report');
  assert(examReport.subjectBreakdown.reduce((sum, item) => sum + item.totalTimeSec, 0) === 313, 'subject breakdown should expose traceable total time per subject');
  const reportAfterQuestionEdit = await getJson(`${apiUrl}/exam/report/${startedSession.id}`, studentHeaders);
  assert(reportAfterQuestionEdit.summary.subjectiveQuestionCount === 1, 'historical exam grading should use the question snapshot after catalog edits');
  assert(JSON.stringify(reportAfterQuestionEdit.subjectBreakdown) === JSON.stringify(examReport.subjectBreakdown), 'historical subject timing and accuracy should not change after catalog edits');
  const overviewAfterSessionSubmissions = await waitForOverview(studentHeaders);
  const snapshotGradedRecord = overviewAfterSessionSubmissions.practiceRecords.find((record) =>
    record.sessionId === startedSession.id && record.questionId === 'q-001',
  );
  assert(snapshotGradedRecord?.expectedTimeSec === 100, 'paper grading should retain the question snapshot expected time');
  assert(overviewAfterSessionSubmissions.practiceRecords.filter((record) => record.sessionId === practiceSession.id).length === practiceSessionQuestions.length, 'practice-set duplicate submission must not create duplicate records');
  assert(overviewAfterSessionSubmissions.practiceRecords.filter((record) => record.sessionId === stageSession.id).length === stageSessionQuestions.length, 'stage-assessment duplicate submission must not create duplicate records');
  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const firstReviewTargetDate = new Date(`${localToday}T00:00:00.000Z`);
  firstReviewTargetDate.setUTCDate(firstReviewTargetDate.getUTCDate() + 1);
  const reviewCapacityPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const activePlan = await reviewCapacityPrisma.studyPlan.findFirst({
      where: { userId: registered.user.id, status: 'ACTIVE' },
      include: { tasks: { where: { scheduledDate: firstReviewTargetDate.toISOString().slice(0, 10) }, orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const protectedTaskIds = activePlan?.tasks.slice(0, 3).map((task) => task.id) ?? [];
    assert(protectedTaskIds.length === 3, 'review scheduler regression requires three target-date tasks');
    await reviewCapacityPrisma.studyTask.updateMany({
      where: { id: { in: protectedTaskIds } },
      data: { status: 'in_progress' },
    });
  } finally {
    await reviewCapacityPrisma.$disconnect();
  }
  const [examReviewPlan, concurrentExamReviewPlan] = await Promise.all([
    postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders),
    postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders),
  ]);
  assert(examReviewPlan.days.length === 3, 'submitted exam should generate a three-day review plan');
  assert(JSON.stringify(examReviewPlan) === JSON.stringify(concurrentExamReviewPlan), 'concurrent review generation should return the same persisted summary');
  assert(examReviewPlan.days[0].date > localToday, 'post-exam review plan should start on the next local calendar day');
  assert(examReviewPlan.days[0].date > firstReviewTargetDate.toISOString().slice(0, 10), 'protected target-date tasks should move the first review task later');
  assert(examReviewPlan.days.every((day) => day.taskId && day.knowledgePointId), 'post-exam review days should expose actionable task and knowledge point IDs');
  const reviewTaskIds = examReviewPlan.days.map((day) => day.taskId);
  assert(new Set(reviewTaskIds).size === 3, 'post-exam review days should expose three distinct task IDs');
  assert(reviewTaskIds.every((taskId, index) => taskId === `exam-review-${startedSession.id}-day-${index + 1}`), 'concurrent review generation should persist deterministic task IDs');
  const reviewTaskPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let persistedConcurrentGeneratedAt;
  let persistedConcurrentSummary;
  try {
    const reviewTasks = await reviewTaskPrisma.studyTask.findMany({
      where: { id: { in: reviewTaskIds } },
    });
    const persistedConcurrentReview = await reviewTaskPrisma.examReviewPlan.findUniqueOrThrow({
      where: { sessionId: startedSession.id },
    });
    persistedConcurrentGeneratedAt = persistedConcurrentReview.createdAt.toISOString();
    persistedConcurrentSummary = toExamReviewPlanResponse(persistedConcurrentReview);
    assert(JSON.stringify(examReviewPlan) === JSON.stringify(persistedConcurrentSummary), 'first concurrent response should equal the persisted review summary');
    assert(JSON.stringify(concurrentExamReviewPlan) === JSON.stringify(persistedConcurrentSummary), 'second concurrent response should equal the persisted review summary');
    assert(reviewTasks.length === 3, 'concurrent review generation should persist exactly three task rows');
    for (const day of examReviewPlan.days) {
      const task = reviewTasks.find((item) => item.id === day.taskId);
      assert(task?.mode === '考后复盘' && task.priority === '高', 'post-exam review tasks should be high-priority review tasks');
      assert(task?.knowledgePointId === day.knowledgePointId, 'post-exam review task should persist the selected knowledge point');
      assert(task?.scheduledDate === day.date, 'post-exam review task should persist its response date');
      const taskCount = await reviewTaskPrisma.studyTask.count({
        where: { planId: task?.planId, scheduledDate: day.date },
      });
      assert(taskCount <= 3, 'post-exam review task dates should not exceed plan capacity');
    }
  } finally {
    await reviewTaskPrisma.$disconnect();
  }
  const bootstrapCredentials = {
    email: `integration.bootstrap.${Date.now()}@example.com`,
    password: 'ReliableTestPassword!408',
    name: '未引导复盘学生',
  };
  const bootstrapRegistered = await postJson(`${apiUrl}/auth/register`, bootstrapCredentials);
  const bootstrapHeaders = { Authorization: `Bearer ${bootstrapRegistered.accessToken}` };
  const bootstrapSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-no-plan-review',
    questionIds: ['q-001'],
  }, bootstrapHeaders);
  await postJson(`${apiUrl}/sessions/practice/${bootstrapSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 60 }],
  }, bootstrapHeaders);
  const onboardingRacePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const onboardingLockObserverPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let releaseOnboardingLock = () => undefined;
  let onboardingLockTransaction;
  let queuedOnboarding;
  let queuedReviewGeneration;
  let onboardingRaceFailure;
  try {
    const bootstrapPlanCountBeforeGeneration = await onboardingRacePrisma.studyPlan.count({
      where: { userId: bootstrapRegistered.user.id, status: 'ACTIVE' },
    });
    assert(bootstrapPlanCountBeforeGeneration === 0, 'a student without onboarding should have no active plan before the review/onboarding race');
    let markOnboardingLockAcquired;
    let markOnboardingLockFailed;
    let onboardingLockHeld = false;
    const onboardingLockRelease = new Promise((resolve) => {
      releaseOnboardingLock = resolve;
    });
    const onboardingLockAcquired = new Promise((resolve, reject) => {
      markOnboardingLockAcquired = resolve;
      markOnboardingLockFailed = reject;
    });
    onboardingLockTransaction = onboardingRacePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bootstrapRegistered.user.id}))`;
      const [lockOwner] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      assert(Number.isInteger(lockOwner?.pid), 'PostgreSQL advisory-lock owner query must return an integer PID');
      onboardingLockHeld = true;
      markOnboardingLockAcquired(lockOwner.pid);
      await onboardingLockRelease;
    }, { maxWait: 5_000, timeout: 15_000 }).then(
      () => ({ ok: true }),
      (error) => {
        if (!onboardingLockHeld) markOnboardingLockFailed(error);
        return { ok: false, error };
      },
    );
    const onboardingLockOwnerPid = await onboardingLockAcquired;
    let onboardingSettledWhileLocked = false;
    queuedReviewGeneration = postJson(
      `${apiUrl}/exam/review-tasks/${bootstrapSession.id}`,
      {},
      bootstrapHeaders,
    ).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    await waitForAdvisoryLockWaiter(
      onboardingLockObserverPrisma,
      onboardingLockOwnerPid,
      [],
      'review generation',
    );
    queuedOnboarding = postJson(`${apiUrl}/onboarding/complete`, {
      examYear: new Date().getUTCFullYear() + 1,
      targetScore: 124,
      currentScore: 80,
      remainingDays: 90,
      dailyHours: 3,
      weakestSubject: onboarding.weakestSubject,
    }, bootstrapHeaders).then(
      (value) => {
        onboardingSettledWhileLocked = true;
        return { ok: true, value };
      },
      (error) => {
        onboardingSettledWhileLocked = true;
        return { ok: false, error };
      },
    );
    const onboardingWasBlocked = !onboardingSettledWhileLocked;
    releaseOnboardingLock();
    const lockResult = await onboardingLockTransaction;
    if (!lockResult.ok) throw lockResult.error;
    const [onboardingResult, reviewResult] = await Promise.all([
      queuedOnboarding,
      queuedReviewGeneration,
    ]);
    if (!onboardingResult.ok) throw onboardingResult.error;
    if (!reviewResult.ok) throw reviewResult.error;
    assert(onboardingWasBlocked, 'onboarding must wait behind review generation for the same student');
    assert(reviewResult.value.days.length === 3, 'review generation should resume before serialized onboarding');

    const [bootstrapUser, bootstrapStatus, bootstrapPlans, persistedReviewPlan] = await Promise.all([
      onboardingRacePrisma.user.findUniqueOrThrow({ where: { id: bootstrapRegistered.user.id } }),
      getJson(`${apiUrl}/onboarding/status`, bootstrapHeaders),
      onboardingRacePrisma.studyPlan.findMany({
        where: { userId: bootstrapRegistered.user.id },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'asc' },
      }),
      onboardingRacePrisma.examReviewPlan.findUniqueOrThrow({
        where: { sessionId: bootstrapSession.id },
      }),
    ]);
    const activePlans = bootstrapPlans.filter((plan) => plan.status === 'ACTIVE');
    const activePlan = activePlans[0];
    const expectedReviewTaskIds = Array.from(
      { length: 3 },
      (_, index) => `exam-review-${bootstrapSession.id}-day-${index + 1}`,
    );
    const activeReviewTasks = activePlan?.tasks.filter((task) => expectedReviewTaskIds.includes(task.id)) ?? [];
    const persistedReviewSummary = toExamReviewPlanResponse(persistedReviewPlan);
    const activeDatesByTaskId = new Map(activeReviewTasks.map((task) => [task.id, task.scheduledDate]));
    const activeTaskCountsByDate = activePlan?.tasks.reduce((counts, task) => {
      counts.set(task.scheduledDate, (counts.get(task.scheduledDate) ?? 0) + 1);
      return counts;
    }, new Map()) ?? new Map();
    const onboardingTaskCountsByDate = new Map(
      onboardingResult.value.sevenDayPlan.days.map((day) => [day.date, day.taskCount]),
    );

    assert(activePlans.length === 1, 'review-first onboarding must leave exactly one active plan');
    assert(bootstrapPlans.length === 2 && bootstrapPlans.filter((plan) => plan.status === 'ARCHIVED').length === 1, 'review-first onboarding must replace the fallback plan exactly once');
    assert(activeReviewTasks.length === 3, 'review-first onboarding must carry exactly three deterministic review rows into the active plan');
    assert(
      expectedReviewTaskIds.every((taskId) => activeReviewTasks.some((task) => task.id === taskId)),
      'review-first onboarding must preserve all deterministic review task IDs',
    );
    assert(
      reviewResult.value.days.length === activeDatesByTaskId.size
        && reviewResult.value.days.every((day) => activeDatesByTaskId.get(day.taskId) === day.date),
      'review-first response task IDs and dates must match active task dates',
    );
    assert(
      persistedReviewSummary.days.every((day) => activeDatesByTaskId.get(day.taskId) === day.date),
      'review-first onboarding must synchronize review summary dates with active task dates',
    );
    assert(
      [...activeTaskCountsByDate.values()].every((count) => count <= 3),
      'review-first onboarding must preserve daily task capacity',
    );
    assert(
      onboardingTaskCountsByDate.size === activeTaskCountsByDate.size
        && [...activeTaskCountsByDate].every(([date, count]) => onboardingTaskCountsByDate.get(date) === count),
      'review-first onboarding must return the persisted merged schedule',
    );
    assert(
      bootstrapUser.onboardingCompletedAt?.toISOString() === onboardingResult.value.completedAt
        && bootstrapUser.trialStatus === 'ACTIVE'
        && bootstrapUser.targetScore === 124
        && bootstrapUser.currentScore === 80
        && bootstrapUser.remainingDays === 90
        && bootstrapUser.dailyHours === 3
        && bootstrapStatus.completed === true
        && bootstrapStatus.profile?.completedAt === onboardingResult.value.completedAt,
      'the single onboarding request must persist one matching profile and trial activation',
    );
  } catch (error) {
    onboardingRaceFailure = error;
  } finally {
    releaseOnboardingLock();
    const pendingOperations = [];
    if (onboardingLockTransaction) pendingOperations.push(onboardingLockTransaction);
    if (queuedOnboarding) pendingOperations.push(queuedOnboarding);
    if (queuedReviewGeneration) pendingOperations.push(queuedReviewGeneration);
    const pendingResults = await Promise.allSettled(pendingOperations);
    const rejectedOperation = pendingResults.find((result) => result.status === 'rejected');
    if (rejectedOperation) onboardingRaceFailure ??= rejectedOperation.reason;
    const disconnectResults = await Promise.allSettled([
      onboardingRacePrisma.$disconnect(),
      onboardingLockObserverPrisma.$disconnect(),
    ]);
    const rejectedDisconnect = disconnectResults.find((result) => result.status === 'rejected');
    if (rejectedDisconnect) {
      onboardingRaceFailure ??= rejectedDisconnect.reason;
    }
  }
  if (onboardingRaceFailure) throw onboardingRaceFailure;

  const completedReviewCredentials = {
    email: `integration.completed-review.${Date.now()}@example.com`,
    password: 'ReliableTestPassword!408',
    name: 'Completed Review Student',
  };
  const completedReviewRegistered = await postJson(`${apiUrl}/auth/register`, completedReviewCredentials);
  const completedReviewHeaders = { Authorization: `Bearer ${completedReviewRegistered.accessToken}` };
  const completedReviewSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-completed-review-onboarding',
    questionIds: ['q-001'],
  }, completedReviewHeaders);
  await postJson(`${apiUrl}/sessions/practice/${completedReviewSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 60 }],
  }, completedReviewHeaders);
  const completedReviewPlan = await postJson(
    `${apiUrl}/exam/review-tasks/${completedReviewSession.id}`,
    {},
    completedReviewHeaders,
  );
  const completedReviewTaskId = completedReviewPlan.days[0].taskId;
  const completedReviewPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const completedReviewTask = await completedReviewPrisma.studyTask.update({
      where: { id: completedReviewTaskId },
      data: { status: 'completed', completed: true, completedAt: new Date() },
    });
    await postJson(`${apiUrl}/onboarding/complete`, {
      examYear: new Date().getUTCFullYear() + 1,
      targetScore: 124,
      currentScore: 80,
      remainingDays: 90,
      dailyHours: 3,
      weakestSubject: onboarding.weakestSubject,
    }, completedReviewHeaders);
    const [replacementPlan, persistedCompletedTask] = await Promise.all([
      completedReviewPrisma.studyPlan.findFirstOrThrow({
        where: { userId: completedReviewRegistered.user.id, status: 'ACTIVE' },
        include: { tasks: { select: { id: true } } },
      }),
      completedReviewPrisma.studyTask.findUniqueOrThrow({
        where: { id: completedReviewTaskId },
        include: { plan: { select: { status: true } } },
      }),
    ]);
    assert(
      persistedCompletedTask.planId === completedReviewTask.planId
        && completedReviewTask.planId !== replacementPlan.id
        && persistedCompletedTask.plan.status === 'ARCHIVED'
        && replacementPlan.tasks.every((task) => task.id !== completedReviewTaskId),
      'completed review tasks must not be carried into the replacement active plan',
    );
  } finally {
    await completedReviewPrisma.$disconnect();
  }
  await expectPostStatus(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, 403, bootstrapHeaders);
  await expectPostStatus(`${apiUrl}/tasks/${encodeURIComponent(examReviewPlan.days[0].taskId)}/start`, {}, 400, bootstrapHeaders);
  const rollbackSession = await postJson(`${apiUrl}/sessions/practice/start`, {
    type: 'paper',
    resourceId: 'integration-review-rollback',
    questionIds: ['q-001'],
  }, studentHeaders);
  await postJson(`${apiUrl}/sessions/practice/${rollbackSession.id}/submit`, {
    answers: [{ questionId: 'q-001', selectedAnswer: 'B', timeSpentSec: 60 }],
  }, studentHeaders);
  const rollbackPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let rollbackPlanId;
  let rollbackScheduleBefore;
  let rollbackFailure;
  let rollbackCleanupFailure;
  try {
    try {
      const rollbackPlan = await rollbackPrisma.studyPlan.findFirstOrThrow({
        where: { userId: registered.user.id, status: 'ACTIVE' },
        include: { tasks: { select: { id: true, scheduledDate: true }, orderBy: { id: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      rollbackPlanId = rollbackPlan.id;
      rollbackScheduleBefore = rollbackPlan.tasks;
      await rollbackPrisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION integration_post_exam_task_failure()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.id LIKE 'exam-review-%-day-2' THEN
            RAISE EXCEPTION 'integration post-exam task failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await rollbackPrisma.$executeRawUnsafe(`
        CREATE TRIGGER integration_post_exam_task_failure
        BEFORE INSERT ON "StudyTask"
        FOR EACH ROW EXECUTE FUNCTION integration_post_exam_task_failure();
      `);
      await expectPostStatus(`${apiUrl}/exam/review-tasks/${rollbackSession.id}`, {}, 500, studentHeaders);
    } finally {
      try {
        await rollbackPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS integration_post_exam_task_failure ON "StudyTask"');
      } catch (error) {
        rollbackCleanupFailure = error;
      }
      try {
        await rollbackPrisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS integration_post_exam_task_failure()');
      } catch (error) {
        rollbackCleanupFailure ??= error;
      }
    }
    if (rollbackCleanupFailure) throw rollbackCleanupFailure;
    const [failedSummary, failedTaskCount, rollbackPlan] = await Promise.all([
      rollbackPrisma.examReviewPlan.findUnique({ where: { sessionId: rollbackSession.id } }),
      rollbackPrisma.studyTask.count({ where: { id: { startsWith: `exam-review-${rollbackSession.id}-` } } }),
      rollbackPrisma.studyPlan.findUniqueOrThrow({
        where: { id: rollbackPlanId },
        include: { tasks: { select: { id: true, scheduledDate: true }, orderBy: { id: 'asc' } } },
      }),
    ]);
    assert(failedSummary === null, 'failed review generation must not persist a review summary');
    assert(failedTaskCount === 0, 'failed review generation must not persist partial review tasks');
    assert(JSON.stringify(rollbackPlan.tasks) === JSON.stringify(rollbackScheduleBefore), 'failed review generation must roll back displaced task dates');
  } catch (error) {
    rollbackFailure = error;
  }
  try {
    await rollbackPrisma.$disconnect();
  } catch (error) {
    rollbackFailure ??= error;
  }
  if (rollbackFailure) throw rollbackFailure;
  const retriedRollbackReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${rollbackSession.id}`, {}, studentHeaders);
  assert(retriedRollbackReviewPlan.days.length === 3, 'review generation should succeed after the injected transaction failure is removed');
  const startedReviewTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(examReviewPlan.days[0].taskId)}/start`, {}, studentHeaders);
  assert(startedReviewTask.status === 'in_progress', 'a generated review task should start through the normal task endpoint');
  const preservedReviewPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let futureReviewsBeforeCompletion;
  try {
    futureReviewsBeforeCompletion = await preservedReviewPrisma.studyTask.findMany({
      where: { id: { in: examReviewPlan.days.slice(1).map((day) => day.taskId) } },
      orderBy: { id: 'asc' },
    });
    assert(futureReviewsBeforeCompletion.length === 2, 'review identity regression requires day 2 and day 3 tasks');
  } finally {
    await preservedReviewPrisma.$disconnect();
  }
  const completedReviewTask = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(examReviewPlan.days[0].taskId)}/complete`, {
    userId: registered.user.id,
    completedQuestionCount: examReviewPlan.days[0].questionCount,
    correctCount: examReviewPlan.days[0].questionCount,
    minutesSpent: examReviewPlan.days[0].minutes,
    selfRating: 4,
  }, studentHeaders);
  assert(completedReviewTask.completed === true, 'a generated review task should complete through the normal task endpoint');
  const preservedReviewCheckPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const futureReviewsAfterCompletion = await preservedReviewCheckPrisma.studyTask.findMany({
      where: { id: { in: examReviewPlan.days.slice(1).map((day) => day.taskId) } },
      orderBy: { id: 'asc' },
    });
    for (let index = 0; index < futureReviewsBeforeCompletion.length; index += 1) {
      for (const field of ['id', 'mode', 'questionCount', 'reason', 'nextAction', 'knowledgePointId', 'scheduledDate']) {
        assert(
          futureReviewsAfterCompletion[index][field] === futureReviewsBeforeCompletion[index][field],
          `completing day 1 must preserve future review ${futureReviewsBeforeCompletion[index].id} ${field}`,
        );
      }
    }
  } finally {
    await preservedReviewCheckPrisma.$disconnect();
  }
  const postponeCapacityPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let forcedFullPostponeDates;
  let postponePlanId;
  try {
    const postponePlan = await postponeCapacityPrisma.studyPlan.findFirstOrThrow({
      where: { userId: registered.user.id, status: 'ACTIVE' },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    postponePlanId = postponePlan.id;
    const postponedCandidate = postponePlan.tasks.find((task) => task.id === examReviewPlan.days[2].taskId);
    assert(postponedCandidate, 'postpone capacity regression requires the day 3 review task');
    const candidateDate = new Date(`${postponedCandidate.scheduledDate}T00:00:00.000Z`);
    forcedFullPostponeDates = Array.from({ length: 3 }, (_, index) => {
      const date = new Date(candidateDate);
      date.setUTCDate(candidateDate.getUTCDate() + index + 1);
      return date.toISOString().slice(0, 10);
    });
    for (const [dateIndex, forcedFullPostponeDate] of forcedFullPostponeDates.entries()) {
      const targetCount = postponePlan.tasks.filter((task) => task.scheduledDate === forcedFullPostponeDate).length;
      assert(targetCount <= 3, 'postpone capacity fixture dates must begin at or below capacity');
      if (targetCount >= 3) continue;
      await postponeCapacityPrisma.studyTask.createMany({
        data: Array.from({ length: 3 - targetCount }, (_, index) => ({
          id: `integration-postpone-capacity-${startedSession.id}-${dateIndex}-${index}`,
          planId: postponePlan.id,
          knowledgePointId: 'co-cache',
          subject: '计算机组成原理',
          chapter: '存储系统',
          title: `延期容量占位任务 ${index + 1}`,
          mode: '专项训练',
          minutes: 20,
          questionCount: 5,
          scheduledDate: forcedFullPostponeDate,
          priority: '中',
          reason: 'PostgreSQL integration capacity fixture',
          nextAction: '完成容量回归测试',
        })),
      });
    }
  } finally {
    await postponeCapacityPrisma.$disconnect();
  }
  const postponedReviewTask = await postJson(`${apiUrl}/tasks/${encodeURIComponent(examReviewPlan.days[2].taskId)}/postpone`, {}, studentHeaders);
  assert(postponedReviewTask.rescheduledDate > examReviewPlan.days[2].date, 'a generated review task should postpone through the normal task endpoint');
  assert(postponedReviewTask.rescheduledDate > forcedFullPostponeDates[2], 'postpone must skip three consecutive dates that already contain three tasks');
  const postponedCapacityCheckPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const groupedDates = await postponedCapacityCheckPrisma.studyTask.groupBy({
      by: ['scheduledDate'],
      where: { planId: postponePlanId },
      _count: { _all: true },
    });
    assert(groupedDates.every((item) => item._count._all <= 3), 'postpone must preserve the three-task daily capacity');
  } finally {
    await postponedCapacityCheckPrisma.$disconnect();
  }
  const persistedConcurrentReviewPlan = await postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders);
  const persistedPostponedReviewDay = persistedConcurrentReviewPlan.days.find((day) => day.taskId === postponedReviewTask.taskId);
  assert(persistedPostponedReviewDay?.date === postponedReviewTask.rescheduledDate, 'regenerated review plan should retain the postponed date for the exact task');
  const postPostponeReviewPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const persistedPostponedSummary = toExamReviewPlanResponse(
      await postPostponeReviewPrisma.examReviewPlan.findUniqueOrThrow({ where: { sessionId: startedSession.id } }),
    );
    assert(JSON.stringify(persistedConcurrentReviewPlan) === JSON.stringify(persistedPostponedSummary), 'regenerated response should equal the persisted postponed summary');
  } finally {
    await postPostponeReviewPrisma.$disconnect();
  }
  const staleLifecyclePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let staleStartTask;
  let staleCompleteTask;
  let externallyScheduledStartDate;
  let externallyScheduledCompleteDate;
  try {
    const activePlan = await staleLifecyclePrisma.studyPlan.findFirstOrThrow({
      where: { userId: registered.user.id, status: 'ACTIVE' },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    const candidates = activePlan.tasks.filter((task) =>
      task.status === 'pending'
      && task.mode !== '考后复盘'
      && !task.id.startsWith('exam-review-')
      && !task.id.startsWith('integration-postpone-capacity-'),
    );
    assert(candidates.length >= 2, 'stale lifecycle regression requires two pending ordinary tasks');
    [staleStartTask, staleCompleteTask] = candidates;
    const latestDate = activePlan.tasks.map((task) => task.scheduledDate).sort().at(-1);
    const externalStartDate = new Date(`${latestDate}T00:00:00.000Z`);
    externalStartDate.setUTCDate(externalStartDate.getUTCDate() + 2);
    externallyScheduledStartDate = externalStartDate.toISOString().slice(0, 10);
    const externalCompleteDate = new Date(externalStartDate);
    externalCompleteDate.setUTCDate(externalCompleteDate.getUTCDate() + 1);
    externallyScheduledCompleteDate = externalCompleteDate.toISOString().slice(0, 10);
    await staleLifecyclePrisma.$transaction([
      staleLifecyclePrisma.studyTask.update({
        where: { id: staleStartTask.id },
        data: { scheduledDate: externallyScheduledStartDate },
      }),
      staleLifecyclePrisma.studyTask.update({
        where: { id: staleCompleteTask.id },
        data: { scheduledDate: externallyScheduledCompleteDate },
      }),
    ]);
  } finally {
    await staleLifecyclePrisma.$disconnect();
  }
  const staleStartResult = await postJson(`${apiUrl}/tasks/${encodeURIComponent(staleStartTask.id)}/start`, {}, studentHeaders);
  assert(staleStartResult.status === 'in_progress', 'stale-cache start regression should start the owned task');
  const staleCompleteResult = await postJson(`${apiUrl}/study-tasks/${encodeURIComponent(staleCompleteTask.id)}/complete`, {
    completedQuestionCount: staleCompleteTask.questionCount,
    correctCount: staleCompleteTask.questionCount,
    minutesSpent: staleCompleteTask.minutes,
    selfRating: 4,
  }, studentHeaders);
  assert(staleCompleteResult.completed === true, 'stale-cache completion regression should complete the owned task');
  const staleLifecycleCheckPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const [startedRow, completedRow] = await Promise.all([
      staleLifecycleCheckPrisma.studyTask.findUniqueOrThrow({ where: { id: staleStartTask.id } }),
      staleLifecycleCheckPrisma.studyTask.findUniqueOrThrow({ where: { id: staleCompleteTask.id } }),
    ]);
    assert(startedRow.scheduledDate === externallyScheduledStartDate, 'start must not overwrite a concurrently committed scheduled date');
    assert(completedRow.scheduledDate === externallyScheduledCompleteDate, 'complete must not overwrite a concurrently committed scheduled date');
  } finally {
    await staleLifecycleCheckPrisma.$disconnect();
  }
  const lifecycleRacePrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  let raceStartTask;
  let racePostponeTask;
  let raceCompleteTask;
  try {
    const activePlan = await lifecycleRacePrisma.studyPlan.findFirstOrThrow({
      where: { userId: registered.user.id, status: 'ACTIVE' },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    const candidates = activePlan.tasks.filter((task) =>
      task.status === 'pending'
      && task.mode !== '考后复盘'
      && !task.id.startsWith('exam-review-')
      && !task.id.startsWith('integration-postpone-capacity-'),
    );
    assert(candidates.length >= 3, 'review lifecycle races require three pending ordinary tasks');
    [raceStartTask, racePostponeTask, raceCompleteTask] = candidates;
  } finally {
    await lifecycleRacePrisma.$disconnect();
  }
  const [raceStartResult, raceStartReviewPlan] = await Promise.all([
    postJson(`${apiUrl}/tasks/${encodeURIComponent(raceStartTask.id)}/start`, {}, studentHeaders),
    postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders),
  ]);
  assert(raceStartResult.status === 'in_progress' && raceStartReviewPlan.days.length === 3, 'review generation racing with start should preserve both results');
  const [racePostponeReviewPlan, racePostponeResult] = await Promise.all([
    postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders),
    postJson(`${apiUrl}/tasks/${encodeURIComponent(racePostponeTask.id)}/postpone`, {}, studentHeaders),
  ]);
  assert(racePostponeReviewPlan.days.length === 3 && racePostponeResult.rescheduledDate, 'review generation racing with postpone should preserve both results');
  const [raceCompleteResult, raceCompleteReviewPlan] = await Promise.all([
    postJson(`${apiUrl}/study-tasks/${encodeURIComponent(raceCompleteTask.id)}/complete`, {
      completedQuestionCount: raceCompleteTask.questionCount,
      correctCount: raceCompleteTask.questionCount,
      minutesSpent: raceCompleteTask.minutes,
      selfRating: 4,
    }, studentHeaders),
    postJson(`${apiUrl}/exam/review-tasks/${startedSession.id}`, {}, studentHeaders),
  ]);
  assert(raceCompleteResult.completed === true && raceCompleteReviewPlan.days.length === 3, 'review generation racing with completion should preserve both results');
  const lifecycleRaceCheckPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const [startedRow, postponedRow, completedRow, groupedDates] = await Promise.all([
      lifecycleRaceCheckPrisma.studyTask.findUniqueOrThrow({ where: { id: raceStartTask.id } }),
      lifecycleRaceCheckPrisma.studyTask.findUniqueOrThrow({ where: { id: racePostponeTask.id } }),
      lifecycleRaceCheckPrisma.studyTask.findUniqueOrThrow({ where: { id: raceCompleteTask.id } }),
      lifecycleRaceCheckPrisma.studyTask.groupBy({
        by: ['scheduledDate'],
        where: { planId: postponePlanId },
        _count: { _all: true },
      }),
    ]);
    assert(startedRow.status === 'in_progress', 'start status should survive concurrent review generation');
    assert(postponedRow.status === 'postponed' && postponedRow.scheduledDate === racePostponeResult.rescheduledDate, 'postpone state should survive concurrent review generation');
    assert(completedRow.status === 'completed', 'completion status should survive concurrent review generation');
    assert(groupedDates.every((item) => item._count._all <= 3), 'lifecycle races must preserve daily task capacity');
  } finally {
    await lifecycleRaceCheckPrisma.$disconnect();
  }
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
  assert(twiceRestoredReviewPlan.generatedAt === persistedConcurrentGeneratedAt, 'post-exam review plan should be restored instead of regenerated');
  const restoredPostponedReviewDay = twiceRestoredReviewPlan.days.find((day) => day.taskId === postponedReviewTask.taskId);
  assert(restoredPostponedReviewDay?.date === postponedReviewTask.rescheduledDate, 'restarted review plan should retain the postponed date for the exact task');
  assert(JSON.stringify(twiceRestoredReviewPlan) === JSON.stringify(persistedConcurrentReviewPlan), 'the complete persisted review summary should survive restart');
  const restartTodayPlan = await getJson(`${apiUrl}/today/plan`, studentHeaders);
  assert(restartTodayPlan.weekProgress.every((day) => day.taskCount <= 3), 'Today Plan should retain at most three tasks per day after restart');

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
    await rm(join(temporaryPrisma, 'migrations', '20260716150000_review_schedule_recovery'), { recursive: true, force: true });
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
    const legacyReviewFixtureStatements = [
      `INSERT INTO "User" ("id", "name", "role", "createdAt", "updatedAt")
      VALUES ('legacy-review-user', '历史复习用户', 'STUDENT', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
      `
      INSERT INTO "KnowledgePoint" ("id", "subject", "chapter", "title", "importance", "frequency", "prerequisites", "createdAt", "updatedAt")
      VALUES
        ('legacy-review-point-a', 'COMPUTER_ORGANIZATION', '缓存', '迁移错题 A', 5, 5, ARRAY[]::TEXT[], '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
        ('legacy-review-point-b', 'COMPUTER_ORGANIZATION', '缓存', '迁移错题 B', 5, 5, ARRAY[]::TEXT[], '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
      `
      INSERT INTO "Question" ("id", "stem", "options", "answer", "analysis", "difficulty", "type", "source", "expectedTimeSec", "createdAt", "updatedAt")
      VALUES
        ('legacy-review-question-a', '迁移测试题 A', ARRAY['A', 'B'], 'A', '迁移解析 A', 'MEDIUM', 'SINGLE_CHOICE', 'migration-fixture', 100, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
        ('legacy-review-question-b', '迁移测试题 B', ARRAY['A', 'B'], 'A', '迁移解析 B', 'MEDIUM', 'SINGLE_CHOICE', 'migration-fixture', 100, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
      `
      INSERT INTO "QuestionKnowledgePoint" ("questionId", "knowledgePointId")
      VALUES
        ('legacy-review-question-a', 'legacy-review-point-a'),
        ('legacy-review-question-b', 'legacy-review-point-b')`,
      `
      INSERT INTO "PracticeRecord" ("id", "userId", "questionId", "knowledgePointId", "selectedAnswer", "correct", "timeSpentSec", "expectedTimeSec", "mistakeReason", "submittedAt")
      VALUES
        ('legacy-record-initial', 'legacy-review-user', 'legacy-review-question-a', 'legacy-review-point-a', 'B', false, 120, 100, '概念不清', '2026-07-01T09:00:00Z'),
        ('legacy-record-relapse', 'legacy-review-user', 'legacy-review-question-a', 'legacy-review-point-a', 'B', false, 131, 100, '知识点混淆', '2026-07-03T09:00:00Z'),
        ('legacy-record-learning', 'legacy-review-user', 'legacy-review-question-b', 'legacy-review-point-b', 'B', false, 88, 100, '审题问题', '2026-07-04T09:00:00Z')`,
      `
      INSERT INTO "ReviewSchedule" ("id", "userId", "questionId", "inferredReason", "selfReportedReason", "consecutiveCorrect", "stability", "nextReviewAt", "reviewCount", "lastReviewedAt", "createdAt", "updatedAt")
      VALUES
        ('legacy-review-relapse', 'legacy-review-user', 'legacy-review-question-a', '概念不清', '概念不清', 3, 'mastered', '2026-07-16T09:00:00Z', 3, '2026-07-02T09:00:00Z', '2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'),
        ('legacy-review-learning', 'legacy-review-user', 'legacy-review-question-b', '审题问题', '审题问题', 0, 'learning', '2026-07-05T09:00:00Z', 0, NULL, '2026-07-04T09:00:00Z', '2026-07-04T09:00:00Z')`,
      `
      INSERT INTO "ReviewAttempt" ("id", "scheduleId", "redoCorrect", "timeSpentSec", "reportedReason", "inferredReason", "nextIntervalDays", "reviewedAt")
      VALUES ('legacy-review-attempt', 'legacy-review-relapse', true, 76, '概念不清', '概念不清', 14, '2026-07-02T09:00:00Z')`,
    ];
    for (const statement of legacyReviewFixtureStatements) {
      await fixturePrisma.$executeRawUnsafe(statement);
    }
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

function toExamReviewPlanResponse(row) {
  return {
    userId: row.userId,
    examSessionId: row.sessionId,
    generatedAt: row.createdAt.toISOString(),
    examAccuracyRate: row.examAccuracyRate,
    weakPointTitles: row.weakPointTitles,
    days: row.days,
    recommendation: row.recommendation,
  };
}

async function waitForAdvisoryLockWaiter(prisma, blockerPid, excludedPids, operationName) {
  const deadline = Date.now() + 5_000;
  do {
    const waiters = await prisma.$queryRaw`
      SELECT waiter.pid
      FROM pg_locks AS waiter
      JOIN pg_locks AS blocker
        ON blocker.locktype = waiter.locktype
        AND blocker.database = waiter.database
        AND blocker.classid = waiter.classid
        AND blocker.objid = waiter.objid
        AND blocker.objsubid = waiter.objsubid
      WHERE blocker.pid = ${blockerPid}
        AND blocker.locktype = 'advisory'
        AND blocker.granted = true
        AND waiter.granted = false
      ORDER BY waiter.waitstart, waiter.pid
    `;
    const waiter = waiters.find((row) => Number.isInteger(row?.pid) && !excludedPids.includes(row.pid));
    if (waiter) return waiter.pid;
    await delay(10);
  } while (Date.now() < deadline);
  throw new Error(`${operationName} did not queue on the shared PostgreSQL advisory lock`);
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
