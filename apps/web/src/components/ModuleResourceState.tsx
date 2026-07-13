import { AlertCircle, Database, LoaderCircle, RefreshCw, Wifi } from 'lucide-react';
import type { ModuleResource } from '../hooks/useStudentProgressData';

export function ModuleResourceMeta<T>({ resource, onRetry }: { resource: ModuleResource<T>; onRetry: () => void }) {
  const syncedAt = resource.lastSyncAt
    ? new Date(resource.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`module-resource-meta state-${resource.state}`}>
      {resource.state === 'ready' ? <Wifi size={14} /> : null}
      {resource.state === 'mock' ? <Database size={14} /> : null}
      {resource.state === 'loading' ? <LoaderCircle size={14} className="spin" /> : null}
      {resource.state === 'error' ? <AlertCircle size={14} /> : null}
      <span>
        {resource.state === 'ready' ? `API 数据${syncedAt ? ` · ${syncedAt} 同步` : ''}` : null}
        {resource.state === 'mock' ? '本地演示数据' : null}
        {resource.state === 'loading' ? '正在同步' : null}
        {resource.state === 'error' ? '同步失败，保留上次数据' : null}
      </span>
      {(resource.state === 'error' || resource.state === 'mock') && resource.error ? <small>{resource.error}</small> : null}
      {resource.state === 'error' ? (
        <button type="button" className="icon-action" onClick={onRetry} title="重新加载" aria-label="重新加载">
          <RefreshCw size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function ModuleUnavailable<T>({
  title,
  resource,
  onRetry,
  id,
}: {
  title: string;
  resource: ModuleResource<T>;
  onRetry: () => void;
  id?: string;
}) {
  const loading = resource.state === 'loading';
  return (
    <section id={id} className="panel module-unavailable">
      <div>{loading ? <LoaderCircle size={20} className="spin" /> : <AlertCircle size={20} />}</div>
      <div>
        <strong>{loading ? `正在加载${title}` : `${title}暂时不可用`}</strong>
        <p>{loading ? '其他模块仍可正常使用。' : resource.error ?? '请稍后重新加载本模块。'}</p>
      </div>
      {!loading ? (
        <button type="button" className="secondary-action" onClick={onRetry}>
          <RefreshCw size={15} /> 重新加载
        </button>
      ) : null}
    </section>
  );
}
