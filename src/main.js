import { classifyMistake } from './appLogic.js';
import { createDashboardState } from './appData.js';

const state = createDashboardState();
let activeRole = 'student';
let activeSubject = '全部';
let answeredQuestionIds = new Set();

const roleLabels = {
  student: '学生工作台',
  teacher: '教研后台',
  admin: '管理看板',
};

const icons = {
  dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h7V4H4v9Zm9 7h7V4h-7v16ZM4 20h7v-5H4v5Z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v3h3v15H4V6h3V3Zm2 3h6V5H9v1Zm-2 5h10V9H7v2Zm0 4h10v-2H7v2Zm0 4h7v-2H7v2Z"/></svg>',
  graph: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5a3 3 0 1 1 2.8 4H14a3 3 0 1 1 0 2H9.8A3 3 0 0 1 8 12.8v2.4a3 3 0 1 1-2 0v-2.4A3 3 0 0 1 7 7Z"/></svg>',
  question: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5V4Zm3 4h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z"/></svg>',
  report: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4h16v16H4Zm4-3h2v-5H8v5Zm3 0h2V8h-2v9Zm3 0h2v-7h-2v7Z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.4 3.2 7.7 8 9 4.8-1.3 8-4.6 8-9V6l-8-3Zm-1 5h2v4h4v2h-4v4h-2v-4H7v-2h4V8Z"/></svg>',
};

function render() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">408</span>
        <div>
          <strong>考研提分系统</strong>
          <small>专业课闭环训练平台</small>
        </div>
      </div>
      <nav class="nav">
        ${navItem('student', 'dashboard', '学生工作台')}
        ${navItem('teacher', 'question', '教研后台')}
        ${navItem('admin', 'admin', '管理看板')}
      </nav>
      <div class="diagnosis-card">
        <span>智能诊断</span>
        <strong>${state.report.accuracyRate}%</strong>
        <small>当前综合正确率</small>
        <div class="progress"><i style="width:${state.report.accuracyRate}%"></i></div>
      </div>
    </aside>
    <main class="workspace">
      ${header()}
      ${activeRole === 'student' ? studentView() : ''}
      ${activeRole === 'teacher' ? teacherView() : ''}
      ${activeRole === 'admin' ? adminView() : ''}
    </main>
  `;

  bindEvents();
}

function navItem(role, icon, label) {
  return `
    <button class="nav-item ${activeRole === role ? 'active' : ''}" data-role="${role}">
      ${icons[icon]} <span>${label}</span>
    </button>
  `;
}

function header() {
  return `
    <header class="topbar">
      <div>
        <p>${roleLabels[activeRole]}</p>
        <h1>${activeRole === 'student' ? `${state.student.name}的408提分闭环` : roleLabels[activeRole]}</h1>
      </div>
      <div class="top-actions">
        <span>目标院校：${state.student.targetSchool}</span>
        <strong>目标 ${state.student.targetScore || '--'} 分</strong>
      </div>
    </header>
  `;
}

function studentView() {
  const filteredPoints = activeSubject === '全部'
    ? state.knowledgePoints
    : state.knowledgePoints.filter((point) => point.subject === activeSubject);

  return `
    <section class="metrics">
      ${metric('剩余天数', state.student.remainingDays, '按强化阶段推进')}
      ${metric('每日学习', `${state.student.dailyHours}h`, '计划自动拆分任务')}
      ${metric('预计提分', `${state.report.estimatedGain}分`, '基于错因与正确率')}
      ${metric('完成率', `${state.report.completionRate}%`, '练习记录可追溯')}
    </section>

    <section class="grid two-col">
      <article class="panel study-plan">
        <div class="section-title">${icons.plan}<div><p>学习计划</p><h2>${state.plan.phase}</h2></div></div>
        <div class="task-list">
          ${state.plan.dailyTasks.map(taskCard).join('')}
        </div>
      </article>

      <article class="panel">
        <div class="section-title">${icons.graph}<div><p>408知识图谱</p><h2>按科目定位薄弱链路</h2></div></div>
        <div class="filters">
          ${['全部', ...state.subjects].map((subject) => `<button class="${activeSubject === subject ? 'selected' : ''}" data-subject="${subject}">${subject}</button>`).join('')}
        </div>
        <div class="knowledge-map">
          ${filteredPoints.map(pointNode).join('')}
        </div>
      </article>
    </section>

    <section class="grid three-col">
      <article class="panel practice-panel">
        <div class="section-title">${icons.question}<div><p>题库训练</p><h2>${state.recommendation.title}</h2></div></div>
        ${state.questions.map(questionCard).join('')}
      </article>

      <article class="panel">
        <div class="section-title">${icons.report}<div><p>错题本</p><h2>自动归因复盘</h2></div></div>
        ${wrongBook()}
      </article>

      <article class="panel report-panel">
        <div class="section-title">${icons.report}<div><p>提分报告</p><h2>薄弱点与速度风险</h2></div></div>
        <p class="report-summary">${state.report.summary}</p>
        ${state.report.weakPoints.map(weakPoint).join('')}
        ${state.report.speedRisks.map(speedRisk).join('')}
      </article>
    </section>
  `;
}

function teacherView() {
  return `
    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.question}<div><p>题库管理</p><h2>题目入库与知识点绑定</h2></div></div>
        <table>
          <thead><tr><th>题目</th><th>知识点</th><th>难度</th><th>来源</th></tr></thead>
          <tbody>
            ${state.questions.map((question) => {
              const point = state.knowledgePoints.find((item) => item.id === question.knowledgePointIds[0]);
              return `<tr><td>${question.stem}</td><td>${point.title}</td><td>${question.difficulty}</td><td>${question.source}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </article>
      <article class="panel">
        <div class="section-title">${icons.graph}<div><p>学情分析</p><h2>班级薄弱章节</h2></div></div>
        ${state.report.weakPoints.map(weakPoint).join('')}
        <div class="paper-box">
          <strong>试卷管理建议</strong>
          <span>${state.recommendation.focus}</span>
          <button class="primary-action">生成阶段测验</button>
        </div>
      </article>
    </section>
  `;
}

function adminView() {
  return `
    <section class="metrics">
      ${metric('活跃用户', 1286, '近7日增长 12%')}
      ${metric('练习提交', 36840, '全部可追溯')}
      ${metric('内容待审', 23, '解析与AI答疑')}
      ${metric('平均学习', '92min', '单日人均')}
    </section>
    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.admin}<div><p>用户管理</p><h2>角色权限</h2></div></div>
        ${state.users.map((user) => `<div class="user-row"><strong>${user.name}</strong><span>${roleLabels[user.role]}</span><small>${user.targetSchool}</small></div>`).join('')}
      </article>
      <article class="panel">
        <div class="section-title">${icons.report}<div><p>系统配置</p><h2>408运营参数</h2></div></div>
        <div class="config-grid">
          ${state.subjects.map((subject) => `<span>${subject}</span>`).join('')}
          <span>难度：易 / 中 / 难</span>
          <span>推荐：规则 + 统计</span>
          <span>AI：辅助答疑审核</span>
        </div>
      </article>
    </section>
  `;
}

function metric(label, value, note) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function taskCard(task) {
  return `
    <div class="task-card">
      <span>${task.subject}</span>
      <strong>${task.title}</strong>
      <small>${task.mode} · ${task.questionCount}题 · ${task.minutes}分钟</small>
    </div>
  `;
}

function pointNode(point) {
  const weak = state.report.weakPoints.some((item) => item.knowledgePointId === point.id);
  const speed = state.report.speedRisks.some((item) => item.knowledgePointId === point.id);
  return `
    <div class="point-node ${weak ? 'weak' : ''} ${speed ? 'speed' : ''}">
      <span>${point.subject}</span>
      <strong>${point.title}</strong>
      <small>${point.chapter} · 考频 ${point.frequency}/5</small>
    </div>
  `;
}

function questionCard(question) {
  const answered = answeredQuestionIds.has(question.id);
  return `
    <div class="question-card ${answered ? 'answered' : ''}">
      <strong>${question.stem}</strong>
      <small>${question.type} · ${question.difficulty} · ${question.year}</small>
      <div class="answer-row">
        <button data-answer="${question.id}" data-correct="true">答对</button>
        <button data-answer="${question.id}" data-correct="false">答错</button>
        <span>${answered ? '已记录到练习轨迹' : question.analysis}</span>
      </div>
    </div>
  `;
}

function wrongBook() {
  const wrongRecords = state.practiceRecords.filter((record) => !record.correct);
  return wrongRecords.map((record) => {
    const question = state.questions.find((item) => item.id === record.questionId);
    const point = state.knowledgePoints.find((item) => item.id === record.knowledgePointId);
    return `
      <div class="wrong-row">
        <strong>${point.title}</strong>
        <span>${record.mistakeReason}</span>
        <small>${question.stem}</small>
      </div>
    `;
  }).join('');
}

function weakPoint(point) {
  return `
    <div class="insight-row">
      <strong>${point.chapter}</strong>
      <span>${point.title}</span>
      <small>${point.topReason} · ${point.suggestion}</small>
    </div>
  `;
}

function speedRisk(point) {
  return `
    <div class="insight-row speed-row">
      <strong>${point.chapter}</strong>
      <span>${point.title}</span>
      <small>正确率高但耗时偏长 · 加入限时训练</small>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll('[data-role]').forEach((button) => {
    button.addEventListener('click', () => {
      activeRole = button.dataset.role;
      render();
    });
  });

  document.querySelectorAll('[data-subject]').forEach((button) => {
    button.addEventListener('click', () => {
      activeSubject = button.dataset.subject;
      render();
    });
  });

  document.querySelectorAll('[data-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = state.questions.find((item) => item.id === button.dataset.answer);
      const correct = button.dataset.correct === 'true';
      answeredQuestionIds.add(question.id);
      const mistakeReason = classifyMistake({
        correct,
        selectedAnswer: correct ? question.answer : 'A',
        correctAnswer: question.answer,
        timeSpentSec: correct ? 95 : 170,
        expectedTimeSec: 100,
      });
      toast(correct ? '本题已计入掌握度' : `已加入错题本：${mistakeReason}`);
      render();
    });
  });
}

function toast(message) {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

render();
