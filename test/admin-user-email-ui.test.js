import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('admin user cards show email and a legacy fallback', async () => {
  const vite = await createServer({
    root: 'apps/web',
    configFile: 'apps/web/vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { AdminWorkspace } = await vite.ssrLoadModule(
      '/src/features/admin/AdminWorkspace.tsx',
    );
    const users = {
      source: 'postgresql',
      generatedAt: '2026-07-31T00:00:00.000Z',
      summary: { totalUsers: 2, studentCount: 1, activeTrialCount: 2, followUpCount: 0 },
      users: [
        {
          id: 'student-1',
          name: '测试学生',
          email: 'student-test-001@example.com',
          role: 'student',
          trialStatus: 'active',
          lastActiveAt: '2026-07-31T00:00:00.000Z',
          nextAction: '继续测试',
        },
        {
          id: 'legacy-admin',
          name: '旧管理员',
          role: 'admin',
          trialStatus: 'active',
          lastActiveAt: '2026-07-31T00:00:00.000Z',
          nextAction: '维护平台',
        },
      ],
    };
    const ready = (data) => ({
      data,
      state: 'ready',
      lastSyncAt: '2026-07-31T00:00:00.000Z',
    });
    const unavailable = { data: null, state: 'loading' };
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(AdminWorkspace, {
      metrics: unavailable,
      users: ready(users),
      feedback: unavailable,
      reviewQueue: unavailable,
      systemConfig: unavailable,
      teacherAuthorizations: unavailable,
      userStatus: '',
      reviewStatus: '',
      configStatus: '',
      onRetryMetrics: noop,
      onRetryUsers: noop,
      onRetryFeedback: noop,
      onRetryReviewQueue: noop,
      onRetrySystemConfig: noop,
      onRetryTeacherAuthorizations: noop,
      onGrantTeacherAuthorization: async () => {},
      onRevokeTeacherAuthorization: async () => {},
      onUpdateTrialStatus: noop,
      onSetAccountStatus: async () => {},
      onCreateTemporaryPassword: async () => {},
      onCreateManagedUser: async () => null,
      onApproveReviewItem: noop,
      onMarkReviewItemNeedsRecheck: noop,
      onApplySprintConfig: noop,
    }));
    assert.match(html, /student-test-001@example\.com/);
    assert.match(html, /未设置邮箱/);
  } finally {
    await vite.close();
  }
});
