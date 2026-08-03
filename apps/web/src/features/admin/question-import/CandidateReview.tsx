import { Check, Download, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { QuestionImportCandidate } from '../../../api';
import { FormulaPreview } from './FormulaPreview';
import { QuestionAssetEditor } from './QuestionAssetEditor';
import { SourcePagePreview } from './SourcePagePreview';

type Draft = Pick<
  QuestionImportCandidate,
  | 'stem'
  | 'options'
  | 'answer'
  | 'analysis'
  | 'source'
  | 'year'
  | 'expectedTimeSec'
  | 'knowledgePointIds'
  | 'duplicateAction'
  | 'formulas'
  | 'assetIds'
> & { type: string; difficulty: string };

const toDraft = (candidate: QuestionImportCandidate): Draft => ({
  stem: candidate.stem,
  options: candidate.options,
  answer: candidate.answer,
  analysis: candidate.analysis,
  source: candidate.source,
  year: candidate.year,
  expectedTimeSec: candidate.expectedTimeSec,
  knowledgePointIds: candidate.knowledgePointIds,
  duplicateAction: candidate.duplicateAction,
  formulas: candidate.formulas ?? [],
  assetIds: candidate.assetIds ?? [],
  type: candidate.type,
  difficulty: candidate.difficulty,
});

function downloadErrors(candidates: QuestionImportCandidate[]) {
  const rows = [['页码', '字段', '代码', '原因', '建议']];
  candidates
    .flatMap((candidate) =>
      candidate.warnings.map((warning) => [
        String(candidate.sourceRowNumber ?? candidate.sourcePageNumber ?? ''),
        warning.field ?? '',
        warning.code,
        warning.message,
        warning.suggestion,
      ]),
    )
    .forEach((row) => rows.push(row));
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'question-import-errors.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

export function CandidateReview({
  candidates,
  onBulkApprove,
  onUpdate,
  onConfirm,
}: {
  candidates: QuestionImportCandidate[];
  onBulkApprove: (items: QuestionImportCandidate[]) => Promise<void>;
  onUpdate: (candidate: QuestionImportCandidate, patch: Record<string, unknown>) => Promise<void>;
  onConfirm: (items: QuestionImportCandidate[]) => Promise<void>;
}) {
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string>();
  const [saveError, setSaveError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => candidates.some((candidate) => candidate.id === id)));
    setDrafts(Object.fromEntries(candidates.map((candidate) => [candidate.id, toDraft(candidate)])));
  }, [candidates]);

  const shown = useMemo(
    () =>
      abnormalOnly
        ? candidates.filter(
            (candidate) =>
              candidate.warnings.length || candidate.status === 'duplicate_suspected' || candidate.status === 'needs_edit',
          )
        : candidates,
    [abnormalOnly, candidates],
  );
  const selected = shown.filter((candidate) => selectedIds.includes(candidate.id));
  const warningFree = selected.filter(
    (candidate) => candidate.warnings.length === 0 && ['pending_review', 'duplicate_suspected'].includes(candidate.status),
  );
  const approved = selected.filter((candidate) => candidate.status === 'approved');

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(0, shown.length - 1)));
      }
      if (event.key.toLowerCase() === 'a') {
        const candidate = shown[activeIndex];
        if (candidate && !candidate.warnings.length) void onBulkApprove([candidate]);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, onBulkApprove, shown]);

  function toggle(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  }

  function change(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function save(candidate: QuestionImportCandidate) {
    const draft = drafts[candidate.id];
    if (!draft) return;
    const { assetIds: _assetIds, ...patch } = draft;
    setSavingId(candidate.id);
    setSaveError('');
    try {
      await onUpdate(candidate, patch);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '保存失败；请刷新后重试。');
    } finally {
      setSavingId(undefined);
    }
  }

  async function confirm() {
    if (approved.some((candidate) => (drafts[candidate.id] ?? candidate).duplicateAction === 'new_version') && !confirmVersion) {
      setConfirmVersion(true);
      return;
    }
    await onConfirm(approved);
    setConfirmVersion(false);
  }

  return (
    <section className="panel question-import-review">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">候选题审核</p>
          <h3>当前页 {candidates.length} 项 · 已选 {selected.length} 项</h3>
        </div>
        <div className="panel-actions">
          <label>
            <input type="checkbox" checked={abnormalOnly} onChange={(event) => setAbnormalOnly(event.target.checked)} /> 仅显示异常
          </label>
          <button type="button" className="secondary-action" onClick={() => downloadErrors(candidates)}>
            <Download size={16} /> 下载错误 CSV
          </button>
          <button type="button" disabled={!warningFree.length} onClick={() => onBulkApprove(warningFree)}>
            <Check size={16} /> 批量通过所选无警告项
          </button>
        </div>
      </div>
      {saveError ? <p className="task-status">{saveError}</p> : null}
      <div className="question-import-candidates">
        {shown.map((candidate, index) => {
          const draft = drafts[candidate.id] ?? toDraft(candidate);
          const lowConfidence = candidate.warnings.some((warning) => /low_confidence/i.test(warning.code));
          return (
            <article
              key={candidate.id}
              className={index === activeIndex ? 'active-candidate' : undefined}
              onFocus={() => setActiveIndex(index)}
            >
              <header>
                <label>
                  <input type="checkbox" checked={selectedIds.includes(candidate.id)} onChange={() => toggle(candidate.id)} /> 选择 #
                  {candidate.sourceRowNumber ?? candidate.sourcePageNumber ?? candidate.id}
                </label>
                <span>{candidate.status}</span>
                {lowConfidence ? <b className="low-confidence-badge">低置信度</b> : null}
              </header>
              <div className="question-import-split">
                <SourcePagePreview batchId={candidate.batchId} pageNumber={candidate.sourcePageNumber} sourceRegion={candidate.sourceRegion} />
                <div className="question-import-fields">
                  <label>
                    题干<textarea value={draft.stem} onChange={(event) => change(candidate.id, { stem: event.target.value })} />
                  </label>
                  <label>
                    选项（每行一项）
                    <textarea
                      value={draft.options.join('\n')}
                      onChange={(event) =>
                        change(candidate.id, {
                          options: event.target.value
                            .split(/\r?\n/u)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    答案<input value={draft.answer} onChange={(event) => change(candidate.id, { answer: event.target.value })} />
                  </label>
                  <label>
                    解析<textarea value={draft.analysis} onChange={(event) => change(candidate.id, { analysis: event.target.value })} />
                  </label>
                  <label>
                    题型
                    <select value={draft.type} onChange={(event) => change(candidate.id, { type: event.target.value })}>
                      <option value="SINGLE_CHOICE">选择题</option>
                      <option value="COMPREHENSIVE">综合题</option>
                      <option value="JUDGEMENT">判断题</option>
                    </select>
                  </label>
                  <label>
                    难度
                    <select value={draft.difficulty} onChange={(event) => change(candidate.id, { difficulty: event.target.value })}>
                      <option value="BASIC">基础</option>
                      <option value="MEDIUM">中等</option>
                      <option value="HARD">困难</option>
                    </select>
                  </label>
                  <label>
                    来源<input value={draft.source} onChange={(event) => change(candidate.id, { source: event.target.value })} />
                  </label>
                  <label>
                    年份
                    <input
                      type="number"
                      value={draft.year ?? ''}
                      onChange={(event) => change(candidate.id, { year: event.target.value ? Number(event.target.value) : null })}
                    />
                  </label>
                  <label>
                    建议时间（秒）
                    <input
                      type="number"
                      value={draft.expectedTimeSec}
                      onChange={(event) => change(candidate.id, { expectedTimeSec: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    知识点 ID（逗号分隔）
                    <input
                      value={draft.knowledgePointIds.join(',')}
                      onChange={(event) =>
                        change(candidate.id, {
                          knowledgePointIds: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  {draft.formulas.map((formula, formulaIndex) => (
                    <FormulaPreview
                      key={formulaIndex}
                      latex={formula.latex}
                      onChange={(latex) =>
                        change(candidate.id, {
                          formulas: draft.formulas.map((item, itemIndex) => (itemIndex === formulaIndex ? { ...item, latex } : item)),
                        })
                      }
                    />
                  ))}
                  <QuestionAssetEditor
                    batchId={candidate.batchId}
                    candidateId={candidate.id}
                    pageNumber={candidate.sourcePageNumber}
                    assetIds={draft.assetIds}
                    onChange={(assetIds) => change(candidate.id, { assetIds })}
                  />
                </div>
              </div>
              <p>{candidate.warnings.length ? candidate.warnings.map((warning) => `${warning.code}: ${warning.message}`).join('；') : '无格式警告'}</p>
              {candidate.duplicateTarget ? (
                <aside className="duplicate-target">
                  <strong>重复目标对比</strong>
                  <p>{candidate.duplicateTarget.stem}</p>
                  <p>
                    {candidate.duplicateTarget.answer} · {candidate.duplicateTarget.source}
                  </p>
                </aside>
              ) : null}
              <label>
                重复处理策略
                <select
                  value={draft.duplicateAction}
                  onChange={(event) => change(candidate.id, { duplicateAction: event.target.value as Draft['duplicateAction'] })}
                >
                  <option value="skip">skip — 跳过</option>
                  <option value="create">create — 新建独立题目</option>
                  <option value="new_version">new_version — 创建新版本</option>
                </select>
              </label>
              <button type="button" className="secondary-action" disabled={savingId === candidate.id} onClick={() => void save(candidate)}>
                <Save size={16} /> {savingId === candidate.id ? '保存中…' : '保存编辑'}
              </button>
            </article>
          );
        })}
      </div>
      <footer className="question-import-confirm">
        <span>键盘：→ 下一题，A 通过当前无警告题。确认摘要：将提交所选且已通过的 {approved.length} 项。</span>
        {confirmVersion ? <p>包含“新版本”操作。请再次确认以创建不可变新版本。</p> : null}
        <button type="button" disabled={!approved.length} onClick={() => void confirm()}>
          确认导入
        </button>
      </footer>
    </section>
  );
}
