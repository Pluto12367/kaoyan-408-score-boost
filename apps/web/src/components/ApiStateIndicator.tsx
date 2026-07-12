import { Wifi, WifiOff, Database, Clock } from 'lucide-react';

export type ApiState = 'connecting' | 'connected' | 'error' | 'mock';

interface Props {
  state: ApiState;
  lastSyncAt?: string;
  source?: string;
  onRetry?: () => void;
}

export function ApiStateIndicator({ state, lastSyncAt, source, onRetry }: Props) {
  const config: Record<ApiState, { label: string; className: string; icon: JSX.Element }> = {
    connecting: { label: '连接中...', className: 'api-connecting', icon: <Clock size={14} /> },
    connected:   { label: `API · ${source ?? '在线'}`, className: 'api-connected', icon: <Wifi size={14} /> },
    error:       { label: 'API 异常', className: 'api-error', icon: <WifiOff size={14} /> },
    mock:        { label: `演示数据 · ${source ?? '本地'}`, className: 'api-mock', icon: <Database size={14} /> },
  };

  const { label, className, icon } = config[state];

  return (
    <span className={`api-pill ${className}`} title={lastSyncAt ? `上次同步: ${new Date(lastSyncAt).toLocaleString('zh-CN')}` : undefined}>
      {icon} {label}
      {state === 'error' && onRetry ? (
        <button type="button" className="retry-btn" onClick={onRetry}>重试</button>
      ) : null}
    </span>
  );
}
