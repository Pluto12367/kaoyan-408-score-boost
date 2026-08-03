import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bulkApproveImportCandidates, cancelQuestionImport, confirmQuestionImport, createQuestionImport, getQuestionImport, listImportCandidates, listQuestionImports, retryQuestionImport, updateImportCandidate } from '../../../api';
import type { CreateImportMetadata, QuestionImportBatch, QuestionImportBatchSummary, QuestionImportCandidate } from '../../../api';
import { CandidateReview } from './CandidateReview';
import { ImportBatchList } from './ImportBatchList';
import { NewImportPanel } from './NewImportPanel';

const defaultsKey = 'kaoyan408.question-import.defaults';
const active = new Set(['uploaded', 'queued', 'parsing', 'parsing_partial_failure']);
function storedDefaults(): Pick<CreateImportMetadata, 'source' | 'year' | 'defaultSubject' | 'defaultChapter'> { try { return { source: '', ...(JSON.parse(localStorage.getItem(defaultsKey) ?? '{}') as object) }; } catch { return { source: '' }; } }

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
  return <section id="question-import" className="question-import-workspace"><NewImportPanel defaults={defaults} onSubmit={submit} />{error ? <p className="task-status">{error}</p> : null}<ImportBatchList batches={batches} detail={detail} selectedId={selectedId} onSelect={setSelectedId} onCancel={async (id) => { await cancelQuestionImport(id); await refreshSelected(id); }} onRetry={async (id, jobIds) => { await retryQuestionImport(id, jobIds); await refreshSelected(id); }} />{selectedId ? <><CandidateReview candidates={candidates} onBulkApprove={async (items) => { await bulkApproveImportCandidates(selectedId, items.map(({ id, revision }) => ({ id, revision }))); await refreshCandidates(); }} onUpdate={update} onConfirm={async (items) => { await confirmQuestionImport(selectedId, items.map((candidate) => candidate.id), crypto.randomUUID()); await refreshCandidates(); await loadBatches(); }} /><div className="question-import-pagination"><button type="button" disabled={candidatePage === 1} onClick={() => setCandidatePage((page) => page - 1)}>上一页</button><span>第 {candidatePage} / {pageCount} 页，共 {candidateTotal} 项</span><button type="button" disabled={candidatePage >= pageCount} onClick={() => setCandidatePage((page) => page + 1)}>下一页</button></div></> : null}</section>;
}
