import { useState } from 'react';
import { YearBoard } from './YearBoard';
import { ExamDataScreens } from './ExamDataScreens';
import { YearPapers, type StartYearPaperResult } from './YearPapers';

type Tab = 'board' | 'papers' | 'screens';

/**
 * V14-R4「真题」分区 — 作战板 + 套卷 + 数据屏。
 * 各标签页取数独立、失败显式展示；本分区不依赖首页资源状态。
 * 套卷组卷由 App 层回调（onStartYearPaper）完成并跳转既有整卷作答流。
 */
export function RealExamWorkspace({ onStartYearPaper }: { onStartYearPaper?: (year: number) => Promise<StartYearPaperResult> }) {
  const [tab, setTab] = useState<Tab>('board');

  return (
    <div className="real-exam-workspace">
      <header className="real-exam-header">
        <h2>真题</h2>
        <nav className="real-exam-tabs" aria-label="真题分区标签">
          <button type="button" className={tab === 'board' ? 'real-exam-tab active' : 'real-exam-tab'} onClick={() => setTab('board')}>
            作战板
          </button>
          <button type="button" className={tab === 'papers' ? 'real-exam-tab active' : 'real-exam-tab'} onClick={() => setTab('papers')}>
            套卷
          </button>
          <button type="button" className={tab === 'screens' ? 'real-exam-tab active' : 'real-exam-tab'} onClick={() => setTab('screens')}>
            数据屏
          </button>
        </nav>
        <p className="muted">历年真题一页看全：做过的格子会点亮，套卷按年一键组卷，数据屏告诉你该优先啃哪里。</p>
      </header>
      {tab === 'board' ? <YearBoard /> : null}
      {tab === 'papers' && onStartYearPaper ? <YearPapers onStartYearPaper={onStartYearPaper} /> : null}
      {tab === 'screens' ? <ExamDataScreens /> : null}
    </div>
  );
}
