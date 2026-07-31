import { useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';

interface ManagedUserCreationPanelProps {
  onCreateManagedUser: (input: { email: string; name: string; role: 'teacher' | 'admin' }) => Promise<string | null>;
}

export function ManagedUserCreationPanel({ onCreateManagedUser }: ManagedUserCreationPanelProps) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [status, setStatus] = useState('创建教师或管理员账号后，会显示一次性临时密码。');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus('正在创建账号...');
    const result = await onCreateManagedUser({
      email: String(form.get('email') ?? ''),
      name: String(form.get('name') ?? ''),
      role: String(form.get('role') ?? 'teacher') as 'teacher' | 'admin',
    });
    setTemporaryPassword(result);
    setStatus(result ? '账号已创建，请复制临时密码。' : '账号创建失败，请稍后重试。');
    if (result) event.currentTarget.reset();
  }

  return (
    <section className="panel admin-users-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">教师与管理员</p><h3>创建内部账号</h3></div>
      </div>
      <p className="task-status">{status}</p>
      <form className="account-form admin-inline-form" onSubmit={handleSubmit}>
        <label><span>姓名</span><input name="name" required maxLength={40} /></label>
        <label><span>邮箱</span><input name="email" type="email" required /></label>
        <label>
          <span>角色</span>
          <select name="role" defaultValue="teacher">
            <option value="teacher">教师</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <button type="submit"><UserPlus size={18} /> 创建账号</button>
      </form>
      {temporaryPassword ? (
        <div className="admin-secret-box">
          <span>一次性临时密码</span>
          <code>{temporaryPassword}</code>
        </div>
      ) : null}
    </section>
  );
}
