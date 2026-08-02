import katex from 'katex';
import { useEffect, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';

export function FormulaPreview({ latex, onChange }: { latex: string; onChange: (value: string) => void }) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target.current) return;
    try { katex.renderToString(latex, { throwOnError: true, trust: false, strict: 'warn' }); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '公式解析失败'); }
    katex.render(latex, target.current, { throwOnError: false, trust: false, strict: 'warn' });
  }, [latex]);
  return <label className="formula-preview">公式 LaTeX<textarea value={latex} onChange={(event) => onChange(event.target.value)} /><div ref={target} aria-label="公式预览" />{error ? <small>解析提示：{error}</small> : null}</label>;
}
