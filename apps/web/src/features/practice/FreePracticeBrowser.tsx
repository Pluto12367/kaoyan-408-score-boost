import { useMemo, useState } from 'react';
import type { KnowledgePoint, Question } from '@kaoyan408/shared';
import {
  buildFreePracticeSet,
  filterBrowseQuestions,
  findRowIndex,
  FREE_PRACTICE_MAX_QUESTIONS,
  paginateBrowseRows,
  type BrowseRow,
  type BrowseStatusFilter,
} from './questionBankBrowser';

/**
 * V14 题库浏览/自由刷题（任务书 docs/v14-question-bank-browser-design.md，
 * Owner 批准 D-B-1..4 按建议冻结；Phase 2 = 难度筛选/题干搜索/年份+题号定位）。
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
const DIFFICULTY_OPTIONS: Question['difficulty'][] = ['基础', '中等', '困难'];

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
  const [difficulty, setDifficulty] = useState<'all' | Question['difficulty']>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  // Phase 2 定位：年份+题号 → 跳页并高亮该行。
  const [locateYear, setLocateYear] = useState<string>(String(new Date().getFullYear() - 1));
  const [locateExamNo, setLocateExamNo] = useState('');
  const [locateMiss, setLocateMiss] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

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
      difficulty,
      query,
    },
  }), [questions, subjectByPointId, practiceRecords, subject, type, year, status, difficulty, query]);

  const pageData = useMemo(() => paginateBrowseRows(rows, page, PAGE_SIZE), [rows, page]);
  const freeSet = useMemo(() => buildFreePracticeSet(rows), [rows]);

  function resetFilters() {
    setSubject('all');
    setType('all');
    setYear('all');
    setStatus('all');
    setDifficulty('all');
    setQuery('');
    setPage(1);
    setHighlightId(null);
    setLocateMiss(false);
  }

  function handleLocate() {
    const examNo = Number(locateExamNo);
    if (!locateYear || !Number.isInteger(examNo) || examNo < 1) return;
    const index = findRowIndex(rows, Number(locateYear), examNo);
    if (index < 0) {
      setHighlightId(null);
      setLocateMiss(true);
      return;
    }
    setLocateMiss(false);
    setHighlightId(rows[index].id);
    setPage(Math.floor(index / PAGE_SIZE) + 1);
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
          难度
          <select value={difficulty} onChange={(event) => { setDifficulty(event.target.value as 'all' | Question['difficulty']); setPage(1); }}>
            <option value="all">全部</option>
            {DIFFICULTY_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
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
        <label>
          题干搜索
          <input
            type="search"
            value={query}
            placeholder="输入关键词，如 散列表"
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          />
        </label>
        <button type="button" className="qbank-reset" onClick={resetFilters}>重置筛选</button>
      </div>

      <div className="qbank-locate" role="group" aria-label="按年份题号定位">
        <span>定位真题：</span>
        <select value={locateYear} onChange={(event) => setLocateYear(event.target.value)} aria-label="定位年份">
          {years.map((value) => <option key={value} value={String(value)}>{value}</option>)}
        </select>
        <span>第</span>
        <input
          type="number"
          min={1}
          max={47}
          value={locateExamNo}
          placeholder="题号"
          aria-label="定位题号"
          onChange={(event) => setLocateExamNo(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') handleLocate(); }}
        />
        <span>题</span>
        <button type="button" className="secondary-action" onClick={handleLocate}>定位</button>
        {locateMiss ? <span className="qbank-locate-miss" role="status">当前筛选范围内没有该题——年份或题号有误，或已被筛选条件排除。</span> : null}
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
              <li
                key={row.id}
                className={`qbank-row qbank-status-${row.status}${row.id === highlightId ? ' qbank-row-locate' : ''}`}
              >
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
