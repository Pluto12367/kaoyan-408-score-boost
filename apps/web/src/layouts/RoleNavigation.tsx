import { Activity, BookOpenCheck, Brain, ClipboardCheck, ClipboardList, Home, Network, ShieldCheck, Target, Upload, type LucideIcon } from 'lucide-react';
import type { UserRole } from '@kaoyan408/shared';

export type RoleSection =
  | 'dashboard'
  | 'plan'
  | 'score-center'
  | 'knowledge-catalog'
  | 'question'
  | 'wrong-book'
  | 'report'
  | 'test'
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
  { id: 'dashboard', label: '首页', icon: Home },
  { id: 'question', label: '题库', icon: BookOpenCheck },
  { id: 'knowledge-catalog', label: '知识', icon: Network },
  { id: 'wrong-book', label: '错题', icon: ShieldCheck },
  { id: 'test', label: '测试', icon: ClipboardCheck },
];

const studentBottomItems: NavigationItem[] = [
  { id: 'dashboard', label: '首页', icon: Home },
  { id: 'question', label: '题库', icon: BookOpenCheck },
  { id: 'knowledge-catalog', label: '知识', icon: Network },
  { id: 'wrong-book', label: '错题', icon: ShieldCheck },
  { id: 'test', label: '测试', icon: ClipboardCheck },
];

const studentCompatSections: RoleSection[] = [
  'dashboard',
  'plan',
  'score-center',
  'knowledge-catalog',
  'question',
  'wrong-book',
  'report',
  'test',
  'ai',
];

export function defaultRoleSection(role: UserRole = 'student'): RoleSection {
  if (role === 'admin') return 'admin';
  if (role === 'teacher') return 'teacher';
  return 'dashboard';
}

export function normalizeRoleSection(section: RoleSection): RoleSection {
  if (section === 'plan' || section === 'score-center') return 'dashboard';
  if (section === 'report') return 'test';
  return section;
}

export function isSectionAllowedForRole(role: UserRole = 'student', section: RoleSection) {
  if (role === 'student') return studentCompatSections.includes(section);
  return navigationItemsForRole(role).some((item) => item.id === section);
}

export function navigationItemsForRole(role: UserRole = 'student') {
  if (role === 'admin') return adminItems;
  if (role === 'teacher') return teacherItems;
  return studentItems;
}

export function RoleNavigation({ role = 'student', activeSection, onNavigate }: RoleNavigationProps) {
  const resolvedRole = role ?? 'student';
  const items = navigationItemsForRole(resolvedRole);

  return (
    <nav className="role-navigation" aria-label={`${resolvedRole}功能`}>
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

export function StudentBottomNav({
  role = 'student',
  activeSection,
  onNavigate,
}: RoleNavigationProps) {
  if ((role ?? 'student') !== 'student') return null;

  return (
    <nav className="bottom-nav" aria-label="移动端导航">
      {studentBottomItems.map((item) => {
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
            <Icon size={20} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
