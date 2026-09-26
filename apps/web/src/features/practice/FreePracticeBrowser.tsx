import { useMemo, useState } from 'react';
import type { KnowledgePoint, Question } from '@kaoyan408/shared';
import {
  buildFreePracticeSet,
  filterBrowseQuestions,
  FREE_PRACTICE_MAX_QUESTIONS,
  paginateBrowseRows,
  type BrowseRow,
  type BrowseStatusFilter,
} from './questionBankBrowser';

/**
 * V14 题库浏览/自由刷题（任务书 docs/v14-question-bank-browser-design.md，
 * Owner 批准 D-B-1..4 按建议冻结：题库训练子标签 / 四维筛选 / 逐题+组卷≤50 /
 * student-only）。
 *
 * 数据全部来自学生目录（overview.questions——揭示性字段已在投影层置空或剥离）
 * 与 overview.practiceRecords——纯客户端过滤，浏览行为零写入。
 */

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<BrowseRow['status'], string> = {
  unanswered: '未做',
  wrong: '做错',
  correct: '做对',
};

const SUBJECT_OPTIONS = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

interface QuestionBankBrowserProps {
  questions: Question[];
  knowledgePoints: KnowledgePoint[];
  practiceRecords: Array<{ questionId: string; correct: boolean }>;
  onStartPractice: (title: string, questionIds: string[]) => void;
}

export function FreePracticeBrowser({ questions, knowledgePoints, practiceRecords, onStartPractice }: QuestionBankBrowserProps) {
  const [subject, setSubject] = useState<string>('all');
  const [type, setType] = useState<'all' | Question['type']>('all');
  const [year, setYear] = useState<string>('all');
  const [status, setStatus] = useState<BrowseStatusFilter>('all');
  const [page, setPage] = useState(1);

  const subjectByPointId = useMemo(() => {
    const map = new Map<string, string>();
    for (const point of knowledgePoints) map.set(point.id, point.subject);
    return map;
  }, [knowledgePoints]);

  const years = useMemo(() => {
    const distinct = new Set<number>();
    for (const question of questions) if (question.year != null) distinct.add(question.year);
    return [...distinct].sort((left, right) => right - left);
  }, [questions]);

  const rows = useMemo(() => filterBrowseQuestions({
    questions,
    subjectByPointId,
    records: practiceRecords,
    filters: {
      subject: subject === 'all' ? null : subject,
      type,
      year: year === 'all' ? null : Number(year),
      status,
    },
  }), [questions, subjectByPointId, practiceRecords, subject, type, year, status]);

  const pageData = useMemo(() => paginateBrowseRows(rows, page, PAGE_SIZE), [rows, page]);
  const freeSet = useMemo(() => buildFreePracticeSet(rows), [rows]);

  function resetFilters() {
    setSubject('all');
    setType('all');
    setYear('all');
    setStatus('all');
    setPage(1);
  }

  return (
    <div className="qbank-browser" data-testid="question-bank-browser">
      <div className="qbank-filters" role="group" aria-label="题库筛选">
        <label>
          科目
          <select value={subject} onChange={(event) => { setSubject(event.target.value); setPage(1); }}>
            <option value="all">全部</option>
            {SUBJECT_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          题型
          <select value={type} onChange={(event) => { setType(event.target.value as 'all' | Question['type']); setPage(1); }}>
            <option value="all">全部</option>
            <option value="选择题">选择题</option>
            <option value="综合题">综合题</option>
          </select>
        </label>
        <label>
          年份
          <select value={year} onChange={(event) => { setYear(event.target.value); setPage(1); }}>
            <option value="all">全部</option>
            {years.map((value) => <option key={value} value={String(value)}>{value}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={status} onChange={(event) => { setStatus(event.target.value as BrowseStatusFilter); setPage(1); }}>
            <option value="all">全部</option>
            <option value="unanswered">未做</option>
            <option value="wrong">做错</option>
            <option value="correct">做对</option>
          </select>
        </label>
        <button type="button" className="qbank-reset" onClick={resetFilters}>重置筛选</button>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state" role="status">该条件下暂无题目——收窄或重置筛选条件再试。</p>
      ) : (
        <>
          <div className="qbank-summary">
            <span>筛选结果 <strong>{rows.length}</strong> 题 · 第 {pageData.page} / {pageData.pageCount} 页</span>
            <button
              type="button"
              className="primary-action"
              onClick={() => onStartPractice(freeSet.total > FREE_PRACTICE_MAX_QUESTIONS
                ? `题库自由刷题（前 ${FREE_PRACTICE_MAX_QUESTIONS} 题）`
                : `题库自由刷题（${freeSet.total} 题）`, freeSet.questionIds)}
            >
              {freeSet.capped
                ? `练习前 ${FREE_PRACTICE_MAX_QUESTIONS} 题（共 ${freeSet.total} 题，超出单轮上限）`
                : `整组练习（${freeSet.total} 题）`}
            </button>
          </div>
          <ul className="qbank-rows">
            {pageData.rows.map((row) => (
              <li key={row.id} className={`qbank-row qbank-status-${row.status}`}>
                <div className="qbank-row-meta">
                  <span className="qbank-badge">{row.type}</span>
                  <span className="qbank-badge">{row.difficulty}</span>
                  {row.year != null ? <span className="qbank-badge">{row.year} 年</span> : null}
                  {row.examNo != null ? <span className="qbank-badge">第 {row.examNo} 题</span> : null}
                  {row.maxScore != null ? <span className="qbank-badge">{row.maxScore} 分</span> : null}
                  <span className={`qbank-badge qbank-state-${row.status}`}>{STATUS_LABELS[row.status]}</span>
                </div>
                <p className="qbank-row-stem">{row.stemPreview}</p>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => onStartPractice('题库浏览 · 单题练习', [row.id])}
                >
                  练习此题 →
                </button>
              </li>
            ))}
          </ul>
          {pageData.pageCount > 1 ? (
            <div className="qbank-pagination">
              <button type="button" disabled={pageData.page <= 1} onClick={() => setPage(pageData.page - 1)}>上一页</button>
              <span>第 {pageData.page} / {pageData.pageCount} 页</span>
              <button type="button" disabled={pageData.page >= pageData.pageCount} onClick={() => setPage(pageData.page + 1)}>下一页</button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
