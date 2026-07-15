import { useMemo, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import type { AdminUserManagement, TeacherStudentAuthorizationList } from '../../api';
import { ModuleResourceMeta, ModuleUnavailable } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';

interface TeacherAuthorizationPanelProps {
  users: AdminUserManagement;
  authorizations: ModuleResource<TeacherStudentAuthorizationList>;
  onRetry: () => void;
  onGrant: (teacherId: string, studentId: string) => Promise<void>;
  onRevoke: (teacherId: string, studentId: string) => Promise<void>;
}

export function TeacherAuthorizationPanel(props: TeacherAuthorizationPanelProps) {
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [status, setStatus] = useState('选择教师和学生后建立班级数据访问关系。');
  const [pendingKey, setPendingKey] = useState('');
  const teachers = useMemo(() => props.users.users.filter((user) => user.role === 'teacher'), [props.users.users]);
  const students = useMemo(() => props.users.users.filter((user) => user.role === 'student'), [props.users.users]);
  const teacherId = selectedTeacherId || teachers[0]?.id || '';
  const studentId = selectedStudentId || students[0]?.id || '';
  const authorizations = props.authorizations.data;

  async function grant() {
    if (!teacherId || !studentId) {
      setStatus('需要至少一个教师账号和一个学生账号。');
      return;
    }
    const key = `${teacherId}:${studentId}`;
    setPendingKey(key);
    setStatus('正在保存授权...');
    try {
      await props.onGrant(teacherId, studentId);
      setStatus('授权已保存，教师现在可以查看该学生的学习数据。');
    } catch (error) {
      setStatus(error instanceof Error ? `授权失败：${error.message}` : '授权失败，请稍后重试。');
    } finally {
      setPendingKey('');
    }
  }

  async function revoke(targetTeacherId: string, targetStudentId: string) {
    const key = `${targetTeacherId}:${targetStudentId}`;
    setPendingKey(key);
    setStatus('正在撤销授权...');
    try {
      await props.onRevoke(targetTeacherId, targetStudentId);
      setStatus('授权已撤销，教师的数据访问权限立即失效。');
    } catch (error) {
      setStatus(error instanceof Error ? `撤销失败：${error.message}` : '撤销失败，请稍后重试。');
    } finally {
      setPendingKey('');
    }
  }

  if (!authorizations) {
    return <ModuleUnavailable title="教师学生授权" resource={props.authorizations} onRetry={props.onRetry} />;
  }

  return (
    <section className="panel teacher-authorization-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">数据权限</p><h3>教师与学生授权</h3></div>
        <span>{authorizations.items.length} 条有效关系</span>
      </div>
      <ModuleResourceMeta resource={props.authorizations} onRetry={props.onRetry} />
      <div className="authorization-form">
        <label>
          <span>教师</span>
          <select value={teacherId} onChange={(event) => setSelectedTeacherId(event.target.value)} disabled={!teachers.length}>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </label>
        <label>
          <span>学生</span>
          <select value={studentId} onChange={(event) => setSelectedStudentId(event.target.value)} disabled={!students.length}>
            {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void grant()} disabled={!teacherId || !studentId || Boolean(pendingKey)}>
          <UserPlus size={18} /> 授权
        </button>
      </div>
      <p className="task-status">{status}</p>
      <div className="authorization-list">
        {authorizations.items.length ? authorizations.items.map((item) => (
          <article key={item.id}>
            <div><strong>{item.teacherName}</strong><span>可查看 {item.studentName} 的学习数据</span></div>
            <button
              type="button"
              className="secondary-action"
              title="撤销教师访问权限"
              onClick={() => void revoke(item.teacherId, item.studentId)}
              disabled={pendingKey === `${item.teacherId}:${item.studentId}`}
            >
              <UserMinus size={17} /> 撤销
            </button>
          </article>
        )) : <div className="empty-state"><strong>暂无授权关系</strong><span>教师默认不能查看任何学生数据。</span></div>}
      </div>
    </section>
  );
}
