import { Activity, BookOpenCheck, Brain, ClipboardCheck, ClipboardList, ShieldCheck, Target, Upload, type LucideIcon } from 'lucide-react';
import type { UserRole } from '@kaoyan408/shared';

export type RoleSection =
  | 'dashboard'
  | 'plan'
  | 'question'
  | 'wrong-book'
  | 'report'
  | 'ai'
  | 'admin'
  | 'review'
  | 'config'
  | 'teacher'
  | 'question-import';

interface NavigationItem {
  id: RoleSection;
  label: string;
  icon: LucideIcon;
}

interface RoleNavigationProps {
  role?: UserRole;
  activeSection: RoleSection;
  onNavigate: (section: RoleSection) => void;
}

const adminItems: NavigationItem[] = [
  { id: 'admin', label: '数据看板', icon: Activity },
  { id: 'review', label: '内容审核', icon: ShieldCheck },
  { id: 'config', label: '系统配置', icon: ClipboardCheck },
  { id: 'teacher', label: '教研管理', icon: ClipboardList },
  { id: 'question-import', label: '题库文档导入', icon: Upload },
];

const teacherItems: NavigationItem[] = [
  { id: 'teacher', label: '题库与班级', icon: ClipboardList },
  { id: 'report', label: '学情报告', icon: Target },
  { id: 'ai', label: 'AI 辅助', icon: Brain },
];

const studentItems: NavigationItem[] = [
  { id: 'dashboard', label: '学习总览', icon: Activity },
  { id: 'plan', label: '今日计划', icon: ClipboardList },
  { id: 'question', label: '题库训练', icon: BookOpenCheck },
  { id: 'wrong-book', label: '错题复盘', icon: ShieldCheck },
  { id: 'report', label: '提分报告', icon: Target },
  { id: 'ai', label: 'AI 答疑', icon: Brain },
];

export function defaultRoleSection(role: UserRole = 'student'): RoleSection {
  if (role === 'admin') return 'admin';
  if (role === 'teacher') return 'teacher';
  return 'dashboard';
}

export function isSectionAllowedForRole(role: UserRole = 'student', section: RoleSection) {
  return navigationItemsForRole(role).some((item) => item.id === section);
}

export function navigationItemsForRole(role: UserRole = 'student') {
  if (role === 'admin') return adminItems;
  if (role === 'teacher') return teacherItems;
  return studentItems;
}

export function RoleNavigation({ role = 'student', activeSection, onNavigate }: RoleNavigationProps) {
  const items = navigationItemsForRole(role);

  return (
    <nav aria-label={`${role}功能`}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeSection;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? 'active' : ''}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <Icon size={18} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
