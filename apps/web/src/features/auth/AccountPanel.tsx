import type { FormEventHandler } from 'react';
import type { UserProfile, UserRole } from '../../api';
import { permissionHint } from '../../constants';

interface AccountPanelProps {
  user: UserProfile | null;
  fallbackName?: string;
  hasRefreshToken: boolean;
  authMode: 'login' | 'register';
  status: string;
  staticDemoMode: boolean;
  showDemoRoles: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onToggleMode: () => void;
  onLogout: () => void;
  onRoleSwitch: (role: UserRole) => void;
}

export function AccountPanel(props: AccountPanelProps) {
  const role = props.user?.role ?? 'student';
  return (
    <section className="panel role-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">账号与角色权限</p>
          <h3>{props.user?.name ?? props.fallbackName ?? '未登录'}</h3>
        </div>
        {props.hasRefreshToken ? (
          <button type="button" className="secondary-action" onClick={props.onLogout}>退出登录</button>
        ) : null}
      </div>
      <p className="task-status">{props.status} {permissionHint[role]}</p>
      {!props.hasRefreshToken && !props.staticDemoMode ? (
        <form className="account-form" onSubmit={props.onSubmit}>
          {props.authMode === 'register' ? (
            <label>
              <span>姓名</span>
              <input name="name" autoComplete="name" required maxLength={40} />
            </label>
          ) : null}
          <label>
            <span>邮箱</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete={props.authMode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <div className="account-actions">
            <button type="submit">{props.authMode === 'register' ? '创建学生账号' : '登录'}</button>
            <button type="button" className="secondary-action" onClick={props.onToggleMode}>
              {props.authMode === 'register' ? '已有账号' : '注册账号'}
            </button>
          </div>
        </form>
      ) : null}
      {props.showDemoRoles ? (
        <div className="demo-role-actions">
          <span>演示身份</span>
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={() => props.onRoleSwitch('student')}>学生</button>
            <button type="button" className="secondary-action" onClick={() => props.onRoleSwitch('teacher')}>教师</button>
            <button type="button" className="secondary-action" onClick={() => props.onRoleSwitch('admin')}>管理员</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
