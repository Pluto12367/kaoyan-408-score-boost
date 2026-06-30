import { useEffect, useState } from 'react';
import { Activity, BookOpenCheck, Brain, ClipboardCheck, ClipboardList, ShieldCheck, Target } from 'lucide-react';
import {
  approveReviewItem,
  completeStudyTask,
  createKnowledgePoint,
  createTeacherQuestion,
  createMockAdminMetrics,
  createMockOverview,
  createMockReviewQueue,
  createMockSystemConfig,
  fetchAdminMetrics,
  fetchDashboardOverview,
  fetchReviewQueue,
  fetchStageAssessment,
  fetchSystemConfig,
  requestTutorReply,
  submitPracticeAnswer,
  submitStageAssessment,
  updateSystemConfig,
  type AdminMetrics,
  type DashboardOverview,
  type ReviewQueue,
  type StageAssessmentResult,
  type SystemConfig,
  type TutorReply,
} from './api';

export function App() {
  const [overview, setOverview] = useState<DashboardOverview>(() => createMockOverview());
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics>(() => createMockAdminMetrics());
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue>(() => createMockReviewQueue());
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() => createMockSystemConfig());
  const [apiState, setApiState] = useState<'connecting' | 'connected' | 'mock'>('connecting');
  const [assessmentStatus, setAssessmentStatus] = useState('等待生成阶段测评');
  const [practiceStatus, setPracticeStatus] = useState('选择一个选项后，系统会自动判题并更新提分报告。');
  const [taskStatus, setTaskStatus] = useState('今日任务等待完成。');
  const [redoQuestionId, setRedoQuestionId] = useState<string | null>(null);
  const [stageResult, setStageResult] = useState<StageAssessmentResult | null>(null);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [tutorStatus, setTutorStatus] = useState('选择一道题后，可以让 AI 助教按标准解析拆解思路。');
  const [teacherStatus, setTeacherStatus] = useState('教师可以新增题目，学生端会立即用于检索和练习。');
  const [reviewStatus, setReviewStatus] = useState('教师题目和 AI 生成内容会进入审核队列。');
  const [configStatus, setConfigStatus] = useState('推荐策略参数会影响阶段测评和每日训练建议。');
  const [knowledgeStatus, setKnowledgeStatus] = useState('教研可以维护 408 知识树，新增考点后可用于题目绑定。');

  useEffect(() => {
    let active = true;

    Promise.all([fetchDashboardOverview(), fetchAdminMetrics(), fetchReviewQueue(), fetchSystemConfig()])
      .then(([data, metrics, queue, config]) => {
        if (!active) return;
        setOverview(data);
        setAdminMetrics(metrics);
        setReviewQueue(queue);
        setSystemConfig(config);
        setApiState('connected');
      })
      .catch(() => {
        if (!active) return;
        setOverview(createMockOverview());
        setAdminMetrics(createMockAdminMetrics());
        setReviewQueue(createMockReviewQueue());
        setSystemConfig(createMockSystemConfig());
        setApiState('mock');
      });

    return () => {
      active = false;
    };
  }, []);

  const { student, questions, report, plan, wrongQuestions, learningCalendar, stageAssessment } = overview;
  const currentQuestion = questions[0];

  async function handleSubmitAnswer(selectedAnswer: string) {
    setPracticeStatus('正在提交答案...');

    try {
      const record = await submitPracticeAnswer({
        userId: student.id,
        questionId: currentQuestion.id,
        knowledgePointId: currentQuestion.knowledgePointIds[0],
        selectedAnswer,
        timeSpentSec: 135,
      });
      const nextOverview = await fetchDashboardOverview();
      const nextMetrics = await fetchAdminMetrics();
      setOverview(nextOverview);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      if (record.correct && redoQuestionId === currentQuestion.id) {
        setRedoQuestionId(null);
        setPracticeStatus('回答正确，已从错题本移除。');
      } else {
        setPracticeStatus(record.correct ? '回答正确，已记录本次练习。' : `回答错误，错因：${record.mistakeReason ?? '待复盘'}。`);
      }
    } catch {
      setPracticeStatus('提交失败，当前显示本地演示数据。');
      setApiState('mock');
    }
  }

  async function handleCompleteTask(taskId: string) {
    setTaskStatus('正在记录任务完成状态...');

    try {
      await completeStudyTask({
        userId: student.id,
        taskId,
      });
      const nextOverview = await fetchDashboardOverview();
      const nextMetrics = await fetchAdminMetrics();
      setOverview(nextOverview);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      setTaskStatus(`今日已完成 ${nextOverview.plan.completedTaskCount ?? 0}/${nextOverview.plan.totalTaskCount ?? nextOverview.plan.dailyTasks.length} 项任务。`);
    } catch {
      setTaskStatus('任务完成状态记录失败，请稍后重试。');
      setApiState('mock');
    }
  }

  async function handleGenerateAssessment() {
    setAssessmentStatus('正在生成阶段测评...');

    try {
      const assessment = await fetchStageAssessment(student.id);
      setOverview((current) => ({
        ...current,
        stageAssessment: assessment,
      }));
      setStageResult(null);
      setApiState('connected');
      setAssessmentStatus(`已生成 ${assessment.questions.length} 题阶段测评，预计 ${assessment.estimatedMinutes} 分钟。`);
      document.getElementById('assessment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setAssessmentStatus('阶段测评生成失败，当前显示本地演示数据。');
      setApiState('mock');
    }
  }

  async function handleSubmitAssessment() {
    setAssessmentStatus('正在提交阶段测评...');

    try {
      const result = await submitStageAssessment({
        userId: student.id,
        answers: stageAssessment.questions.map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index === 0 ? question.answer : 'A',
          timeSpentSec: question.expectedTimeSec + 20,
        })),
      });
      const nextOverview = await fetchDashboardOverview();
      const nextMetrics = await fetchAdminMetrics();
      setOverview(nextOverview);
      setAdminMetrics(nextMetrics);
      setStageResult(result);
      setApiState('connected');
      setAssessmentStatus(`阶段测评完成：${result.score} 分，需复盘 ${result.reviewItems.length} 处。`);
    } catch {
      setAssessmentStatus('阶段测评提交失败，请稍后重试。');
      setApiState('mock');
    }
  }

  async function handleAskTutor() {
    setTutorStatus('AI 助教正在整理解析...');

    try {
      const reply = await requestTutorReply({
        userId: student.id,
        questionId: currentQuestion.id,
        selectedAnswer: 'A',
        prompt: '请解释这道题的考点和易错点。',
      });
      setTutorReply(reply);
      const nextQueue = await fetchReviewQueue();
      const nextMetrics = await fetchAdminMetrics();
      setReviewQueue(nextQueue);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      setTutorStatus(`已生成 ${reply.knowledgePointTitle} 的答疑解析。`);
      document.getElementById('ai')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setTutorStatus('AI 答疑暂时不可用，请先查看标准解析。');
      setApiState('mock');
    }
  }

  async function handleCreateTeacherQuestion() {
    setTeacherStatus('正在新增题目...');

    try {
      const created = await createTeacherQuestion({
        stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？',
        options: ['增大', '不变', '减小', '无法判断'],
        answer: 'C',
        analysis: '命中率提高后，访问更多落在高速 Cache 中，平均访存时间通常减小。',
        knowledgePointIds: ['co-cache'],
        difficulty: currentQuestion.difficulty,
        type: currentQuestion.type,
        source: '教师新增',
        year: 2026,
        expectedTimeSec: 90,
      });
      const nextOverview = await fetchDashboardOverview();
      const nextMetrics = await fetchAdminMetrics();
      const nextQueue = await fetchReviewQueue();
      setOverview(nextOverview);
      setAdminMetrics(nextMetrics);
      setReviewQueue(nextQueue);
      setApiState('connected');
      setTeacherStatus(`已新增 ${created.id}，当前题库共 ${nextOverview.questions.length} 题。`);
    } catch {
      setTeacherStatus('题目录入失败，请检查题干、选项、答案和知识点绑定。');
      setApiState('mock');
    }
  }

  async function handleCreateKnowledgePoint() {
    setKnowledgeStatus('正在新增知识点...');

    try {
      const point = await createKnowledgePoint({
        id: `os-memory-${Date.now()}`,
        subject: '操作系统',
        chapter: '内存管理',
        title: '分页与地址转换',
        importance: 5,
        frequency: 4,
        prerequisites: ['进程地址空间'],
      });
      const nextOverview = await fetchDashboardOverview();
      const nextMetrics = await fetchAdminMetrics();
      setOverview(nextOverview);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      setKnowledgeStatus(`已新增 ${point.title}，当前知识点共 ${nextOverview.knowledgePoints.length} 个。`);
    } catch {
      setKnowledgeStatus('知识点新增失败，请检查 ID、科目、章节和标题。');
      setApiState('mock');
    }
  }

  async function handleApproveReviewItem(reviewItemId: string) {
    setReviewStatus('正在提交审核结果...');

    try {
      await approveReviewItem({
        reviewItemId,
        reviewerId: 'admin-001',
      });
      const nextQueue = await fetchReviewQueue();
      const nextMetrics = await fetchAdminMetrics();
      setReviewQueue(nextQueue);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      setReviewStatus(`审核已通过，当前仍有 ${nextQueue.pendingCount} 项待处理。`);
    } catch {
      setReviewStatus('审核提交失败，请稍后重试。');
      setApiState('mock');
    }
  }

  async function handleApplySprintConfig() {
    setConfigStatus('正在应用冲刺期推荐策略...');

    try {
      const nextConfig = await updateSystemConfig({
        updatedBy: 'admin-001',
        recommendation: {
          stageAssessmentQuestionLimit: 2,
          dailyTargetQuestionCount: 35,
          speedRiskMultiplier: 1.25,
        },
      });
      const nextAssessment = await fetchStageAssessment(student.id);
      setSystemConfig(nextConfig);
      setOverview((current) => ({
        ...current,
        stageAssessment: nextAssessment,
      }));
      setApiState('connected');
      setConfigStatus(`已应用冲刺策略：阶段测评 ${nextConfig.recommendation.stageAssessmentQuestionLimit} 题，每日 ${nextConfig.recommendation.dailyTargetQuestionCount} 题。`);
    } catch {
      setConfigStatus('系统配置更新失败，请稍后重试。');
      setApiState('mock');
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">408 Score Boost</p>
          <h1>计算机考研 408 提分系统</h1>
        </div>
        <nav>
          <a className="active" href="#dashboard"><Activity size={18} /> 学习总览</a>
          <a href="#plan"><ClipboardList size={18} /> 今日计划</a>
          <a href="#question"><BookOpenCheck size={18} /> 题库训练</a>
          <a href="#report"><Target size={18} /> 提分报告</a>
          <a href="#admin"><Activity size={18} /> 数据看板</a>
          <a href="#review"><ShieldCheck size={18} /> 内容审核</a>
          <a href="#config"><ClipboardCheck size={18} /> 系统配置</a>
          <a href="#ai"><Brain size={18} /> AI 答疑</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">学生端迁移版</p>
            <h2>{student.name}，当前处于{student.stage}阶段</h2>
          </div>
          <div className="topbar-actions">
            <span className={`api-pill ${apiState}`}>
              {apiState === 'connected' ? 'API 已连接' : apiState === 'mock' ? 'Mock 数据' : '连接 API'}
            </span>
            <button type="button" onClick={handleGenerateAssessment}>生成阶段测评</button>
          </div>
        </header>

        <section id="dashboard" className="metrics-grid">
          <Metric title="目标分" value={`${student.targetScore ?? 0}`} caption={student.targetSchool ?? '目标院校未设置'} />
          <Metric title="正确率" value={`${report.accuracyRate}%`} caption="近 20 次练习统计" />
          <Metric title="预计提分空间" value={`${report.estimatedGain} 分`} caption="基于薄弱点和目标分估算" />
          <Metric title="剩余天数" value={`${student.remainingDays ?? 0} 天`} caption={`每日 ${student.dailyHours ?? 0} 小时`} />
        </section>

        <section id="admin" className="panel admin-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">管理端数据看板</p>
              <h3>试用期核心运营指标</h3>
            </div>
            <span>更新于 {new Date(adminMetrics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="admin-grid">
            <article>
              <strong>{adminMetrics.activeStudentCount}</strong>
              <span>活跃学生</span>
            </article>
            <article>
              <strong>{adminMetrics.questionCount}</strong>
              <span>题库题目</span>
            </article>
            <article>
              <strong>{adminMetrics.practiceRecordCount}</strong>
              <span>练习记录</span>
            </article>
            <article>
              <strong>{adminMetrics.accuracyRate}%</strong>
              <span>整体正确率</span>
            </article>
            <article>
              <strong>{adminMetrics.pendingReviewCount}</strong>
              <span>待审核内容</span>
            </article>
            <article>
              <strong>{adminMetrics.todayPracticeCount}</strong>
              <span>今日练习</span>
            </article>
          </div>
          <p className="task-status">
            当前最弱考点：{adminMetrics.topWeakPoint ?? '暂无'} · 平均耗时 {adminMetrics.averagePracticeTimeSec} 秒 · 留存学习日 {adminMetrics.retentionDays} 天
          </p>
        </section>

        <section id="review" className="panel review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">管理端内容审核</p>
              <h3>待审核 {reviewQueue.pendingCount} 项 · 已通过 {reviewQueue.approvedCount} 项</h3>
            </div>
            <span>更新于 {new Date(reviewQueue.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <p className="task-status">{reviewStatus}</p>
          <div className="review-list">
            {reviewQueue.items.length ? reviewQueue.items.map((item) => (
              <article key={item.id} className={`review-row ${item.status}`}>
                <div>
                  <strong>{item.contentType === 'question' ? '题目审核' : 'AI 答疑审核'} · {item.title}</strong>
                  <p>{item.summary}</p>
                  <span>风险：{riskLabel[item.riskLevel]} · 状态：{item.status === 'approved' ? '已通过' : '待审核'}</span>
                </div>
                <button type="button" disabled={item.status === 'approved'} onClick={() => handleApproveReviewItem(item.id)}>
                  {item.status === 'approved' ? '已通过' : '通过'}
                </button>
              </article>
            )) : (
              <article className="review-empty">
                <strong>暂无待审核内容</strong>
                <span>新增教师题目或生成 AI 答疑后会自动进入这里。</span>
              </article>
            )}
          </div>
        </section>

        <section id="config" className="panel config-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">管理端系统配置</p>
              <h3>推荐策略参数</h3>
            </div>
            <button type="button" className="secondary-action" onClick={handleApplySprintConfig}>
              <ClipboardCheck size={18} /> 应用冲刺配置
            </button>
          </div>
          <p className="task-status">{configStatus}</p>
          <div className="config-grid">
            <article>
              <strong>{systemConfig.recommendation.stageAssessmentQuestionLimit}</strong>
              <span>阶段测评题量上限</span>
            </article>
            <article>
              <strong>{systemConfig.recommendation.dailyTargetQuestionCount}</strong>
              <span>每日推荐题量</span>
            </article>
            <article>
              <strong>{systemConfig.recommendation.speedRiskMultiplier.toFixed(2)}x</strong>
              <span>速度风险阈值</span>
            </article>
            <article>
              <strong>{systemConfig.updatedBy}</strong>
              <span>最近更新人</span>
            </article>
          </div>
        </section>

        <section className="panel">
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

        <section id="assessment" className="panel assessment-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">阶段测评</p>
              <h3>{stageAssessment.title}</h3>
            </div>
            <span>{stageAssessment.questions.length} 题 · 预计 {stageAssessment.estimatedMinutes} 分钟</span>
          </div>
          <p className="task-status">{assessmentStatus}</p>
          <div className="assessment-grid">
            <article>
              <strong>聚焦知识点</strong>
              <div className="tag-list">
                {stageAssessment.focusKnowledgePoints.map((point) => (
                  <span key={point.id}>{point.title}</span>
                ))}
              </div>
            </article>
            <article>
              <strong>测评说明</strong>
              <p>{stageAssessment.description}</p>
            </article>
            <article>
              <strong>提交后产出</strong>
              <p>系统会同步练习记录、错题本和薄弱点报告，并给出下一步复习建议。</p>
            </article>
          </div>
          <div className="assessment-actions">
            <button type="button" onClick={handleSubmitAssessment}>
              <ClipboardCheck size={18} /> 提交演示测评
            </button>
          </div>
          {stageResult ? (
            <div className="assessment-result">
              <strong>本次得分 {stageResult.score} / 100</strong>
              <p>答对 {stageResult.correctCount}/{stageResult.totalQuestions} 题，复盘项 {stageResult.reviewItems.length} 个。</p>
              <ul>
                {stageResult.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section id="plan" className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{plan.phase}</p>
              <h3>今日推荐任务</h3>
            </div>
            <span>{plan.completedTaskCount ?? 0}/{plan.totalTaskCount ?? plan.dailyTasks.length} 已完成 · {plan.completionRate ?? 0}%</span>
          </div>
          <p className="task-status">{taskStatus} {assessmentStatus}</p>
          <div className="task-list">
            {plan.dailyTasks.map((task) => (
              <article key={task.id} className={`task-row ${task.completed ? 'completed' : ''}`}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.subject} / {task.chapter} / {task.mode}</p>
                </div>
                <div className="task-actions">
                  <span>{task.minutes} 分钟 · {task.questionCount} 题</span>
                  <button type="button" disabled={task.completed} onClick={() => handleCompleteTask(task.id)}>
                    {task.completed ? '已完成' : '完成'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="two-column">
          <article id="question" className="panel">
            <p className="eyebrow">题库训练</p>
            <h3>{currentQuestion.stem}</h3>
            <div className="options">
              {currentQuestion.options.map((option, index) => (
                <button key={option} type="button" onClick={() => handleSubmitAnswer(String.fromCharCode(65 + index))}>
                  {String.fromCharCode(65 + index)}. {option}
                </button>
              ))}
            </div>
            {redoQuestionId === currentQuestion.id ? <p className="redo-badge">错题重做模式</p> : null}
            <p className="practice-status">{practiceStatus}</p>
            <p className="muted">答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。</p>
          </article>

          <article id="report" className="panel">
            <p className="eyebrow">提分报告</p>
            <h3>{report.summary}</h3>
            <div className="weak-list">
              {report.weakPoints.map((point) => (
                <div key={point.knowledgePointId}>
                  <strong>{point.title}</strong>
                  <span>{point.topReason ?? '待诊断'} · {point.suggestion}</span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section id="ai" className="panel tutor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI 答疑</p>
              <h3>基于标准解析的助教讲解</h3>
            </div>
            <button type="button" className="secondary-action" onClick={handleAskTutor}>
              <Brain size={18} /> 讲解当前题
            </button>
          </div>
          <p className="task-status">{tutorStatus}</p>
          {tutorReply ? (
            <div className="tutor-result">
              <article>
                <strong>{tutorReply.knowledgePointTitle}</strong>
                <p>{tutorReply.answerCheck}</p>
              </article>
              <article>
                <strong>思路拆解</strong>
                <ol>
                  {tutorReply.explanationSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
              <article>
                <strong>相似题推荐</strong>
                <div className="similar-list">
                  {tutorReply.similarQuestions.map((question) => (
                    <span key={question.id}>{question.source} · {question.difficulty} · {question.stem}</span>
                  ))}
                </div>
              </article>
              <article>
                <strong>下一步</strong>
                <ul>
                  {tutorReply.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </article>
            </div>
          ) : null}
        </section>

        <section className="panel teacher-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">教师题库管理</p>
              <h3>新增题目后同步到学生训练</h3>
            </div>
            <div className="panel-actions">
              <button type="button" className="secondary-action" onClick={handleCreateKnowledgePoint}>
                <Target size={18} /> 新增演示考点
              </button>
              <button type="button" className="secondary-action" onClick={handleCreateTeacherQuestion}>
                <ClipboardList size={18} /> 新增演示题
              </button>
            </div>
          </div>
          <p className="task-status">{knowledgeStatus} {teacherStatus}</p>
          <div className="teacher-grid">
            <article>
              <strong>{questions.length} 题</strong>
              <span>当前学生端可见题目</span>
            </article>
            <article>
              <strong>{overview.knowledgePoints.length} 个</strong>
              <span>当前维护的 408 知识点</span>
            </article>
            <article>
              <strong>内容审核</strong>
              <span>AI 只辅助讲解，不替代教师录入的标准答案和解析。</span>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">错题本</p>
              <h3>自动收集需要回炉的题目</h3>
            </div>
            <span>{wrongQuestions.length} 道待复盘</span>
          </div>
          <div className="wrong-list">
            {wrongQuestions.map((item) => (
              <article key={item.questionId} className="wrong-row">
                <div>
                  <strong>{item.knowledgePointTitle}</strong>
                  <p>{item.subject} / {item.chapter} / 错 {item.wrongCount} 次 / {item.latestMistakeReason ?? '待诊断'}</p>
                  <span>{item.stem}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRedoQuestionId(item.questionId);
                    setPracticeStatus(`正在重做：${item.knowledgePointTitle}。请选择答案。`);
                    document.getElementById('question')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  重做
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <article className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{caption}</p>
    </article>
  );
}

const riskLabel = {
  low: '低',
  medium: '中',
  high: '高',
};
