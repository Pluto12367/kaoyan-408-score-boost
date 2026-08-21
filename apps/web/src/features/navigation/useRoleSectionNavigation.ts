import { useEffect, useState } from 'react';
import { defaultRoleSection, isSectionAllowedForRole, normalizeRoleSection, type RoleSection } from '../../layouts/RoleNavigation';
import type { UserRole } from '@kaoyan408/shared';

const SECTION_STORAGE_KEY = 'kaoyan408:last-section';
const SECTION_HASH_PREFIX = '#/';

function readSectionFromHash(role: UserRole): RoleSection | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(SECTION_HASH_PREFIX)) return null;
  const candidate = hash.slice(SECTION_HASH_PREFIX.length).split('?')[0] as RoleSection;
  const normalized = normalizeRoleSection(candidate);
  return isSectionAllowedForRole(role, normalized) ? normalized : null;
}

export function readStoredSection(role: UserRole): RoleSection {
  // The URL hash is the primary, shareable source of truth (Phase 1).
  const fromHash = readSectionFromHash(role);
  if (fromHash) return fromHash;
  // sessionStorage remains a compatibility fallback for the pre-hash behavior.
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
  const [activeSection, setActiveSectionState] = useState<RoleSection>(() => normalizeRoleSection(readStoredSection(resolvedRole)));

  // Keep the URL hash in sync; replace on mount so first load does not add history entries.
  useEffect(() => {
    const target = `${SECTION_HASH_PREFIX}${activeSection}`;
    if (window.location.hash !== target) {
      try {
        window.history.replaceState(null, '', target);
      } catch {
        // Ignore URL write errors and keep the in-app section state.
      }
    }
  }, [activeSection]);

  // Browser back/forward and manual hash edits.
  useEffect(() => {
    function handleHashChange() {
      const fromHash = readSectionFromHash(resolvedRole);
      if (fromHash) {
        setActiveSectionState(normalizeRoleSection(fromHash));
        return;
      }
      const fallback = defaultRoleSection(resolvedRole);
      setActiveSectionState(fallback);
      try {
        window.history.replaceState(null, '', `${SECTION_HASH_PREFIX}${fallback}`);
      } catch {
        // Ignore URL write errors and keep the in-app section state.
      }
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [resolvedRole]);

  useEffect(() => {
    setActiveSectionState((current) => (
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

  function setActiveSection(next: RoleSection) {
    const normalized = normalizeRoleSection(next);
    setActiveSectionState(normalized);
    const target = `${SECTION_HASH_PREFIX}${normalized}`;
    if (window.location.hash !== target) {
      try {
        window.location.hash = `/${normalized}`;
      } catch {
        // Ignore URL write errors and keep the in-app section state.
      }
    }
  }

  function resetSectionForRole(nextRole: UserRole) {
    const next = defaultRoleSection(nextRole);
    setActiveSectionState(next);
    try {
      window.location.hash = `/${next}`;
    } catch {
      // Ignore URL write errors and keep the in-app section state.
    }
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
