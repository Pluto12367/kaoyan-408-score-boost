import { ClipboardCheck } from 'lucide-react';
import type {
  AdminMetrics,
  AdminUserManagement,
  FeedbackList,
  ReviewQueue,
  SystemConfig,
} from '../../api';
import { riskLabel, reviewStatusLabel, roleLabel, trialStatusLabel } from '../../constants';

interface AdminWorkspaceProps {
  metrics: AdminMetrics;
  users: AdminUserManagement;
  feedback: FeedbackList;
  reviewQueue: ReviewQueue;
  systemConfig: SystemConfig;
  userStatus: string;
  reviewStatus: string;
  configStatus: string;
  onMarkTrialFollowUp: () => void;
  onApproveReviewItem: (itemId: string) => void;
  onMarkReviewItemNeedsRecheck: (itemId: string) => void;
  onApplySprintConfig: () => void;
}

export function AdminWorkspace({
  metrics,
  users,
  feedback,
  reviewQueue,
  systemConfig,
  userStatus,
  reviewStatus,
  configStatus,
  onMarkTrialFollowUp,
  onApproveReviewItem,
  onMarkReviewItemNeedsRecheck,
  onApplySprintConfig,
}: AdminWorkspaceProps) {
  return (
    <>
      <section id="admin" className="panel admin-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">管理端数据看板</p>
            <h3>试用期核心运营指标</h3>
          </div>
          <span>更新于 {new Date(metrics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="admin-grid">
          <article><strong>{metrics.activeStudentCount}</strong><span>活跃学生</span></article>
          <article><strong>{metrics.questionCount}</strong><span>题库题目</span></article>
          <article><strong>{metrics.practiceRecordCount}</strong><span>练习记录</span></article>
          <article><strong>{metrics.accuracyRate}%</strong><span>整体正确率</span></article>
          <article><strong>{metrics.pendingReviewCount}</strong><span>待审核内容</span></article>
          <article><strong>{metrics.todayPracticeCount}</strong><span>今日练习</span></article>
        </div>
        <p className="task-status">
          当前最弱考点：{metrics.topWeakPoint ?? '暂无'} · 平均耗时 {metrics.averagePracticeTimeSec} 秒 · 留存学习日 {metrics.retentionDays} 天
        </p>
        <p className="task-status">
          试用反馈：{feedback.totalCount} 条 · 平均评分 {feedback.averageRating} · {feedback.items[0]?.message ?? '暂无反馈'}
        </p>
      </section>

      <section className="panel admin-users-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">用户管理</p><h3>试用名单与角色状态</h3></div>
          <button type="button" className="secondary-action" onClick={onMarkTrialFollowUp}>标记学生待回访</button>
        </div>
        <p className="task-status">{userStatus}</p>
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
                <small>{user.targetSchool ?? '平台演示账号'} · 最近活跃 {user.lastActiveAt}</small>
              </div>
              <p>{user.nextAction}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="review" className="panel review-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">管理端内容审核</p><h3>待审核 {reviewQueue.pendingCount} 项 · 已通过 {reviewQueue.approvedCount} 项</h3></div>
          <span>更新于 {new Date(reviewQueue.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p className="task-status">{reviewStatus}</p>
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
                <button type="button" disabled={item.status === 'approved'} onClick={() => onApproveReviewItem(item.id)}>
                  {item.status === 'approved' ? '已通过' : '通过'}
                </button>
                <button type="button" disabled={item.status === 'approved' || item.status === 'needs_recheck'} onClick={() => onMarkReviewItemNeedsRecheck(item.id)}>
                  {item.status === 'needs_recheck' ? '已复查标记' : '标记复查'}
                </button>
              </div>
            </article>
          )) : (
            <article className="review-empty"><strong>暂无待审核内容</strong><span>新增教师题目或生成 AI 答疑后会自动进入这里。</span></article>
          )}
        </div>
      </section>

      <section id="config" className="panel config-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">管理端系统配置</p><h3>推荐策略参数</h3></div>
          <button type="button" className="secondary-action" onClick={onApplySprintConfig}><ClipboardCheck size={18} /> 应用冲刺配置</button>
        </div>
        <p className="task-status">{configStatus}</p>
        <div className="config-grid">
          <article><strong>{systemConfig.recommendation.stageAssessmentQuestionLimit}</strong><span>阶段测评题量上限</span></article>
          <article><strong>{systemConfig.recommendation.dailyTargetQuestionCount}</strong><span>每日推荐题量</span></article>
          <article><strong>{systemConfig.recommendation.speedRiskMultiplier.toFixed(2)}x</strong><span>速度风险阈值</span></article>
          <article><strong>{systemConfig.updatedBy}</strong><span>最近更新人</span></article>
        </div>
      </section>
    </>
  );
}
