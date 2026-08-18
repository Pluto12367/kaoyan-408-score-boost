import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  createKnowledgePoint,
  createMockGeneratedPaper,
  createMockPaperSubmitResult,
  createTeacherQuestion,
  deleteTeacherQuestion,
  fetchDashboardOverview,
  fetchQuestions,
  generatePaper,
  isStaticDemoMode,
  submitPaper,
  updateTeacherQuestion,
  type GeneratedPaper,
  type PaperSubmitResult,
  type Question,
} from '../../api';
import { createInitialPaperSession } from '../../constants';
import { isMockAllowed } from '../../api/env';
import type { ApiState } from '../../components/ApiStateIndicator';

type OverviewState = Awaited<ReturnType<typeof fetchDashboardOverview>>;

interface TeacherActionsOptions {
  teacherQuestionList: Question[];
  setTeacherQuestionList: Dispatch<SetStateAction<Question[]>>;
  setLatestPaper: Dispatch<SetStateAction<GeneratedPaper | null>>;
  setPaperResult: Dispatch<SetStateAction<PaperSubmitResult | null>>;
  setPaperSession: Dispatch<SetStateAction<PaperSubmitResult['examSession'] | null>>;
  setOverview: Dispatch<SetStateAction<OverviewState>>;
  setApiState: Dispatch<SetStateAction<ApiState>>;
  refreshMasteryMap: () => Promise<void>;
  refreshWrongQuestionSummary: () => Promise<void>;
  refreshAssessmentHistory: () => Promise<void>;
  studentId: string;
  currentQuestion: Question;
}

export function useTeacherActions(options: TeacherActionsOptions) {
  const [teacherStatus, setTeacherStatus] = useState('教师可以新增题目，学生端会立即用于检索和练习。');
  const [knowledgeStatus, setKnowledgeStatus] = useState('教研可以维护 408 知识树，新增考点后可用于题目绑定。');
  const [paperStatus, setPaperStatus] = useState('教师可以按知识点生成专项卷、阶段卷或模拟卷。');

  async function createQuestion() {
    setTeacherStatus('正在新增题目...');

    try {
      const created = await createTeacherQuestion({
        stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？',
        options: ['增大', '不变', '减小', '无法判断'],
        answer: 'C',
        analysis: '命中率提高后，访问更多落在高速 Cache 中，平均访存时间通常减小。',
        knowledgePointIds: ['co-cache'],
        difficulty: options.currentQuestion.difficulty,
        type: options.currentQuestion.type,
        source: '教师新增',
        year: 2026,
        expectedTimeSec: 90,
      });
      const nextQuestions = await fetchQuestions();
      options.setTeacherQuestionList(nextQuestions);
      options.setApiState('connected');
      setTeacherStatus(`已新增 ${created.id}，当前题库共 ${nextQuestions.length} 题。`);
    } catch {
      setTeacherStatus('题目录入失败，请检查题干、选项、答案和知识点绑定。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function filterQuestions() {
    setTeacherStatus('正在按 Cache 考点筛选题目...');

    try {
      const nextQuestions = await fetchQuestions({ knowledgePointId: 'co-cache' });
      options.setTeacherQuestionList(nextQuestions);
      options.setApiState('connected');
      setTeacherStatus(`已筛选出 ${nextQuestions.length} 道 Cache 映射与替换相关题目。`);
    } catch {
      if (isMockAllowed()) {
        options.setTeacherQuestionList(options.teacherQuestionList.filter((question) => question.knowledgePointIds.includes('co-cache')));
        setTeacherStatus('已使用本地演示题库筛选 Cache 相关题目。');
        options.setApiState('mock');
      } else {
        setTeacherStatus('题目筛选失败，当前列表保持不变，请稍后重试。');
        options.setApiState('error');
      }
    }
  }

  async function updateQuestion() {
    const target = options.teacherQuestionList.find((question) => question.id.startsWith('q-')) ?? options.teacherQuestionList[0];
    if (!target) {
      setTeacherStatus('当前没有可编辑的演示题目。');
      return;
    }

    setTeacherStatus('正在编辑演示题目...');

    if (isStaticDemoMode()) {
      const updated = {
        ...target,
        difficulty: '困难' as typeof target.difficulty,
        analysis: '更新后的解析用于教师维护题目质量。',
        expectedTimeSec: 150,
      };
      options.setTeacherQuestionList(options.teacherQuestionList.map((question) => question.id === target.id ? updated : question));
      setTeacherStatus(`已使用静态演示数据更新 ${target.id}：难度改为困难，预计 150 秒。`);
      options.setApiState('mock');
      return;
    }

    try {
      const updated = await updateTeacherQuestion(target.id, {
        difficulty: '困难',
        analysis: '更新后的解析用于教师维护题目质量。',
        expectedTimeSec: 150,
      });
      const nextQuestions = await fetchQuestions();
      options.setTeacherQuestionList(nextQuestions);
      options.setApiState('connected');
      setTeacherStatus(`已更新 ${updated.id}：难度 ${updated.difficulty}，预计 ${updated.expectedTimeSec} 秒。`);
    } catch {
      setTeacherStatus('题目编辑失败，请稍后重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function deleteQuestion() {
    const target = options.teacherQuestionList.find((question) => !['q-001', 'q-002'].includes(question.id)) ?? options.teacherQuestionList[0];
    if (!target) {
      setTeacherStatus('当前没有可删除的演示题目。');
      return;
    }

    setTeacherStatus('正在删除演示题目...');

    if (isStaticDemoMode()) {
      options.setTeacherQuestionList(options.teacherQuestionList.filter((question) => question.id !== target.id));
      setTeacherStatus(`已使用静态演示数据删除 ${target.id}。`);
      options.setApiState('mock');
      return;
    }

    try {
      const deleted = await deleteTeacherQuestion(target.id);
      const nextQuestions = await fetchQuestions();
      options.setTeacherQuestionList(nextQuestions);
      options.setApiState('connected');
      setTeacherStatus(`已删除 ${deleted.id}，筛选列表已刷新。`);
    } catch {
      setTeacherStatus('题目删除失败，请稍后重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function createKnowledge() {
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
      options.setApiState('connected');
      setKnowledgeStatus(`已新增知识点：${point.title}。`);
    } catch {
      setKnowledgeStatus('知识点新增失败，请检查 ID、科目、章节和标题。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function generatePaperForTeacher() {
    setPaperStatus('正在生成专项卷...');

    if (isStaticDemoMode()) {
      const mockPaper = createMockGeneratedPaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      options.setLatestPaper(mockPaper);
      options.setPaperSession(createInitialPaperSession(mockPaper));
      options.setPaperResult(null);
      options.setApiState('mock');
      setPaperStatus(`已使用静态演示数据生成 ${mockPaper.title}，共 ${mockPaper.questionCount} 题，可继续提交查看报告。`);
      return;
    }

    try {
      const paper = await generatePaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      options.setLatestPaper(paper);
      options.setPaperSession(createInitialPaperSession(paper));
      options.setPaperResult(null);
      options.setApiState('connected');
      setPaperStatus(`已生成 ${paper.title}，共 ${paper.questionCount} 题，预计 ${paper.estimatedMinutes} 分钟。`);
    } catch {
      if (!isMockAllowed()) {
        setPaperStatus('试卷生成失败，请检查 API 连接后重试。');
        options.setApiState('error');
        return;
      }
      const mockPaper = createMockGeneratedPaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      options.setLatestPaper(mockPaper);
      options.setPaperSession(createInitialPaperSession(mockPaper));
      options.setPaperResult(null);
      setPaperStatus(`已使用静态演示数据生成 ${mockPaper.title}，共 ${mockPaper.questionCount} 题，可继续提交查看报告。`);
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  function startPaperSession(latestPaper: GeneratedPaper | null) {
    const paper = latestPaper;
    if (!paper) {
      setPaperStatus('请先生成一套演示试卷。');
      return;
    }

    const elapsedSec = paper.questions.reduce((sum, question) => sum + question.expectedTimeSec + 15, 0);
    const session = {
      answeredCount: paper.questions.length,
      unansweredCount: 0,
      totalQuestions: paper.questions.length,
      elapsedSec,
      timeLimitSec: paper.estimatedMinutes * 60,
      overtime: elapsedSec > paper.estimatedMinutes * 60,
      progressRate: 100,
    };
    options.setPaperSession(session);
    setPaperStatus(`已完成演示答卷：${session.answeredCount}/${session.totalQuestions} 题，用时 ${Math.round(session.elapsedSec / 60)} 分钟，可提交查看报告。`);
  }

  async function submitPaperForTeacher(
    latestPaper: GeneratedPaper | null,
    addMockPaperResultToHistory: (result: PaperSubmitResult, paper: GeneratedPaper) => void,
  ) {
    const paper = latestPaper;
    if (!paper) {
      setPaperStatus('请先生成一套演示试卷。');
      return;
    }

    setPaperStatus('正在提交演示试卷...');

    if (isStaticDemoMode()) {
      const mockResult = createMockPaperSubmitResult(paper, options.studentId);
      options.setPaperResult(mockResult);
      options.setPaperSession(mockResult?.examSession ?? null);
      if (mockResult) addMockPaperResultToHistory(mockResult, paper);
      options.setApiState('mock');
      setPaperStatus(mockResult
        ? `已使用静态演示数据提交：${mockResult.score} 分，正确率 ${mockResult.accuracyRate}%，可查看试卷报告。`
        : '试卷提交失败，请稍后重试。');
      return;
    }

    try {
      const result = await submitPaper({
        paperId: paper.id,
        answers: paper.questions.map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index === 0 ? (question.answer === 'A' ? 'B' : 'A') : question.answer,
          timeSpentSec: question.expectedTimeSec + 15,
        })),
      });
      const nextOverview = await fetchDashboardOverview();
      options.setPaperResult(result);
      options.setPaperSession(result.examSession);
      options.setOverview(nextOverview);
      await options.refreshMasteryMap();
      await options.refreshWrongQuestionSummary();
      await options.refreshAssessmentHistory();
      options.setApiState('connected');
      setPaperStatus(`试卷已提交：${result.score} 分，正确率 ${result.accuracyRate}%，已同步 ${result.syncedPracticeRecordCount} 条练习记录。`);
    } catch {
      if (!isMockAllowed()) {
        setPaperStatus('试卷提交失败，未生成任何演示成绩，请稍后重试。');
        options.setApiState('error');
        return;
      }
      const mockResult = createMockPaperSubmitResult(paper, options.studentId);
      options.setPaperResult(mockResult);
      options.setPaperSession(mockResult?.examSession ?? null);
      if (mockResult) addMockPaperResultToHistory(mockResult, paper);
      setPaperStatus(mockResult
        ? `已使用静态演示数据提交：${mockResult.score} 分，正确率 ${mockResult.accuracyRate}%，可查看试卷报告。`
        : '试卷提交失败，请稍后重试。');
      options.setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  return {
    teacherStatus,
    knowledgeStatus,
    paperStatus,
    setPaperStatus,
    createQuestion,
    filterQuestions,
    updateQuestion,
    deleteQuestion,
    createKnowledge,
    generatePaper: generatePaperForTeacher,
    startPaperSession,
    submitPaper: submitPaperForTeacher,
  };
}
