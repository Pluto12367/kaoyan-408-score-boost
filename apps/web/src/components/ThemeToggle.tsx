import { useTheme } from '../hooks/useTheme';
import { THEME_OPTIONS } from '../theme/themePreference';

/**
 * 顶栏主题切换：A 深色 / B 极简 / C 标准。
 * 只切换 CSS 变量主题，不触碰任何业务状态。
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switch" role="group" aria-label="界面主题">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? 'active' : ''}
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
