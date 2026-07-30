import { ClipboardCheck } from 'lucide-react';
import type { AdminMetrics, AdminUserManagement, FeedbackList, ReviewQueue, SystemConfig, TeacherStudentAuthorizationList } from '../../api';
import { ModuleInlineUnavailable, ModuleResourceMeta, ModuleUnavailable } from '../../components/ModuleResourceState';
import { riskLabel, reviewStatusLabel, roleLabel, trialStatusLabel } from '../../constants';
import type { ModuleResource } from '../../hooks/moduleResource';
import { InvitationManagementPanel } from './InvitationManagementPanel';
import { ManagedUserCreationPanel } from './ManagedUserCreationPanel';
import { StudentAccountActions } from './StudentAccountActions';
import { TeacherAuthorizationPanel } from './TeacherAuthorizationPanel';

interface AdminWorkspaceProps {
  metrics: ModuleResource<AdminMetrics>;
  users: ModuleResource<AdminUserManagement>;
  feedback: ModuleResource<FeedbackList>;
  reviewQueue: ModuleResource<ReviewQueue>;
  systemConfig: ModuleResource<SystemConfig>;
  teacherAuthorizations: ModuleResource<TeacherStudentAuthorizationList>;
  userStatus: string;
  reviewStatus: string;
  configStatus: string;
  onRetryMetrics: () => void;
  onRetryUsers: () => void;
  onRetryFeedback: () => void;
  onRetryReviewQueue: () => void;
  onRetrySystemConfig: () => void;
  onRetryTeacherAuthorizations: () => void;
  onGrantTeacherAuthorization: (teacherId: string, studentId: string) => Promise<void>;
  onRevokeTeacherAuthorization: (teacherId: string, studentId: string) => Promise<void>;
  onUpdateTrialStatus: (userId: string, trialStatus: 'invited' | 'active' | 'completed' | 'follow_up') => void;
  onSetAccountStatus: (userId: string, accountStatus: 'active' | 'disabled') => Promise<void>;
  onCreateTemporaryPassword: (userId: string) => Promise<void>;
  onCreateManagedUser: (input: { email: string; name: string; role: 'teacher' | 'admin' }) => Promise<string | null>;
  onApproveReviewItem: (itemId: string) => void;
  onMarkReviewItemNeedsRecheck: (itemId: string) => void;
  onApplySprintConfig: () => void;
}

export function AdminWorkspace(props: AdminWorkspaceProps) {
  const metrics = props.metrics.data;
  const feedback = props.feedback.data;
  const users = props.users.data;
  const reviewQueue = props.reviewQueue.data;
  const systemConfig = props.systemConfig.data;

  return (
    <>
      {metrics ? (
        <section id="admin" className="panel admin-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">管理端数据看板</p><h3>试用期核心运营指标</h3></div>
            <span>更新于 {new Date(metrics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <ModuleResourceMeta resource={props.metrics} onRetry={props.onRetryMetrics} />
          <div className="admin-grid">
            <article><strong>{metrics.activeStudentCount}</strong><span>活跃学生</span></article>
            <article><strong>{metrics.questionCount}</strong><span>题库题目</span></article>
            <article><strong>{metrics.practiceRecordCount}</strong><span>练习记录</span></article>
            <article><strong>{metrics.accuracyRate}%</strong><span>整体正确率</span></article>
            <article><strong>{metrics.pendingReviewCount}</strong><span>待审核内容</span></article>
            <article><strong>{metrics.todayPracticeCount}</strong><span>今日练习</span></article>
          </div>
          <p className="task-status">当前最弱考点：{metrics.topWeakPoint ?? '暂无'} · 平均耗时 {metrics.averagePracticeTimeSec} 秒 · 留存学习日 {metrics.retentionDays} 天</p>
          <div className="panel-heading admin-core-heading">
            <div><p className="eyebrow">可靠内测指标</p><h4>学习闭环与系统质量</h4></div>
            <span>无样本时显示“待积累”</span>
          </div>
          <div className="admin-grid admin-core-grid">
            {coreMetricEntries.map(([key, label]) => {
              const metric = metrics.core[key];
              return (
                <article key={key} title={`${metric.window}，${metric.numerator}/${metric.denominator}`}>
                  <strong>{metric.rate === null ? '待积累' : `${metric.rate}%`}</strong>
                  <span>{label}</span>
                  <small>{metric.window} · {metric.numerator}/{metric.denominator}</small>
                </article>
              );
            })}
          </div>
          {feedback ? (
            <>
              <ModuleResourceMeta resource={props.feedback} onRetry={props.onRetryFeedback} />
              <p className="task-status">试用反馈：{feedback.totalCount} 条 · 平均评分 {feedback.averageRating} · {feedback.items[0]?.message ?? '暂无反馈'}</p>
            </>
          ) : (
            <ModuleInlineUnavailable title="内测反馈" resource={props.feedback} onRetry={props.onRetryFeedback} />
          )}
        </section>
      ) : (
        <ModuleUnavailable id="admin" title="运营指标" resource={props.metrics} onRetry={props.onRetryMetrics} />
      )}

      <InvitationManagementPanel />
      <ManagedUserCreationPanel onCreateManagedUser={props.onCreateManagedUser} />

      {users ? (
        <section className="panel admin-users-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">用户管理</p><h3>试用名单与角色状态</h3></div>
            <span>逐个维护学生内测进度</span>
          </div>
          <ModuleResourceMeta resource={props.users} onRetry={props.onRetryUsers} />
          <p className="task-status">{props.userStatus}</p>
          <div className="admin-users-summary">
            <article><strong>{users.summary.totalUsers}</strong><span>全部账号</span></article>
            <article><strong>{users.summary.studentCount}</strong><span>学生账号</span></article>
            <article><strong>{users.summary.activeTrialCount}</strong><span>试用中</span></article>
            <article><strong>{users.summary.followUpCount}</strong><span>待回访</span></article>
          </div>
          <div className="admin-users-list">
            {users.users.map((user) => (
              <article key={user.id}>
                <div><strong>{user.name}</strong><span>{roleLabel[user.role]} · {trialStatusLabel[user.trialStatus]}</span></div>
                <div>
                  <span>{user.stage ?? '账号管理'}{user.targetScore ? ` · 目标 ${user.targetScore} 分` : ''}</span>
                  <small>{user.targetSchool ?? '平台账号'} · 最近活跃 {user.lastActiveAt}</small>
                </div>
                <p>{user.nextAction}</p>
                <StudentAccountActions
                  user={user}
                  onSetStatus={props.onSetAccountStatus}
                  onCreateTemporaryPassword={props.onCreateTemporaryPassword}
                />
                {user.role === 'student' ? (
                  <label className="trial-status-control">
                    <span>内测状态</span>
                    <select
                      value={user.trialStatus}
                      onChange={(event) => props.onUpdateTrialStatus(user.id, event.target.value as 'invited' | 'active' | 'completed' | 'follow_up')}
                    >
                      <option value="invited">已邀请</option>
                      <option value="active">试用中</option>
                      <option value="completed">已完成</option>
                      <option value="follow_up">待回访</option>
                    </select>
                  </label>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <ModuleUnavailable title="用户管理" resource={props.users} onRetry={props.onRetryUsers} />
      )}

      {users ? (
        <TeacherAuthorizationPanel
          users={users}
          authorizations={props.teacherAuthorizations}
          onRetry={props.onRetryTeacherAuthorizations}
          onGrant={props.onGrantTeacherAuthorization}
          onRevoke={props.onRevokeTeacherAuthorization}
        />
      ) : null}

      {reviewQueue ? (
        <section id="review" className="panel review-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">管理端内容审核</p><h3>待审核 {reviewQueue.pendingCount} 项 · 已通过 {reviewQueue.approvedCount} 项</h3></div>
            <span>更新于 {new Date(reviewQueue.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <ModuleResourceMeta resource={props.reviewQueue} onRetry={props.onRetryReviewQueue} />
          <p className="task-status">{props.reviewStatus}</p>
          <div className="review-list">
            {reviewQueue.items.length ? reviewQueue.items.map((item) => (
              <article key={item.id} className={`review-row ${item.status}`}>
                <div>
                  <strong>{item.contentType === 'question' ? '题目审核' : 'AI 答疑审核'} · {item.title}</strong>
                  <p>{item.summary}</p>
                  <div className="review-meta">
                    <span>风险：{riskLabel[item.riskLevel]} · 状态：{reviewStatusLabel[item.status]}</span>
                    <span>原因：{item.reviewReason ?? '需要管理员确认内容质量。'}</span>
                    <span>建议：{item.suggestedAction ?? '确认无误后通过，存在疑问则标记复查。'}</span>
                  </div>
                </div>
                <div className="review-actions">
                  <button type="button" disabled={item.status === 'approved'} onClick={() => props.onApproveReviewItem(item.id)}>{item.status === 'approved' ? '已通过' : '通过'}</button>
                  <button type="button" disabled={item.status === 'approved' || item.status === 'needs_recheck'} onClick={() => props.onMarkReviewItemNeedsRecheck(item.id)}>{item.status === 'needs_recheck' ? '已复查标记' : '标记复查'}</button>
                </div>
              </article>
            )) : <article className="review-empty"><strong>暂无待审核内容</strong><span>新增教师题目或生成 AI 答疑后会自动进入这里。</span></article>}
          </div>
        </section>
      ) : (
        <ModuleUnavailable id="review" title="内容审核" resource={props.reviewQueue} onRetry={props.onRetryReviewQueue} />
      )}

      {systemConfig ? (
        <section id="config" className="panel config-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">管理端系统配置</p><h3>推荐策略参数</h3></div>
            <button type="button" className="secondary-action" onClick={props.onApplySprintConfig}><ClipboardCheck size={18} /> 应用冲刺配置</button>
          </div>
          <ModuleResourceMeta resource={props.systemConfig} onRetry={props.onRetrySystemConfig} />
          <p className="task-status">{props.configStatus}</p>
          <div className="config-grid">
            <article><strong>{systemConfig.recommendation.stageAssessmentQuestionLimit}</strong><span>阶段测评题量上限</span></article>
            <article><strong>{systemConfig.recommendation.dailyTargetQuestionCount}</strong><span>每日推荐题量</span></article>
            <article><strong>{systemConfig.recommendation.speedRiskMultiplier.toFixed(2)}x</strong><span>速度风险阈值</span></article>
            <article><strong>{systemConfig.updatedBy}</strong><span>最近更新人</span></article>
          </div>
        </section>
      ) : (
        <ModuleUnavailable id="config" title="系统配置" resource={props.systemConfig} onRetry={props.onRetrySystemConfig} />
      )}
    </>
  );
}

const coreMetricEntries = [
  ['registrationCompletionRate', '注册完成率'],
  ['diagnosticCompletionRate', '诊断完成率'],
  ['firstTaskCompletionRate', '首任务完成率'],
  ['day1RetentionRate', '次日留存'],
  ['day7RetentionRate', '七日留存'],
  ['weeklyPlanCompletionRate', '周计划完成率'],
  ['wrongQuestionSecondAccuracyRate', '错题二次正确率'],
  ['mockExamCompletionRate', '模拟考试完成率'],
  ['apiFailureRate', '接口失败率'],
  ['sessionRecoverySuccessRate', '会话恢复成功率'],
] as const;
