import {
  applyDiagnosticProfile,
  createPracticeRecord,
  createTeacherQuestion,
  generateTutorReply,
} from './appLogic.js';
import { createDashboardState, refreshDerivedState } from './appData.js';

const state = createDashboardState();
let activeRole = 'student';
let activeSubject = '全部';
let selectedAnswers = {};

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
      ${metric('剩余天数', state.student.remainingDays, '按阶段动态调整')}
      ${metric('每日学习', `${state.student.dailyHours}h`, '计划自动拆分任务')}
      ${metric('预计提分', `${state.report.estimatedGain}分`, '基于错因与正确率')}
      ${metric('完成率', `${state.report.completionRate}%`, '练习记录可追溯')}
    </section>

    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.dashboard}<div><p>入学诊断</p><h2>填写真实状态生成计划</h2></div></div>
        ${diagnosticForm()}
      </article>
      <article class="panel">
        <div class="section-title">${icons.plan}<div><p>学习计划</p><h2>${state.plan.phase}</h2></div></div>
        <div class="task-list">${state.plan.dailyTasks.map(taskCard).join('')}</div>
      </article>
    </section>

    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.graph}<div><p>408知识图谱</p><h2>按科目定位薄弱链路</h2></div></div>
        <div class="filters">
          ${['全部', ...state.subjects].map((subject) => `<button class="${activeSubject === subject ? 'selected' : ''}" data-subject="${subject}">${subject}</button>`).join('')}
        </div>
        <div class="knowledge-map">${filteredPoints.map(pointNode).join('')}</div>
      </article>
      <article class="panel report-panel">
        <div class="section-title">${icons.report}<div><p>提分报告</p><h2>薄弱点与速度风险</h2></div></div>
        <p class="report-summary">${state.report.summary}</p>
        ${state.report.weakPoints.map(weakPoint).join('')}
        ${state.report.speedRisks.map(speedRisk).join('')}
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
      <article class="panel">
        <div class="section-title">${icons.question}<div><p>AI答疑</p><h2>基于题目解析生成建议</h2></div></div>
        ${aiTutor()}
      </article>
    </section>
  `;
}

function diagnosticForm() {
  return `
    <form class="form-grid" data-diagnostic-form>
      <label>目标分数<input name="targetScore" type="number" min="1" max="150" value="${state.student.targetScore}"></label>
      <label>当前估分<input name="currentScore" type="number" min="0" max="150" value="${state.student.currentScore}"></label>
      <label>剩余天数<input name="remainingDays" type="number" min="1" max="365" value="${state.student.remainingDays}"></label>
      <label>每日学习小时<input name="dailyHours" type="number" min="0.5" max="12" step="0.5" value="${state.student.dailyHours}"></label>
      <label class="full">最薄弱科目
        <select name="weakestSubject">
          ${state.subjects.map((subject) => `<option ${state.student.weakestSubject === subject ? 'selected' : ''}>${subject}</option>`).join('')}
        </select>
      </label>
      <button class="primary-action full" type="submit">重新生成诊断与计划</button>
      ${state.diagnosticNote ? `<p class="helper-text full">${state.diagnosticNote}</p>` : ''}
    </form>
  `;
}

function aiTutor() {
  const selectedQuestion = state.questions.find((question) => question.id === state.selectedQuestionId) ?? state.questions[0];
  return `
    <label class="stacked-label">选择题目
      <select data-ai-question>
        ${state.questions.map((question) => `<option value="${question.id}" ${selectedQuestion.id === question.id ? 'selected' : ''}>${question.stem.slice(0, 24)}...</option>`).join('')}
      </select>
    </label>
    <button class="primary-action wide" data-ai-generate>生成答疑建议</button>
    <pre class="ai-reply">${state.aiReply || '选择一道题后点击生成，系统会给出考点、答案、解析和相似题建议。'}</pre>
  `;
}

function teacherView() {
  return `
    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.question}<div><p>题库管理</p><h2>题目入库与知识点绑定</h2></div></div>
        ${teacherQuestionForm()}
        ${questionTable()}
      </article>
      <article class="panel">
        <div class="section-title">${icons.graph}<div><p>学情分析</p><h2>班级薄弱章节</h2></div></div>
        ${state.report.weakPoints.map(weakPoint).join('')}
        <div class="paper-box">
          <strong>试卷管理建议</strong>
          <span>${state.recommendation.focus}</span>
          <button class="primary-action" data-generate-paper>生成阶段测验</button>
          ${state.generatedPaper ? `<small>${state.generatedPaper}</small>` : ''}
        </div>
      </article>
    </section>
  `;
}

function teacherQuestionForm() {
  return `
    <form class="teacher-form" data-question-form>
      <input name="stem" placeholder="输入新增题干，例如：LRU 页面置换依据是什么？" required>
      <input name="options" placeholder="选项用 / 分隔，例如：未来访问/最近最久未使用/随机替换/先进先出" required>
      <select name="knowledgePointId">${state.knowledgePoints.map((point) => `<option value="${point.id}">${point.subject} - ${point.title}</option>`).join('')}</select>
      <select name="answer"><option>A</option><option>B</option><option>C</option><option>D</option></select>
      <select name="difficulty"><option>易</option><option selected>中</option><option>难</option></select>
      <input name="analysis" placeholder="解析" required>
      <button class="primary-action" type="submit">新增题目</button>
    </form>
  `;
}

function questionTable() {
  return `
    <table>
      <thead><tr><th>题目</th><th>知识点</th><th>难度</th><th>来源</th></tr></thead>
      <tbody>
        ${state.questions.map((question) => {
          const point = state.knowledgePoints.find((item) => item.id === question.knowledgePointIds[0]);
          return `<tr><td>${question.stem}</td><td>${point.title}</td><td>${question.difficulty}</td><td>${question.source}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function adminView() {
  return `
    <section class="metrics">
      ${metric('活跃用户', 1286, '近7日增长 12%')}
      ${metric('练习提交', state.practiceRecords.length, '全部可追溯')}
      ${metric('内容待审', state.config.aiReviewRequired ? 23 : 0, '解析与AI答疑')}
      ${metric('平均学习', '92min', '单日人均')}
    </section>
    <section class="grid two-col">
      <article class="panel">
        <div class="section-title">${icons.admin}<div><p>用户管理</p><h2>角色权限</h2></div></div>
        ${state.users.map((user) => `<div class="user-row"><strong>${user.name}</strong><span>${roleLabels[user.role]}</span><small>${user.targetSchool}</small></div>`).join('')}
      </article>
      <article class="panel">
        <div class="section-title">${icons.report}<div><p>系统配置</p><h2>408运营参数</h2></div></div>
        <div class="toggle-list">
          ${configToggle('dailyReminder', '每日任务提醒')}
          ${configToggle('wrongQuestionReminder', '错题重做提醒')}
          ${configToggle('weeklyReport', '每周提分报告')}
          ${configToggle('aiReviewRequired', 'AI答疑内容审核')}
        </div>
      </article>
    </section>
  `;
}

function configToggle(key, label) {
  return `
    <label class="toggle-row">
      <span>${label}</span>
      <input type="checkbox" data-config="${key}" ${state.config[key] ? 'checked' : ''}>
    </label>
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
    <button class="point-node ${weak ? 'weak' : ''} ${speed ? 'speed' : ''}" data-subject="${point.subject}">
      <span>${point.subject}</span>
      <strong>${point.title}</strong>
      <small>${point.chapter} · 考频 ${point.frequency}/5</small>
    </button>
  `;
}

function questionCard(question) {
  const selected = selectedAnswers[question.id];
  const latestRecord = [...state.practiceRecords].reverse().find((record) => record.questionId === question.id);
  return `
    <div class="question-card ${latestRecord ? 'answered' : ''}">
      <strong>${question.stem}</strong>
      <small>${question.type} · ${question.difficulty} · ${question.year}</small>
      <div class="option-grid">
        ${question.options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          return `<button class="${selected === letter ? 'selected' : ''}" data-select-answer="${question.id}" data-option="${letter}">${letter}. ${option}</button>`;
        }).join('')}
      </div>
      <div class="answer-row">
        <button class="primary-action" data-submit-answer="${question.id}">提交作答</button>
        <button data-ai-from-question="${question.id}">问AI解析</button>
        <span>${latestRecord ? `${latestRecord.correct ? '答对' : '答错'} · ${latestRecord.mistakeReason ?? '已掌握'} · ${question.analysis}` : '请选择选项后提交，系统会更新错题本和提分报告。'}</span>
      </div>
    </div>
  `;
}

function wrongBook() {
  const wrongRecords = state.practiceRecords.filter((record) => !record.correct);
  if (wrongRecords.length === 0) return '<p class="helper-text">暂无错题，继续保持。</p>';

  return wrongRecords.slice(-6).reverse().map((record) => {
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
      <small>${point.topReason ?? '复盘不足'} · ${point.suggestion}</small>
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

  document.querySelector('[data-diagnostic-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const profile = applyDiagnosticProfile(Object.fromEntries(form.entries()));
    Object.assign(state.student, profile);
    state.diagnosticNote = profile.diagnosis;
    refreshDerivedState(state);
    toast('已根据诊断重新生成学习计划');
    render();
  });

  document.querySelectorAll('[data-select-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedAnswers[button.dataset.selectAnswer] = button.dataset.option;
      render();
    });
  });

  document.querySelectorAll('[data-submit-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = state.questions.find((item) => item.id === button.dataset.submitAnswer);
      const selectedAnswer = selectedAnswers[question.id];
      if (!selectedAnswer) {
        toast('请先选择一个选项');
        return;
      }
      const record = createPracticeRecord({
        userId: state.student.id,
        question,
        selectedAnswer,
        timeSpentSec: selectedAnswer === question.answer ? 85 : 165,
      });
      state.practiceRecords.push(record);
      refreshDerivedState(state);
      toast(record.correct ? '答对，掌握度已更新' : `答错，已加入错题本：${record.mistakeReason}`);
      render();
    });
  });

  document.querySelectorAll('[data-ai-from-question]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedQuestionId = button.dataset.aiFromQuestion;
      activeRole = 'student';
      generateAiReply();
      render();
    });
  });

  document.querySelector('[data-ai-question]')?.addEventListener('change', (event) => {
    state.selectedQuestionId = event.target.value;
    state.aiReply = '';
    render();
  });

  document.querySelector('[data-ai-generate]')?.addEventListener('click', () => {
    generateAiReply();
    render();
  });

  document.querySelector('[data-question-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const question = createTeacherQuestion({
      stem: form.get('stem'),
      options: form.get('options').split('/'),
      answer: form.get('answer'),
      analysis: form.get('analysis'),
      knowledgePointIds: [form.get('knowledgePointId')],
      difficulty: form.get('difficulty'),
      type: '选择题',
      source: '教研新增',
      year: 2026,
      existingCount: state.questions.length,
    });
    state.questions.push(question);
    toast('题目已新增，学生端题库会同步出现');
    render();
  });

  document.querySelector('[data-generate-paper]')?.addEventListener('click', () => {
    const titles = state.report.weakPoints.slice(0, 3).map((point) => point.title).join('、');
    state.generatedPaper = `已生成 20 题阶段测验，覆盖：${titles || '408 高频考点'}。`;
    toast('阶段测验已生成');
    render();
  });

  document.querySelectorAll('[data-config]').forEach((input) => {
    input.addEventListener('change', () => {
      state.config[input.dataset.config] = input.checked;
      toast('系统配置已更新');
      render();
    });
  });
}

function generateAiReply() {
  const question = state.questions.find((item) => item.id === state.selectedQuestionId);
  state.aiReply = generateTutorReply({
    question,
    knowledgePoints: state.knowledgePoints,
    selectedAnswer: selectedAnswers[question.id],
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
