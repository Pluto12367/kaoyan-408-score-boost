import { useState } from 'react';
import { ClipboardCheck, ClipboardList, Target } from 'lucide-react';
import type { GeneratedPaper, PaperSubmitResult, Question, TeacherClassAnalytics } from '../../api';
import {
  confirmAiVariant,
  generateAiVariant,
  type AiVariantDraft,
} from '../../api/endpoints/teacher';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { createInitialPaperSession } from '../../constants';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { RoleSection } from '../../layouts/RoleNavigation';

interface TeacherWorkspaceProps {
  activeSection: RoleSection;
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

export function TeacherWorkspace({ activeSection, ...props }: TeacherWorkspaceProps) {
  const questions = props.questions.data;
  const classAnalytics = props.classAnalytics.data;
  const [aiStatus, setAiStatus] = useState('');
  const [aiCandidates, setAiCandidates] = useState<AiVariantDraft[]>([]);
  const [aiGeneratingId, setAiGeneratingId] = useState<string | null>(null);
  const [aiSourceQuestionId, setAiSourceQuestionId] = useState<string | null>(null);
  const knowledgePointCount = questions
    ? new Set(questions.flatMap((question) => question.knowledgePointIds)).size
    : 0;

  async function handleGenerateAiVariant(questionId: string) {
    setAiStatus('');
    setAiCandidates([]);
    setAiGeneratingId(questionId);
    setAiSourceQuestionId(questionId);
    try {
      const result = await generateAiVariant(questionId);
      setAiCandidates(result.items);
      setAiStatus(`AI 已生成 ${result.items.length} 道同知识点变式题，请核对后确认入库。`);
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : 'AI 变式题生成失败，请重试。');
    } finally {
      setAiGeneratingId(null);
    }
  }

  async function handleConfirmAiVariant(draft: AiVariantDraft) {
    if (!aiSourceQuestionId) {
      setAiStatus('请先选择来源题目生成变式题。');
      return;
    }
    try {
      await confirmAiVariant(aiSourceQuestionId, draft);
      setAiCandidates((current) => current.filter((item) => item !== draft));
      setAiStatus('已确认入库，新题进入待审核队列。');
      props.onRetryQuestions();
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : '确认入库失败，请重试。');
    }
  }

  const classAnalyticsPanel = classAnalytics ? (
    <div className="class-analytics-panel">
      <div className="class-analytics-heading">
        <div><p className="eyebrow">班级学情分析</p><h3>{classAnalytics.className}</h3></div>
        <span>更新于 {new Date(classAnalytics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <ModuleResourceMeta resource={props.classAnalytics} onRetry={props.onRetryClassAnalytics} />
      {classAnalytics.overview.studentCount === 0 ? (
        <p className="empty-state">暂未授权学生：请在管理端"用户管理 → 教师授权"中为学生配置本教师。</p>
      ) : null}
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
  );

  if (activeSection === 'report') {
    return (
      <section id="teacher-report" className="panel teacher-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">教师端 · 学情报告</p><h3>班级学情报告</h3></div>
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={props.onRetryClassAnalytics}>刷新报告</button>
          </div>
        </div>
        <p className="task-status">基于授权学生的练习、错题与测评数据生成，数据以班级学情接口为准。</p>
        {classAnalyticsPanel}
      </section>
    );
  }

  if (activeSection === 'ai') {
    return (
      <section id="teacher-ai" className="panel teacher-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">教师端 · AI 辅助</p><h3>AI 辅助（建设中）</h3></div>
        </div>
        <div className="ai-placeholder">
          <p>AI 辅助功能正在建设中，后续将支持：</p>
          <ul>
            <li>按班级错题自动生成讲评建议</li>
            <li>试卷讲解与典型错误解读</li>
            <li>薄弱考点的课堂复习提示</li>
          </ul>
          <p className="muted">当前以标准题库与班级学情为准，不会展示未经实现的功能。</p>
        </div>
      </section>
    );
  }

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
                <button
                  type="button"
                  className="secondary-action"
                  disabled={aiGeneratingId !== null}
                  onClick={() => handleGenerateAiVariant(question.id)}
                >
                  {aiGeneratingId === question.id ? '生成中...' : 'AI 变式'}
                </button>
              </article>
            )) : <article><strong>题库暂无内容</strong><span>可以先新增知识点和第一道题目。</span></article>}
          </div>
          {aiCandidates.length > 0 ? (
            <div className="ai-variant-preview">
              <h4>AI 变式题预览（需教师核对后确认入库）</h4>
              {aiCandidates.map((draft) => (
                <article key={draft.stem}>
                  <strong>{draft.difficulty} · {draft.stem}</strong>
                  <span>{draft.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join(' | ')}</span>
                  <small>正确答案：{draft.answer} · {draft.analysis}</small>
                  <button type="button" className="primary-action" onClick={() => void handleConfirmAiVariant(draft)}>确认入库</button>
                </article>
              ))}
              <button type="button" className="secondary-action" onClick={() => setAiCandidates([])}>全部丢弃</button>
            </div>
          ) : null}
          {aiStatus ? <p className="task-status">{aiStatus}</p> : null}
        </>
      ) : (
        <ModuleInlineUnavailable title="题库" resource={props.questions} onRetry={props.onRetryQuestions} />
      )}

      {classAnalyticsPanel}

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
