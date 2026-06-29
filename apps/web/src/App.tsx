import { useEffect, useState } from 'react';
import { Activity, BookOpenCheck, Brain, ClipboardList, Target } from 'lucide-react';
import { completeStudyTask, createMockOverview, fetchDashboardOverview, submitPracticeAnswer, type DashboardOverview } from './api';

export function App() {
  const [overview, setOverview] = useState<DashboardOverview>(() => createMockOverview());
  const [apiState, setApiState] = useState<'connecting' | 'connected' | 'mock'>('connecting');
  const [assessmentStatus, setAssessmentStatus] = useState('等待生成阶段测评');
  const [practiceStatus, setPracticeStatus] = useState('选择一个选项后，系统会自动判题并更新提分报告。');
  const [taskStatus, setTaskStatus] = useState('今日任务等待完成。');
  const [redoQuestionId, setRedoQuestionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchDashboardOverview()
      .then((data) => {
        if (!active) return;
        setOverview(data);
        setApiState('connected');
      })
      .catch(() => {
        if (!active) return;
        setOverview(createMockOverview());
        setApiState('mock');
      });

    return () => {
      active = false;
    };
  }, []);

  const { student, questions, report, plan, wrongQuestions } = overview;
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
      setOverview(nextOverview);
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
      setOverview(nextOverview);
      setApiState('connected');
      setTaskStatus(`今日已完成 ${nextOverview.plan.completedTaskCount ?? 0}/${nextOverview.plan.totalTaskCount ?? nextOverview.plan.dailyTasks.length} 项任务。`);
    } catch {
      setTaskStatus('任务完成状态记录失败，请稍后重试。');
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
            <button type="button" onClick={() => setAssessmentStatus('阶段测评已生成，建议优先完成 Cache 映射与替换专项。')}>生成阶段测评</button>
          </div>
        </header>

        <section id="dashboard" className="metrics-grid">
          <Metric title="目标分" value={`${student.targetScore ?? 0}`} caption={student.targetSchool ?? '目标院校未设置'} />
          <Metric title="正确率" value={`${report.accuracyRate}%`} caption="近 20 次练习统计" />
          <Metric title="预计提分空间" value={`${report.estimatedGain} 分`} caption="基于薄弱点和目标分估算" />
          <Metric title="剩余天数" value={`${student.remainingDays ?? 0} 天`} caption={`每日 ${student.dailyHours ?? 0} 小时`} />
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
