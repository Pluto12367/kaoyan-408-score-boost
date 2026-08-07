import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bulkApproveImportCandidates, cancelQuestionImport, confirmQuestionImport, createQuestionImport, getQuestionImport, listImportCandidates, listQuestionImports, retryQuestionImport, updateImportCandidate } from '../../../api';
import type { CreateImportMetadata, QuestionImportBatch, QuestionImportBatchSummary, QuestionImportCandidate } from '../../../api';
import { CandidateReview } from './CandidateReview';
import { ImportBatchList } from './ImportBatchList';
import { NewImportPanel } from './NewImportPanel';

const defaultsKey = 'kaoyan408.question-import.defaults';
const active = new Set(['uploaded', 'queued', 'parsing', 'parsing_partial_failure']);
function storedDefaults(): Pick<CreateImportMetadata, 'source' | 'year' | 'defaultSubject' | 'defaultChapter'> { try { return { source: '', ...(JSON.parse(localStorage.getItem(defaultsKey) ?? '{}') as object) }; } catch { return { source: '' }; } }
function generateQuestionImportIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const random = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `question-import-${random}`;
}

export function QuestionImportWorkspace() {
  const [batches, setBatches] = useState<QuestionImportBatchSummary[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [detail, setDetail] = useState<QuestionImportBatch>();
  const [candidates, setCandidates] = useState<QuestionImportCandidate[]>([]); const [candidatePage, setCandidatePage] = useState(1); const [candidateTotal, setCandidateTotal] = useState(0); const [error, setError] = useState(''); const defaults = useMemo(storedDefaults, []);
  const mounted = useRef(true); const polling = useRef(false); const pollTimer = useRef<ReturnType<typeof setTimeout>>();
  const stopPolling = useCallback(() => { polling.current = false; if (pollTimer.current) clearTimeout(pollTimer.current); pollTimer.current = undefined; }, []);
  const startPolling = useCallback((initialBatches: QuestionImportBatchSummary[]) => {
    if (!mounted.current) return;
    if (!initialBatches.some((batch) => active.has(batch.status)) || polling.current) return;
    polling.current = true; let step = 0;
    const poll = async () => { try { const latest = await listQuestionImports(); if (!mounted.current || !polling.current) return; setBatches(latest.items); if (!latest.items.some((batch) => active.has(batch.status))) { stopPolling(); return; } pollTimer.current = setTimeout(() => void poll(), [2000, 4000, 10000][Math.min(step++, 2)]); } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '轮询失败'); stopPolling(); } };
    pollTimer.current = setTimeout(() => void poll(), 2000);
  }, [stopPolling]);
  const loadBatches = useCallback(async () => { const page = await listQuestionImports(); if (!mounted.current) return page.items; setBatches(page.items); setSelectedId((current) => current ?? page.items[0]?.id); return page.items; }, []);
  const refreshCandidates = useCallback(async () => { if (!selectedId) return; const page = await listImportCandidates(selectedId, candidatePage); if (!mounted.current) return; setCandidates(page.items); setCandidateTotal(page.total); }, [candidatePage, selectedId]);
  const refreshSelected = useCallback(async (id: string) => { const latest = await loadBatches(); startPolling(latest); setDetail(await getQuestionImport(id)); }, [loadBatches, startPolling]);
  useEffect(() => { mounted.current = true; void loadBatches().then((batches) => { if (mounted.current) startPolling(batches); }).catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取导入批次')); return () => { mounted.current = false; stopPolling(); }; }, [loadBatches, startPolling, stopPolling]);
  useEffect(() => { setCandidatePage(1); if (!selectedId) return; void getQuestionImport(selectedId).then(setDetail).catch((reason) => setError(String(reason))); }, [selectedId]);
  useEffect(() => { void refreshCandidates().catch((reason) => setError(String(reason))); }, [refreshCandidates]);
  async function submit(file: File, metadata: CreateImportMetadata) { try { await createQuestionImport(file, metadata); localStorage.setItem(defaultsKey, JSON.stringify({ source: metadata.source, year: metadata.year, defaultSubject: metadata.defaultSubject, defaultChapter: metadata.defaultChapter })); const latest = await loadBatches(); startPolling(latest); } catch (reason) { setError(reason instanceof Error ? reason.message : '上传失败'); } }
  async function update(candidate: QuestionImportCandidate, patch: Record<string, unknown>) { await updateImportCandidate(candidate.id, candidate.revision, patch); await refreshCandidates(); }
  const pageCount = Math.max(1, Math.ceil(candidateTotal / 20));
  const passedCount = candidates.filter((candidate) => candidate.status === 'approved' || candidate.status === 'imported').length;
  const abnormalCount = candidates.filter((candidate) => candidate.status === 'needs_edit' || candidate.status === 'parse_failed').length;
  const currentStep = !selectedId ? 0 : passedCount > 0 ? 2 : candidates.length ? 1 : 0;
  const steps = ['上传文件', '审核候选题', '确认入库', '完成'];
  const hasActiveBatch = batches.some((batch) => active.has(batch.status));

  return (
    <section id="question-import" className="question-import-workspace">
      <div className="panel question-import-overview">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">导入流程</p>
            <h3>题库文档导入</h3>
          </div>
          <span>支持上传、审核、确认入库和结果反馈</span>
        </div>
        <ol className="question-import-stepper" aria-label="题库导入步骤">
          {steps.map((step, index) => (
            <li key={step} className={index <= currentStep ? 'active' : ''}>
              <strong>{index + 1}</strong>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="question-import-summary">
          <article><strong>{candidateTotal || candidates.length}</strong><span>已识别</span></article>
          <article><strong>{passedCount}</strong><span>通过</span></article>
          <article><strong>{abnormalCount}</strong><span>异常</span></article>
          <article><strong>{detail?.status ?? '待上传'}</strong><span>批次状态</span></article>
        </div>
      </div>

      <NewImportPanel defaults={defaults} onSubmit={submit} />
      {error ? <p className="task-status">{error}</p> : null}
      <details className="question-import-details" open={hasActiveBatch}>
        <summary>
          <span>导入队列</span>
          <small>{batches.length} 个批次{hasActiveBatch ? ' · 处理中' : ''}</small>
        </summary>
        <ImportBatchList batches={batches} detail={detail} selectedId={selectedId} onSelect={setSelectedId} onCancel={async (id) => { await cancelQuestionImport(id); await refreshSelected(id); }} onRetry={async (id, jobIds) => { await retryQuestionImport(id, jobIds); await refreshSelected(id); }} />
      </details>
      {selectedId ? (
        <>
          <CandidateReview candidates={candidates} onBulkApprove={async (items) => { await bulkApproveImportCandidates(selectedId, items.map(({ id, revision }) => ({ id, revision }))); await refreshCandidates(); }} onUpdate={update} onConfirm={async (items) => { await confirmQuestionImport(selectedId, items.map((candidate) => candidate.id), generateQuestionImportIdempotencyKey()); await refreshCandidates(); await loadBatches(); }} />
          <div className="question-import-pagination">
            <button type="button" disabled={candidatePage === 1} onClick={() => setCandidatePage((page) => page - 1)}>上一页</button>
            <span>第 {candidatePage} / {pageCount} 页，共 {candidateTotal} 项</span>
            <button type="button" disabled={candidatePage >= pageCount} onClick={() => setCandidatePage((page) => page + 1)}>下一页</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
