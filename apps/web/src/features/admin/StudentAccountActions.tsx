import { KeyRound, Power, RotateCcw } from 'lucide-react';
import type { AdminManagedUser } from '../../api';

interface StudentAccountActionsProps {
  user: AdminManagedUser;
  onSetStatus: (userId: string, accountStatus: 'active' | 'disabled') => Promise<void>;
  onCreateTemporaryPassword: (userId: string) => Promise<void>;
}

export function StudentAccountActions({ user, onSetStatus, onCreateTemporaryPassword }: StudentAccountActionsProps) {
  const disabled = user.accountStatus === 'disabled';
  return (
    <div className="panel-actions compact-actions">
      <button type="button" className="secondary-action" onClick={() => onSetStatus(user.id, disabled ? 'active' : 'disabled')}>
        {disabled ? <RotateCcw size={16} /> : <Power size={16} />}
        {disabled ? '恢复账号' : '停用账号'}
      </button>
      <button type="button" className="secondary-action" onClick={() => onCreateTemporaryPassword(user.id)}>
        <KeyRound size={16} /> 临时密码
      </button>
    </div>
  );
}
