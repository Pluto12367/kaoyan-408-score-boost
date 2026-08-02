import { useEffect, useState } from 'react';
import { API_BASE_URL, authenticatedFetch } from '../../../api/client';

export type SourceRegion = { x: number; y: number; width: number; height: number };

export function SourcePagePreview({ batchId, pageNumber, sourceRegion }: { batchId: string; pageNumber?: number | null; sourceRegion?: SourceRegion }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!pageNumber) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    setError('');
    authenticatedFetch(`${API_BASE_URL}/admin/question-imports/${batchId}/pages/${pageNumber}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`页面加载失败 (${response.status})`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '页面加载失败'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [batchId, pageNumber]);
  if (!pageNumber) return null;
  return <section className="source-page-preview" aria-label="原始页面对照"><strong>原始 PDF 第 {pageNumber} 页</strong>{error ? <p>{error}</p> : null}{url ? <div className="source-page-image"><img src={url} alt={`原始 PDF 第 ${pageNumber} 页`} />{sourceRegion ? <span className="source-region-overlay" style={{ left: `${sourceRegion.x * 100}%`, top: `${sourceRegion.y * 100}%`, width: `${sourceRegion.width * 100}%`, height: `${sourceRegion.height * 100}%` }} /> : null}</div> : <p>正在加载原始页面…</p>}</section>;
}
