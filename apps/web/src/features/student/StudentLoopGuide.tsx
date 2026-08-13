import type { RoleSection } from '../../layouts/RoleNavigation';

interface StudentLoopGuideProps {
  activeSection: RoleSection;
  onNavigate: (section: RoleSection) => void;
}

const TEXT = {
  ariaLabel: '\u5b66\u751f\u5b66\u4e60\u95ed\u73af\u5bfc\u822a',
  eyebrow: '\u5b66\u4e60\u8def\u5f84',
  title: '\u4ece\u4eca\u65e5\u4efb\u52a1\u5230\u590d\u76d8\uff0c\u4e00\u6b65\u63a5\u4e00\u6b65',
  hint: '\u4e0d\u77e5\u9053\u4e0b\u4e00\u6b65\u505a\u4ec0\u4e48\u65f6\uff0c\u6309\u8fd9\u6761\u8def\u5f84\u8d70\u3002',
  dashboard: '\u9996\u9875 / \u4eca\u65e5\u4efb\u52a1',
  practice: '\u9898\u5e93\u8bad\u7ec3',
  wrongBook: '\u9519\u9898\u590d\u76d8',
  report: '\u5b66\u4e60\u62a5\u544a',
  dashboardDetail: '\u5148\u770b\u4eca\u5929\u8981\u505a\u4ec0\u4e48',
  practiceDetail: '\u5b8c\u6210\u9898\u76ee\u5e76\u83b7\u5f97\u5373\u65f6\u53cd\u9988',
  wrongBookDetail: '\u628a\u9519\u9898\u53d8\u6210\u53ef\u4fee\u590d\u52a8\u4f5c',
  reportDetail: '\u770b\u638c\u63e1\u5ea6\u53d8\u5316\u548c\u4e0b\u4e00\u6b65',
  current: '\u5f53\u524d',
};

const guideItems: Array<{
  target: RoleSection;
  label: string;
  detail: string;
}> = [
  { target: 'dashboard', label: TEXT.dashboard, detail: TEXT.dashboardDetail },
  { target: 'question', label: TEXT.practice, detail: TEXT.practiceDetail },
  { target: 'wrong-book', label: TEXT.wrongBook, detail: TEXT.wrongBookDetail },
  { target: 'report', label: TEXT.report, detail: TEXT.reportDetail },
];

export function StudentLoopGuide({ activeSection, onNavigate }: StudentLoopGuideProps) {
  return (
    <section className="student-loop-guide" aria-label={TEXT.ariaLabel}>
      <div>
        <p className="eyebrow">{TEXT.eyebrow}</p>
        <h3>{TEXT.title}</h3>
        <span>{TEXT.hint}</span>
      </div>
      <div className="student-loop-guide-steps">
        {guideItems.map((item, index) => {
          const active = activeSection === item.target || (item.target === 'dashboard' && activeSection === 'plan');
          return (
            <button
              key={item.target}
              type="button"
              className={active ? 'active' : ''}
              aria-current={active ? 'step' : undefined}
              onClick={() => onNavigate(item.target)}
            >
              <small>{index + 1}</small>
              <strong>{item.label}</strong>
              <span>{active ? TEXT.current : item.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
