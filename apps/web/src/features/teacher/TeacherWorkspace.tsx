import { ClipboardCheck, ClipboardList, Target } from 'lucide-react';
import type { GeneratedPaper, PaperSubmitResult, Question, TeacherClassAnalytics } from '../../api';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { createInitialPaperSession } from '../../constants';
import type { ModuleResource } from '../../hooks/moduleResource';

interface TeacherWorkspaceProps {
  questions: ModuleResource<Question[]>;
  classAnalytics: ModuleResource<TeacherClassAnalytics>;
  latestPaper: GeneratedPaper | null;
  paperSession: ReturnType<typeof createInitialPaperSession> | null;
  paperResult: PaperSubmitResult | null;
  knowledgeStatus: string;
  teacherStatus: string;
  paperStatus: string;
  onRetryQuestions: () => void;
  onRetryClassAnalytics: () => void;
  onCreateKnowledgePoint: () => void;
  onCreateQuestion: () => void;
  onFilterQuestions: () => void;
  onUpdateQuestion: () => void;
  onDeleteQuestion: () => void;
  onGeneratePaper: () => void;
  onStartPaperSession: () => void;
  onSubmitPaper: () => void;
}

export function TeacherWorkspace(props: TeacherWorkspaceProps) {
  const questions = props.questions.data;
  const classAnalytics = props.classAnalytics.data;
  const knowledgePointCount = questions
    ? new Set(questions.flatMap((question) => question.knowledgePointIds)).size
    : 0;

  return (
    <section id="teacher" className="panel teacher-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">教师题库管理</p><h3>新增题目后同步到学生训练</h3></div>
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={props.onCreateKnowledgePoint}><Target size={18} /> 新增考点</button>
          <button type="button" className="secondary-action" onClick={props.onCreateQuestion}><ClipboardList size={18} /> 新增题目</button>
          <button type="button" className="secondary-action" onClick={props.onFilterQuestions} disabled={!questions}><ClipboardList size={18} /> 筛选 Cache 题</button>
          <button type="button" className="secondary-action" onClick={props.onUpdateQuestion} disabled={!questions?.length}><ClipboardList size={18} /> 编辑题目</button>
          <button type="button" className="secondary-action" onClick={props.onDeleteQuestion} disabled={!questions?.length}><ClipboardList size={18} /> 删除题目</button>
          <button type="button" className="secondary-action" onClick={props.onGeneratePaper}><ClipboardCheck size={18} /> 生成专项卷</button>
          <button type="button" className="secondary-action" onClick={props.onStartPaperSession}><ClipboardCheck size={18} /> 开始答卷</button>
          <button type="button" className="secondary-action" onClick={props.onSubmitPaper}><ClipboardCheck size={18} /> 提交试卷</button>
        </div>
      </div>
      <p className="task-status">{props.knowledgeStatus} {props.teacherStatus} {props.paperStatus}</p>

      {questions ? (
        <>
          <ModuleResourceMeta resource={props.questions} onRetry={props.onRetryQuestions} />
          <div className="teacher-grid">
            <article><strong>{questions.length} 题</strong><span>当前题库可见题目</span></article>
            <article><strong>{knowledgePointCount} 个</strong><span>题目已关联知识点</span></article>
            <article>
              <strong>{props.latestPaper ? `${props.latestPaper.questionCount} 题` : '试卷管理'}</strong>
              <span>{props.latestPaper ? `${props.latestPaper.title} · ${props.latestPaper.estimatedMinutes} 分钟` : '可按知识点生成专项卷。'}</span>
            </article>
          </div>
          <div className="teacher-question-list">
            {questions.length ? questions.slice(0, 4).map((question) => (
              <article key={question.id}>
                <div><strong>{question.id} · {question.difficulty}</strong><span>{question.stem}</span></div>
                <small>{question.source} · {question.expectedTimeSec} 秒 · {question.knowledgePointIds.join('、')}</small>
              </article>
            )) : <article><strong>题库暂无内容</strong><span>可以先新增知识点和第一道题目。</span></article>}
          </div>
        </>
      ) : (
        <ModuleInlineUnavailable title="题库" resource={props.questions} onRetry={props.onRetryQuestions} />
      )}

      {classAnalytics ? (
        <div className="class-analytics-panel">
          <div className="class-analytics-heading">
            <div><p className="eyebrow">班级学情分析</p><h3>{classAnalytics.className}</h3></div>
            <span>更新于 {new Date(classAnalytics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <ModuleResourceMeta resource={props.classAnalytics} onRetry={props.onRetryClassAnalytics} />
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
                  <article key={item.subject}><div><span>{item.subject}</span><small>掌握度 {item.averageMastery}% · 薄弱点 {item.weakPointCount}</small></div><p>{item.recommendation}</p></article>
                ))}
              </div>
            </div>
            <div>
              <strong>风险学生</strong>
              <div className="risk-student-list">
                {classAnalytics.atRiskStudents.map((item) => <article key={item.userId}><span>{item.name} · {item.riskType}</span><p>{item.reason}</p><small>{item.nextAction}</small></article>)}
              </div>
            </div>
          </div>
          <div className="weak-point-teaching-list">
            {classAnalytics.weakKnowledgePoints.slice(0, 3).map((item) => (
              <article key={item.knowledgePointId}><strong>{item.title}</strong><span>{item.subject} · 正确率 {item.accuracyRate}% · 错题 {item.wrongCount}</span><p>{item.recommendedAction}</p></article>
            ))}
          </div>
          <div className="teaching-actions">{classAnalytics.teachingActions.map((action) => <span key={action}>{action}</span>)}</div>
        </div>
      ) : (
        <ModuleInlineUnavailable title="班级学情" resource={props.classAnalytics} onRetry={props.onRetryClassAnalytics} />
      )}

      {props.latestPaper && props.paperSession ? (
        <div className="paper-session-panel">
          <div><strong>{props.latestPaper.title}</strong><span>{props.paperSession.answeredCount}/{props.paperSession.totalQuestions} 题 · 进度 {props.paperSession.progressRate}%</span></div>
          <div className="paper-session-progress"><span style={{ width: `${props.paperSession.progressRate}%` }} /></div>
          <p>用时 {Math.round(props.paperSession.elapsedSec / 60)} / {Math.round(props.paperSession.timeLimitSec / 60)} 分钟 · {props.paperSession.overtime ? '已超时，需要压缩答题节奏' : '未超时，节奏正常'} · 未答 {props.paperSession.unansweredCount} 题</p>
        </div>
      ) : null}

      {props.paperResult ? (
        <div className="paper-result-panel">
          <div className="paper-result-summary">
            <article><strong>{props.paperResult.score}</strong><span>试卷得分</span></article>
            <article><strong>{props.paperResult.accuracyRate}%</strong><span>正确率</span></article>
            <article><strong>{props.paperResult.reviewItems.length}</strong><span>需复盘题</span></article>
            <article><strong>{props.paperResult.syncedPracticeRecordCount}</strong><span>同步记录</span></article>
          </div>
          <div className="paper-breakdown">{props.paperResult.subjectBreakdown.map((item) => <span key={item.subject}>{item.subject} · {item.correctCount}/{item.totalQuestions} · {item.accuracyRate}%</span>)}</div>
          <div className="paper-actions">{props.paperResult.nextActions.map((action) => <p key={action}>{action}</p>)}</div>
        </div>
      ) : null}
    </section>
  );
}
