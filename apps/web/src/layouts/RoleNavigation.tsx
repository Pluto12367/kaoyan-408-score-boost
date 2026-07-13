import { Activity, BookOpenCheck, Brain, ClipboardCheck, ClipboardList, ShieldCheck, Target } from 'lucide-react';
import type { UserRole } from '@kaoyan408/shared';

interface RoleNavigationProps {
  role?: UserRole;
}

export function RoleNavigation({ role = 'student' }: RoleNavigationProps) {
  if (role === 'admin') {
    return (
      <nav aria-label="管理员功能">
        <a className="active" href="#admin"><Activity size={18} /> 数据看板</a>
        <a href="#review"><ShieldCheck size={18} /> 内容审核</a>
        <a href="#config"><ClipboardCheck size={18} /> 系统配置</a>
        <a href="#teacher"><ClipboardList size={18} /> 教研管理</a>
      </nav>
    );
  }

  if (role === 'teacher') {
    return (
      <nav aria-label="教师功能">
        <a className="active" href="#teacher"><ClipboardList size={18} /> 题库与班级</a>
        <a href="#report"><Target size={18} /> 学情报告</a>
        <a href="#ai"><Brain size={18} /> AI 辅助</a>
      </nav>
    );
  }

  return (
    <nav aria-label="学生功能">
      <a className="active" href="#dashboard"><Activity size={18} /> 学习总览</a>
      <a href="#plan"><ClipboardList size={18} /> 今日计划</a>
      <a href="#question"><BookOpenCheck size={18} /> 题库训练</a>
      <a href="#report"><Target size={18} /> 提分报告</a>
      <a href="#ai"><Brain size={18} /> AI 答疑</a>
    </nav>
  );
}
