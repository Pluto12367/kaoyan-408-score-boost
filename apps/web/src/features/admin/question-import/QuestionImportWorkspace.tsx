import { useEffect, useMemo, useState } from 'react';
import { bulkApproveImportCandidates, confirmQuestionImport, createQuestionImport, getQuestionImport, listImportCandidates, listQuestionImports, updateImportCandidate } from '../../../api';
import type { CreateImportMetadata, QuestionImportBatchSummary, QuestionImportCandidate } from '../../../api';
import { CandidateReview } from './CandidateReview';
import { ImportBatchList } from './ImportBatchList';
import { NewImportPanel } from './NewImportPanel';

const defaultsKey = 'kaoyan408.question-import.defaults'; const active = new Set(['uploaded', 'queued', 'parsing', 'parsing_partial_failure']);
function storedDefaults(): Pick<CreateImportMetadata, 'source' | 'year' | 'defaultSubject' | 'defaultChapter'> { try { return { source: '', ...(JSON.parse(localStorage.getItem(defaultsKey) ?? '{}') as object) }; } catch { return { source: '' }; } }

export function QuestionImportWorkspace() { const [batches, setBatches] = useState<QuestionImportBatchSummary[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [candidates, setCandidates] = useState<QuestionImportCandidate[]>([]); const [error, setError] = useState(''); const defaults = useMemo(storedDefaults, []);
  const load = async () => { try { const page = await listQuestionImports(); setBatches(page.items); setSelectedId((current) => current ?? page.items[0]?.id); } catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取导入批次'); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!selectedId) return; void listImportCandidates(selectedId).then((page) => setCandidates(page.items)).catch((reason) => setError(String(reason))); }, [selectedId]);
  useEffect(() => { let timer: ReturnType<typeof setTimeout> | undefined; let cancelled = false; let step = 0; const poll = async () => { await load(); if (cancelled) return; const current = batches.some((batch) => active.has(batch.status)); if (current) { const delay = [2000, 4000, 10000][Math.min(step++, 2)]; timer = setTimeout(() => void poll(), delay); } }; if (batches.some((batch) => active.has(batch.status))) void poll(); return () => { cancelled = true; if (timer) clearTimeout(timer); }; }, [batches]);
  async function submit(file: File, metadata: CreateImportMetadata) { try { await createQuestionImport(file, metadata); localStorage.setItem(defaultsKey, JSON.stringify({ source: metadata.source, year: metadata.year, defaultSubject: metadata.defaultSubject, defaultChapter: metadata.defaultChapter })); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : '上传失败'); } }
  async function refreshCandidates() { if (selectedId) setCandidates((await listImportCandidates(selectedId)).items); }
  return <section id="question-import" className="question-import-workspace"><NewImportPanel defaults={defaults} onSubmit={submit} />{error ? <p className="task-status">{error}</p> : null}<ImportBatchList batches={batches} selectedId={selectedId} onSelect={setSelectedId} />{selectedId ? <CandidateReview candidates={candidates} onBulkApprove={async (items) => { await bulkApproveImportCandidates(selectedId, items.map(({ id, revision }) => ({ id, revision }))); await refreshCandidates(); }} onUpdate={async (candidate, patch) => { await updateImportCandidate(candidate.id, candidate.revision, patch); await refreshCandidates(); }} onConfirm={async (items) => { await confirmQuestionImport(selectedId, items.map((candidate) => candidate.id), crypto.randomUUID()); await refreshCandidates(); await load(); }} /> : null}</section>;
}
