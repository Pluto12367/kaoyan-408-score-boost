/**
 * UI 主题偏好（方案 A 深色 / 方案 B 极简 / 方案 C 标准）
 *
 * - 默认主题为 A 深色（深色科技感是学生端主视觉方向）。
 * - 选择持久化到 localStorage，刷新后保持上次选择。
 * - 通过 html[data-theme] 交给 CSS 变量级联，无业务逻辑依赖。
 */

export type ThemeVariant = 'a' | 'b' | 'c';

export const DEFAULT_THEME: ThemeVariant = 'a';
export const THEME_STORAGE_KEY = 'kaoyan408:theme';

export interface ThemeOption {
  value: ThemeVariant;
  label: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'a', label: '深色' },
  { value: 'b', label: '极简' },
  { value: 'c', label: '标准' },
];

const ALLOWED_THEMES: readonly ThemeVariant[] = ['a', 'b', 'c'];

export function isThemeVariant(value: unknown): value is ThemeVariant {
  return typeof value === 'string' && (ALLOWED_THEMES as readonly string[]).includes(value);
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): ThemeVariant | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemeVariant(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveInitialTheme(storage: Pick<Storage, 'getItem'> | null): ThemeVariant {
  return readStoredTheme(storage) ?? DEFAULT_THEME;
}

export function persistTheme(storage: Pick<Storage, 'setItem'>, theme: ThemeVariant): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 存储不可用时静默降级：主题仍在本次会话生效。
  }
}

export function applyTheme(doc: { documentElement: HTMLElement }, theme: ThemeVariant): void {
  doc.documentElement.dataset.theme = theme;
}
