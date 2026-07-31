import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  approveReviewItem,
  createManagedUser,
  createTemporaryPassword,
  disableAdminUser,
  fetchAdminMetrics,
  fetchAdminUsers,
  fetchReviewQueue,
  isStaticDemoMode,
  markReviewItemNeedsRecheck,
  restoreAdminUser,
  updateAdminUserTrialStatus,
  type AdminMetrics,
  type AdminUserManagement,
  type ReviewQueue,
  type TrialStatus,
} from '../../api';
import type { ApiState } from '../../components/ApiStateIndicator';
import { trialStatusLabel } from '../../constants';
import { isMockAllowed } from '../../api/env';

interface AdminWorkspaceActionsOptions {
  users: AdminUserManagement | null;
  setUsers: (action: SetStateAction<AdminUserManagement>) => void;
  setMetrics: (action: SetStateAction<AdminMetrics>) => void;
  setReviewQueue: (action: SetStateAction<ReviewQueue>) => void;
  setApiState: Dispatch<SetStateAction<ApiState>>;
}

export function useAdminWorkspaceActions(options: AdminWorkspaceActionsOptions) {
  const [reviewStatus, setReviewStatus] = useState('教师题目和 AI 生成内容会进入审核队列。');
  const [userStatus, setUserStatus] = useState('管理员可以跟踪试用名单状态，方便后续邀请填写问卷。');

  async function approveItem(reviewItemId: string) {
    setReviewStatus('正在提交审核结果...');
    try {
      await approveReviewItem({ reviewItemId, reviewerId: 'admin-001' });
      const [nextQueue, nextMetrics] = await Promise.all([fetchReviewQueue(), fetchAdminMetrics()]);
      options.setReviewQueue(nextQueue);
      options.setMetrics(nextMetrics);
      options.setApiState('connected');
      setReviewStatus(`审核已通过，当前仍有 ${nextQueue.pendingCount} 项待处理。`);
    } catch {
      setReviewStatus('审核提交失败，请稍后重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function markNeedsRecheck(reviewItemId: string) {
    setReviewStatus('正在标记复查...');
    try {
      await markReviewItemNeedsRecheck({ reviewItemId, reviewerId: 'admin-001' });
      const nextQueue = await fetchReviewQueue();
      options.setReviewQueue(nextQueue);
      options.setApiState('connected');
      setReviewStatus(`已标记复查，当前仍有 ${nextQueue.pendingCount} 项待处理。`);
    } catch {
      setReviewStatus('复查标记失败，请稍后重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function updateTrialStatus(userId: string, trialStatus: TrialStatus) {
    const student = options.users?.users.find((user) => user.id === userId && user.role === 'student');
    if (!student || !options.users) {
      setUserStatus('未找到可更新的学生账号，请重试用户管理模块。');
      return;
    }
    setUserStatus('正在更新试用名单状态...');
    if (isStaticDemoMode()) {
      const nextUsers = options.users.users.map((user) => user.id === student.id
        ? {
            ...user,
            trialStatus,
            nextAction: trialStatus === 'follow_up'
              ? '联系学生填写问卷，并追问最影响备考效率的功能缺口。'
              : user.nextAction,
          }
        : user);
      options.setUsers({
        ...options.users,
        generatedAt: new Date().toISOString(),
        summary: {
          totalUsers: nextUsers.length,
          studentCount: nextUsers.filter((user) => user.role === 'student').length,
          activeTrialCount: nextUsers.filter((user) => user.trialStatus === 'active').length,
          followUpCount: nextUsers.filter((user) => user.trialStatus === 'follow_up').length,
        },
        users: nextUsers,
      });
      setUserStatus(`已将 ${student.name} 更新为“${trialStatusLabel[trialStatus]}”。`);
      return;
    }
    try {
      const updated = await updateAdminUserTrialStatus({ userId: student.id, trialStatus });
      options.setUsers(await fetchAdminUsers());
      options.setApiState('connected');
      setUserStatus(`已将 ${updated.name} 更新为“${trialStatusLabel[trialStatus]}”。`);
    } catch {
      setUserStatus('试用状态更新失败，当前保留原名单。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function setAccountStatus(userId: string, accountStatus: 'active' | 'disabled') {
    setUserStatus(accountStatus === 'disabled' ? '正在停用账号...' : '正在恢复账号...');
    try {
      if (accountStatus === 'disabled') await disableAdminUser(userId);
      else await restoreAdminUser(userId);
      options.setUsers(await fetchAdminUsers());
      options.setApiState('connected');
      setUserStatus(accountStatus === 'disabled' ? '账号已停用，旧会话已失效。' : '账号已恢复。');
    } catch {
      setUserStatus('账号状态更新失败，请重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function createUserTemporaryPassword(userId: string) {
    setUserStatus('正在生成临时密码...');
    try {
      const result = await createTemporaryPassword(userId);
      options.setUsers(await fetchAdminUsers());
      options.setApiState('connected');
      setUserStatus(`临时密码：${result.temporaryPassword}`);
    } catch {
      setUserStatus('临时密码生成失败，请重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function createInternalUser(input: { email: string; name: string; role: 'teacher' | 'admin' }) {
    setUserStatus('正在创建内部账号...');
    try {
      const result = await createManagedUser(input);
      options.setUsers(await fetchAdminUsers());
      options.setApiState('connected');
      setUserStatus(`${result.user.name} 已创建，必须使用临时密码首次登录并改密。`);
      return result.temporaryPassword;
    } catch {
      setUserStatus('内部账号创建失败，请重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
      return null;
    }
  }

  return {
    reviewStatus,
    userStatus,
    approveItem,
    markNeedsRecheck,
    updateTrialStatus,
    setAccountStatus,
    createUserTemporaryPassword,
    createInternalUser,
  };
}
