import { useCallback, useEffect, useState } from 'react';
import {
  createAdminMemoryCard,
  editAdminMemoryCard,
  fetchAdminMemoryCards,
  retireAdminMemoryCard,
  type AdminMemoryCard,
} from '../../api/endpoints/memoryCardAdmin';
import { isStaticDemoMode } from '../../api/env';
import '../memory-card/memory-card.css';

/**
 * V14-②+ 记忆卡管理面（admin-only；design doc
 * docs/v14-memory-card-admin-design.md，D-M-1/2/3）。
 * 自取数面板；编辑双轨制：light=原行改（正面不可改）/ rewrite=停旧建新。
 * 每次写入强制 RULE-10 留痕（reviewedBy + rightsConfirmed）。
 */

const DEFAULT_REVIEWER = 'zhoujiale(Owner)';

export function MemoryCardAdminPanel() {
  const [cards, setCards] = useState<AdminMemoryCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState('');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    knowledgeNodeId: '', cardType: 'CONCLUSION' as 'CONCLUSION' | 'FORMULA', front: '', back: '', reviewedBy: DEFAULT_REVIEWER,
  });

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminMemoryCards({ nodeId: nodeFilter || undefined, includeRetired })
      .then((data) => {
        if (!cancelled) {
          setCards(data.cards);
          setTotal(data.total);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nodeFilter, includeRetired]);

  useEffect(() => load(), [load]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    action()
      .then(() => {
        setBusy(false);
        load();
      })
      .catch((cause: unknown) => {
        setBusy(false);
        setActionError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  const onCreate = () => {
    if (busy) return;
    run(() => createAdminMemoryCard({
      knowledgeNodeId: form.knowledgeNodeId.trim(),
      cardType: form.cardType,
      front: form.front.trim(),
      back: form.back.trim(),
      reviewedBy: form.reviewedBy.trim() || DEFAULT_REVIEWER,
      rightsConfirmed: true,
    }));
  };

  const onLightEdit = (card: AdminMemoryCard) => {
    const next = window.prompt('修正背面（轻量编辑：只改文字、正面不变）', card.back);
    if (next == null || next.trim() === card.back) return;
    run(() => editAdminMemoryCard(card.id, {
      editKind: 'light', back: next.trim(), reviewedBy: DEFAULT_REVIEWER, rightsConfirmed: true,
    }));
  };

  const onRewrite = (card: AdminMemoryCard) => {
    const nextFront = window.prompt('改写后的正面（停旧建新）', card.front);
    if (nextFront == null || !nextFront.trim()) return;
    const nextBack = window.prompt('改写后的背面', card.back);
    if (nextBack == null || !nextBack.trim()) return;
    run(() => editAdminMemoryCard(card.id, {
      editKind: 'rewrite', front: nextFront.trim(), back: nextBack.trim(), reviewedBy: DEFAULT_REVIEWER, rightsConfirmed: true,
    }));
  };

  const onRetire = (card: AdminMemoryCard) => {
    if (!window.confirm(`停用卡片「${card.front.slice(0, 20)}…」？学生队列将不再出现。`)) return;
    run(() => retireAdminMemoryCard(card.id));
  };

  if (isStaticDemoMode()) {
    return (
      <div className="panel admin-panel">
        <div className="panel-heading"><div><p className="eyebrow">记忆卡管理</p><h3>需要连接后端使用</h3></div></div>
        <p className="empty-state">记忆卡目录管理需要真实数据库（演示模式不可伪造内容）。</p>
      </div>
    );
  }

  return (
    <div className="memory-card-admin" data-testid="memory-card-admin">
      <div className="panel admin-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">记忆卡管理</p><h3>卡片目录（{total} 张）</h3></div>
        </div>
        <p className="muted">
          每次写入都记录评审人与版权确认（RULE-10）。改正面=停旧建新；修背面=轻量原行更新。
        </p>
        <div className="memory-card-admin-filters">
          <input
            className="memory-card-admin-input"
            placeholder="按知识节点ID过滤（可留空）"
            value={nodeFilter}
            onChange={(event) => setNodeFilter(event.target.value)}
          />
          <label className="memory-card-admin-check">
            <input type="checkbox" checked={includeRetired} onChange={(event) => setIncludeRetired(event.target.checked)} />
            含已停用
          </label>
          <button type="button" className="memory-card-retry" onClick={load}>刷新</button>
        </div>
        {loading ? <p className="muted">加载中…</p> : null}
        {error ? <p className="memory-card-error" role="alert">加载失败：{error}</p> : null}
        {!loading && !error ? (
          <table className="memory-card-admin-table">
            <thead>
              <tr><th>节点</th><th>类型</th><th>正面</th><th>背面</th><th>评审</th><th>已复习</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id}>
                  <td title={card.knowledgeNodeId}>{card.nodeName ?? card.knowledgeNodeId}</td>
                  <td>{card.cardType === 'FORMULA' ? '公式' : '结论'}</td>
                  <td className="memory-card-admin-text">{card.front}</td>
                  <td className="memory-card-admin-text">{card.back}</td>
                  <td className="memory-card-admin-text">{card.reviewedBy ?? '—'}</td>
                  <td>{card.reviewCount}</td>
                  <td>{card.isActive ? '启用' : '停用'}</td>
                  <td className="memory-card-admin-actions">
                    <button type="button" disabled={busy || !card.isActive} onClick={() => onLightEdit(card)}>修背面</button>
                    <button type="button" disabled={busy || !card.isActive} onClick={() => onRewrite(card)}>改写</button>
                    <button type="button" disabled={busy || !card.isActive} onClick={() => onRetire(card)}>停用</button>
                  </td>
                </tr>
              ))}
              {cards.length === 0 ? <tr><td colSpan={8}>没有符合条件的卡片。</td></tr> : null}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="panel admin-panel">
        <div className="panel-heading"><div><p className="eyebrow">新建卡片</p><h3>挂到知识节点的结论╱公式卡</h3></div></div>
        <div className="memory-card-admin-form">
          <input className="memory-card-admin-input" placeholder="知识节点ID（如 OS-C02-S04-P20）"
            value={form.knowledgeNodeId} onChange={(e) => setForm({ ...form, knowledgeNodeId: e.target.value })} />
          <select className="memory-card-admin-input" value={form.cardType}
            onChange={(e) => setForm({ ...form, cardType: e.target.value as 'CONCLUSION' | 'FORMULA' })}>
            <option value="CONCLUSION">结论卡</option>
            <option value="FORMULA">公式卡</option>
          </select>
          <input className="memory-card-admin-input" placeholder="评审人"
            value={form.reviewedBy} onChange={(e) => setForm({ ...form, reviewedBy: e.target.value })} />
          <input className="memory-card-admin-input" placeholder="正面（问题╱线索，1~500 字）"
            value={form.front} onChange={(e) => setForm({ ...form, front: e.target.value })} />
          <textarea className="memory-card-admin-input" placeholder="背面（结论╱公式；公式可用 $...$ 走 LaTeX）"
            value={form.back} onChange={(e) => setForm({ ...form, back: e.target.value })} />
          <button type="button" className="memory-card-retry" disabled={busy} onClick={onCreate}>新建卡片</button>
        </div>
        {actionError ? <p className="memory-card-error" role="alert">操作失败：{actionError}</p> : null}
      </div>
    </div>
  );
}
