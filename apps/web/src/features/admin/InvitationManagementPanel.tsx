import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Plus, RefreshCw, XCircle } from 'lucide-react';
import {
  createAdminInvitation,
  disableAdminInvitation,
  fetchAdminInvitations,
  type AdminInvitation,
  type CreatedInvitation,
} from '../../api';

export function InvitationManagementPanel() {
  const [items, setItems] = useState<AdminInvitation[]>([]);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [status, setStatus] = useState('管理员可创建邀请码，完整邀请码只在创建成功后显示一次。');

  async function loadInvitations() {
    setStatus('正在加载邀请码...');
    try {
      const result = await fetchAdminInvitations();
      setItems(result.invitations);
      setStatus(`已加载 ${result.invitations.length} 个邀请码批次。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '邀请码加载失败。');
    }
  }

  useEffect(() => {
    void loadInvitations();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get('label') ?? '').trim();
    const maxUses = Number(form.get('maxUses') ?? 1);
    const expiresAt = String(form.get('expiresAt') ?? '');
    setStatus('正在创建邀请码...');
    try {
      const invitation = await createAdminInvitation({
        label,
        maxUses,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      setCreated(invitation);
      await loadInvitations();
      setStatus('邀请码已创建，请立即复制完整码。');
      event.currentTarget.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '邀请码创建失败。');
    }
  }

  async function handleDisable(invitationId: string) {
    setStatus('正在停用邀请码...');
    try {
      await disableAdminInvitation(invitationId);
      await loadInvitations();
      setStatus('邀请码已停用。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '邀请码停用失败。');
    }
  }

  async function copyCreatedCode() {
    if (!created?.code) return;
    await navigator.clipboard.writeText(created.code);
    setStatus('完整邀请码已复制。');
  }

  return (
    <section className="panel admin-users-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">邀请码管理</p><h3>学生注册入口</h3></div>
        <button type="button" className="secondary-action" onClick={() => void loadInvitations()}><RefreshCw size={18} /> 刷新</button>
      </div>
      <p className="task-status">{status}</p>
      <form className="account-form admin-inline-form" onSubmit={handleCreate}>
        <label>
          <span>批次名称</span>
          <input name="label" required maxLength={80} placeholder="408 内测第 1 批" />
        </label>
        <label>
          <span>可用次数</span>
          <input name="maxUses" type="number" required min={1} max={500} defaultValue={1} />
        </label>
        <label>
          <span>过期时间</span>
          <input name="expiresAt" type="datetime-local" required />
        </label>
        <button type="submit"><Plus size={18} /> 创建邀请码</button>
      </form>
      {created ? (
        <div className="admin-secret-box">
          <span>完整邀请码</span>
          <code>{created.code}</code>
          <button type="button" className="secondary-action" onClick={() => void copyCreatedCode()}><Copy size={18} /> 复制</button>
        </div>
      ) : null}
      <div className="admin-users-list">
        {items.map((item) => (
          <article key={item.id}>
            <div><strong>{item.label}</strong><span>前缀 {item.codePrefix} · {item.status}</span></div>
            <div>
              <span>{item.usedCount}/{item.maxUses} 次</span>
              <small>过期 {new Date(item.expiresAt).toLocaleString('zh-CN')}</small>
            </div>
            <button type="button" className="secondary-action" disabled={Boolean(item.disabledAt)} onClick={() => void handleDisable(item.id)}>
              <XCircle size={18} /> {item.disabledAt ? '已停用' : '停用'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
