import { useEffect, useState } from 'react';
import { defaultRoleSection, isSectionAllowedForRole, type RoleSection } from '../../layouts/RoleNavigation';
import type { UserRole } from '@kaoyan408/shared';

const SECTION_STORAGE_KEY = 'kaoyan408:last-section';

export function readStoredSection(role: UserRole): RoleSection {
  if (typeof window === 'undefined') return defaultRoleSection(role);
  try {
    const stored = window.sessionStorage.getItem(SECTION_STORAGE_KEY);
    if (stored && isSectionAllowedForRole(role, stored as RoleSection)) return stored as RoleSection;
  } catch {
    // Ignore storage access errors and fall back to the default section.
  }
  return defaultRoleSection(role);
}

export function useRoleSectionNavigation(role?: UserRole) {
  const resolvedRole = role ?? 'student';
  const [activeSection, setActiveSection] = useState<RoleSection>(() => readStoredSection(resolvedRole));

  useEffect(() => {
    setActiveSection((current) => (
      isSectionAllowedForRole(resolvedRole, current)
        ? current
        : defaultRoleSection(resolvedRole)
    ));
  }, [resolvedRole]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SECTION_STORAGE_KEY, activeSection);
    } catch {
      // Ignore storage write errors.
    }
  }, [activeSection]);

  function resetSectionForRole(nextRole: UserRole) {
    setActiveSection(defaultRoleSection(nextRole));
  }

  const visibleSection = isSectionAllowedForRole(resolvedRole, activeSection)
    ? activeSection
    : defaultRoleSection(resolvedRole);

  return { activeSection, setActiveSection, visibleSection, resetSectionForRole };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AI 请求超时，请稍后重试。')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
