import type { FormEventHandler } from 'react';
import type { UserProfile, UserRole } from '../../api';
import { permissionHint } from '../../constants';

export interface AccountPanelProps {
  user: UserProfile | null;
  fallbackName?: string;
  hasRefreshToken: boolean;
  authMode: 'login' | 'register';
  status: string;
  staticDemoMode: boolean;
  showDemoRoles: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onPasswordChangeSubmit: FormEventHandler<HTMLFormElement>;
  onToggleMode: () => void;
  onLogout: () => void;
  onRoleSwitch: (role: UserRole) => void;
  variant?: 'default' | 'login-card';
}

export function AccountPanel(props: AccountPanelProps) {
  const role = props.user?.role ?? 'student';
  const isLoginCard = props.variant === 'login-card';
  const title = props.user?.mustChangePassword
    ? '设置你的新密码'
    : props.authMode === 'register'
      ? '创建学习空间'
      : '欢迎回来，Explorer 👋';
  const subtitle = props.user?.mustChangePassword
    ? '完成密码更新后继续你的 408 学习旅程'
    : props.authMode === 'register'
      ? '加入 408 OS，建立你的长期学习档案'
      : '继续你的 408 学习旅程';
  return (
    <section className={isLoginCard ? 'auth-login-card' : 'panel role-panel'}>
      <div className="panel-heading auth-panel-heading">
        <div>
          <p className="eyebrow">{isLoginCard ? 'PERSONAL LEARNING SPACE' : '账号与角色权限'}</p>
          <h3>{isLoginCard ? title : props.user?.name ?? props.fallbackName ?? '开始学习'}</h3>
          <p className="auth-panel-subtitle">{isLoginCard ? subtitle : '登录后同步学习进度，继续提分之旅'}</p>
        </div>
        {props.hasRefreshToken || Boolean(props.user) ? (
          <button type="button" className="secondary-action" onClick={props.onLogout}>退出登录</button>
        ) : null}
      </div>
      <p className="task-status">{props.status} {permissionHint[role]}</p>
      {props.user?.mustChangePassword ? (
        <form className="account-form" onSubmit={props.onPasswordChangeSubmit}>
          <label>
            <span>当前临时密码</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required minLength={8} maxLength={128} />
          </label>
          <label>
            <span>新密码</span>
            <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <label>
            <span>确认新密码</span>
            <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <div className="account-actions">
            <button type="submit">修改密码</button>
            <button type="button" className="secondary-action" onClick={props.onLogout}>退出登录</button>
          </div>
        </form>
      ) : null}
      {!props.user && !props.staticDemoMode ? (
        <>
          {!isLoginCard ? (
            <div className="auth-mode-switch" role="tablist" aria-label="登录或注册">
              <button
                type="button"
                role="tab"
                aria-selected={props.authMode === 'login'}
                className={props.authMode === 'login' ? 'active' : ''}
                onClick={() => { if (props.authMode !== 'login') props.onToggleMode(); }}
              >登录</button>
              <button
                type="button"
                role="tab"
                aria-selected={props.authMode === 'register'}
                className={props.authMode === 'register' ? 'active' : ''}
                onClick={() => { if (props.authMode !== 'register') props.onToggleMode(); }}
              >注册</button>
            </div>
          ) : null}
          <form className="account-form" onSubmit={props.onSubmit}>
            {props.authMode === 'register' ? (
              <>
                <p className="auth-register-guide">三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断</p>
                <label>
                  <span>邀请码</span>
                  <input name="inviteCode" autoComplete="one-time-code" required minLength={6} maxLength={128} />
                </label>
                <p className="auth-invite-hint">联系管理员获取邀请码</p>
                <label>
                  <span>姓名</span>
                  <input name="name" autoComplete="name" required maxLength={40} />
                </label>
              </>
            ) : null}
            <label>
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            {props.authMode === 'register' ? (
              <label>
                <span>确认密码</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
              </label>
            ) : null}
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
              <button type="submit">{props.authMode === 'register' ? '创建学生账号' : '登录 · 进入学习'}</button>
            </div>
          </form>
          {isLoginCard ? (
            <div className="auth-card-mode-link">
              <span>{props.authMode === 'login' ? '没有账号？' : '已有账号？'}</span>
              <button type="button" onClick={props.onToggleMode}>
                {props.authMode === 'login' ? '立即注册' : '返回登录'}
              </button>
            </div>
          ) : props.authMode === 'login' ? (
            <button type="button" className="secondary-action auth-register-link" onClick={props.onToggleMode}>
              还没有账号？注册新账号
            </button>
          ) : null}
        </>
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
//登录/注册/改密
