import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_THEME,
  applyTheme,
  persistTheme,
  readStoredTheme,
  type ThemeVariant,
} from '../theme/themePreference';

/**
 * 界面主题（A 深色 / B 极简 / C 标准）。
 * 挂载时从 localStorage 恢复，变更时写入 html[data-theme] 并持久化。
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeVariant>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    return readStoredTheme(window.localStorage) ?? DEFAULT_THEME;
  });

  useEffect(() => {
    applyTheme(document, theme);
    if (typeof window !== 'undefined') {
      persistTheme(window.localStorage, theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeVariant) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
