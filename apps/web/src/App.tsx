import { useEffect, useState } from 'react';
import { Activity, BookOpenCheck, Brain, ClipboardList, Target } from 'lucide-react';
import { createMockOverview, fetchDashboardOverview, type DashboardOverview } from './api';

export function App() {
  const [overview, setOverview] = useState<DashboardOverview>(() => createMockOverview());
  const [apiState, setApiState] = useState<'connecting' | 'connected' | 'mock'>('connecting');
  const [assessmentStatus, setAssessmentStatus] = useState('等待生成阶段测评');

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

  const { student, questions, report, plan } = overview;
  const currentQuestion = questions[0];

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
            <span>{assessmentStatus}</span>
          </div>
          <div className="task-list">
            {plan.dailyTasks.map((task) => (
              <article key={task.id} className="task-row">
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.subject} / {task.chapter} / {task.mode}</p>
                </div>
                <span>{task.minutes} 分钟 · {task.questionCount} 题</span>
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
                <button key={option} type="button">
                  {String.fromCharCode(65 + index)}. {option}
                </button>
              ))}
            </div>
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
