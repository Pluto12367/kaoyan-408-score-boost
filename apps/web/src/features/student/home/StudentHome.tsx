import { lazy, Suspense } from 'react';
import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../../api';
import type { RoleSection } from '../../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../../api/endpoints/onboarding';
import type { TodayPlanTask } from '../../onboarding/todayLearningRoute';
import { StudentLearningConsole } from '../StudentLearningConsole';
import { sectionFallback } from '../../../components/sectionFallback';

const TodayPlan = lazy(() => import('../../../components/TodayPlan').then((m) => ({ default: m.TodayPlan })));
const TodaysScoreCenter = lazy(() => import('../../today-score-center/TodaysScoreCenter').then((m) => ({ default: m.TodaysScoreCenter })));

interface StudentHomeProps {
  student: UserProfile;
  report: WeaknessReport;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar;
  planFocusTaskId: string | null;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
  onRefreshTodayPlan: () => void;
  onOpenReview?: (questionId: string) => void;
}

export function StudentHome({
  student,
  report,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  wrongQuestionSummary,
  masteryMap,
  learningCalendar,
  planFocusTaskId,
  onNavigate,
  onLaunchTodayTask,
  onRefreshTodayPlan,
  onOpenReview,
}: StudentHomeProps) {
  const task = todayPlan?.priorityTasks.find((item) => item.status !== 'completed' && !item.completed) ?? null;

  return (
    <div className="student-home">
      <div className="student-home-grid">
        <StudentLearningConsole
          student={student}
          report={report}
          todayPlan={todayPlan}
          todayPlanLoading={todayPlanLoading}
          todayPlanError={todayPlanError}
          wrongQuestionSummary={wrongQuestionSummary}
          masteryMap={masteryMap}
          learningCalendar={learningCalendar}
          onNavigate={onNavigate}
          onLaunchTodayTask={onLaunchTodayTask}
        />
      </div>

      <section className="panel" aria-label="学习日历">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">学习日历</p>
            <h3>连续学习 {learningCalendar.streakDays} 天</h3>
          </div>
          <span>今日 {learningCalendar.today.completedTaskCount} 项任务 · {learningCalendar.today.practiceCount} 次练习</span>
        </div>
        <div className="calendar-strip">
          {learningCalendar.days.map((day) => (
            <div key={day.date} className={`calendar-day ${day.isActive ? 'active' : ''}`}>
              <strong>{day.date.slice(5)}</strong>
              <span>{day.completedTaskCount + day.practiceCount}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel student-home-plan-card" aria-label="今日计划入口">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">今日最重要任务</p>
            <h3>{task ? task.title : '今日任务'}</h3>
          </div>
          <button type="button" className="secondary-action" onClick={onRefreshTodayPlan}>刷新</button>
        </div>
        {todayPlan ? (
          <Suspense fallback={sectionFallback('今日计划')}>
            <TodayPlan
              plan={todayPlan}
              student={student}
              focusTaskId={planFocusTaskId}
              onRefresh={async () => {
                onRefreshTodayPlan();
              }}
              onOpenReview={onOpenReview}
              onNavigate={onNavigate}
            />
          </Suspense>
        ) : todayPlanLoading || todayPlanError ? (
          <p className="empty-state">{todayPlanError || '今日计划加载中...'}</p>
        ) : (
          <p className="empty-state">完成入学引导后，这里会显示今日最重要任务。</p>
        )}
      </section>

      <section className="panel student-home-score-center-card" aria-label="学习路线与推荐">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">学习路线</p>
            <h3>今天从哪里开始</h3>
          </div>
        </div>
        <Suspense fallback={sectionFallback('今日提分')}>
          <TodaysScoreCenter />
        </Suspense>
      </section>
    </div>
  );
}
