import { ClipboardCheck, ClipboardList, Target } from 'lucide-react';
import type { GeneratedPaper, PaperSubmitResult, Question, TeacherClassAnalytics } from '../../api';
import type { createInitialPaperSession } from '../../constants';

interface TeacherWorkspaceProps {
  questionCount: number;
  knowledgePointCount: number;
  questionList: Question[];
  classAnalytics: TeacherClassAnalytics;
  latestPaper: GeneratedPaper | null;
  paperSession: ReturnType<typeof createInitialPaperSession> | null;
  paperResult: PaperSubmitResult | null;
  knowledgeStatus: string;
  teacherStatus: string;
  paperStatus: string;
  onCreateKnowledgePoint: () => void;
  onCreateQuestion: () => void;
  onFilterQuestions: () => void;
  onUpdateQuestion: () => void;
  onDeleteQuestion: () => void;
  onGeneratePaper: () => void;
  onStartPaperSession: () => void;
  onSubmitPaper: () => void;
}

export function TeacherWorkspace({
  questionCount,
  knowledgePointCount,
  questionList,
  classAnalytics,
  latestPaper,
  paperSession,
  paperResult,
  knowledgeStatus,
  teacherStatus,
  paperStatus,
  onCreateKnowledgePoint,
  onCreateQuestion,
  onFilterQuestions,
  onUpdateQuestion,
  onDeleteQuestion,
  onGeneratePaper,
  onStartPaperSession,
  onSubmitPaper,
}: TeacherWorkspaceProps) {
  return (
    <section id="teacher" className="panel teacher-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">教师题库管理</p><h3>新增题目后同步到学生训练</h3></div>
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={onCreateKnowledgePoint}><Target size={18} /> 新增演示考点</button>
          <button type="button" className="secondary-action" onClick={onCreateQuestion}><ClipboardList size={18} /> 新增演示题</button>
          <button type="button" className="secondary-action" onClick={onFilterQuestions}><ClipboardList size={18} /> 筛选 Cache 题</button>
          <button type="button" className="secondary-action" onClick={onUpdateQuestion}><ClipboardList size={18} /> 编辑演示题</button>
          <button type="button" className="secondary-action" onClick={onDeleteQuestion}><ClipboardList size={18} /> 删除演示题</button>
          <button type="button" className="secondary-action" onClick={onGeneratePaper}><ClipboardCheck size={18} /> 生成专项卷</button>
          <button type="button" className="secondary-action" onClick={onStartPaperSession}><ClipboardCheck size={18} /> 开始演示答卷</button>
          <button type="button" className="secondary-action" onClick={onSubmitPaper}><ClipboardCheck size={18} /> 提交演示试卷</button>
        </div>
      </div>
      <p className="task-status">{knowledgeStatus} {teacherStatus} {paperStatus}</p>
      <div className="teacher-grid">
        <article><strong>{questionCount} 题</strong><span>当前学生端可见题目</span></article>
        <article><strong>{knowledgePointCount} 个</strong><span>当前维护的 408 知识点</span></article>
        <article>
          <strong>{latestPaper ? `${latestPaper.questionCount} 题` : '试卷管理'}</strong>
          <span>{latestPaper ? `${latestPaper.title} · ${latestPaper.estimatedMinutes} 分钟` : '可按知识点生成专项卷。'}</span>
        </article>
      </div>

      <div className="class-analytics-panel">
        <div className="class-analytics-heading">
          <div><p className="eyebrow">班级学情分析</p><h3>{classAnalytics.className}</h3></div>
          <span>更新于 {new Date(classAnalytics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="class-analytics-grid">
          <article><strong>{classAnalytics.overview.studentCount}</strong><span>班级学生</span></article>
          <article><strong>{classAnalytics.overview.averageAccuracyRate}%</strong><span>平均正确率</span></article>
          <article><strong>{classAnalytics.overview.averageCompletionRate}%</strong><span>任务完成率</span></article>
          <article><strong>{classAnalytics.overview.pendingWrongQuestionCount}</strong><span>待复盘错题</span></article>
        </div>
        <div className="class-analytics-columns">
          <div>
            <strong>四科薄弱分布</strong>
            <div className="subject-weakness-list">
              {classAnalytics.subjectWeakness.map((item) => (
                <article key={item.subject}>
                  <div><span>{item.subject}</span><small>掌握度 {item.averageMastery}% · 薄弱点 {item.weakPointCount}</small></div>
                  <p>{item.recommendation}</p>
                </article>
              ))}
            </div>
          </div>
          <div>
            <strong>风险学生</strong>
            <div className="risk-student-list">
              {classAnalytics.atRiskStudents.map((item) => (
                <article key={item.userId}><span>{item.name} · {item.riskType}</span><p>{item.reason}</p><small>{item.nextAction}</small></article>
              ))}
            </div>
          </div>
        </div>
        <div className="weak-point-teaching-list">
          {classAnalytics.weakKnowledgePoints.slice(0, 3).map((item) => (
            <article key={item.knowledgePointId}>
              <strong>{item.title}</strong>
              <span>{item.subject} · 正确率 {item.accuracyRate}% · 错题 {item.wrongCount}</span>
              <p>{item.recommendedAction}</p>
            </article>
          ))}
        </div>
        <div className="teaching-actions">{classAnalytics.teachingActions.map((action) => <span key={action}>{action}</span>)}</div>
      </div>

      <div className="teacher-question-list">
        {questionList.slice(0, 4).map((question) => (
          <article key={question.id}>
            <div><strong>{question.id} · {question.difficulty}</strong><span>{question.stem}</span></div>
            <small>{question.source} · {question.expectedTimeSec} 秒 · {question.knowledgePointIds.join('、')}</small>
          </article>
        ))}
      </div>

      {latestPaper && paperSession ? (
        <div className="paper-session-panel">
          <div><strong>{latestPaper.title}</strong><span>{paperSession.answeredCount}/{paperSession.totalQuestions} 题 · 进度 {paperSession.progressRate}%</span></div>
          <div className="paper-session-progress"><span style={{ width: `${paperSession.progressRate}%` }} /></div>
          <p>
            用时 {Math.round(paperSession.elapsedSec / 60)} / {Math.round(paperSession.timeLimitSec / 60)} 分钟
            · {paperSession.overtime ? '已超时，需要压缩答题节奏' : '未超时，节奏正常'} · 未答 {paperSession.unansweredCount} 题
          </p>
        </div>
      ) : null}

      {paperResult ? (
        <div className="paper-result-panel">
          <div className="paper-result-summary">
            <article><strong>{paperResult.score}</strong><span>试卷得分</span></article>
            <article><strong>{paperResult.accuracyRate}%</strong><span>正确率</span></article>
            <article><strong>{paperResult.reviewItems.length}</strong><span>需复盘题</span></article>
            <article><strong>{paperResult.syncedPracticeRecordCount}</strong><span>同步记录</span></article>
          </div>
          <div className="paper-breakdown">
            {paperResult.subjectBreakdown.map((item) => <span key={item.subject}>{item.subject} · {item.correctCount}/{item.totalQuestions} · {item.accuracyRate}%</span>)}
          </div>
          <div className="paper-actions">{paperResult.nextActions.map((action) => <p key={action}>{action}</p>)}</div>
        </div>
      ) : null}
    </section>
  );
}
