export interface OnboardingProfile {
  inviteCode: string;
  name: string;
  email: string;
  targetSchool: string;
  examType: string;
  targetScore: string;
  dataStructureLevel: string;
  operatingSystemLevel: string;
  computerOrganizationLevel: string;
  networkLevel: string;
  dailyStudyTime: string;
  studyMode: string;
}

export const ONBOARDING_PROFILE_KEY = '408-os-onboarding-profile';

export const emptyOnboardingProfile: OnboardingProfile = {
  inviteCode: '', name: '', email: '', targetSchool: '', examType: '11408', targetScore: '',
  dataStructureLevel: '基础', operatingSystemLevel: '基础', computerOrganizationLevel: '基础', networkLevel: '基础',
  dailyStudyTime: '2-3 小时', studyMode: '理解与练习结合',
};

export function loadOnboardingProfile(): OnboardingProfile {
  if (typeof window === 'undefined') return { ...emptyOnboardingProfile };
  try {
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_PROFILE_KEY) ?? '{}') as Partial<OnboardingProfile>;
    return { ...emptyOnboardingProfile, ...stored };
  } catch {
    return { ...emptyOnboardingProfile };
  }
}

export function saveOnboardingProfile(profile: OnboardingProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ONBOARDING_PROFILE_KEY, JSON.stringify(profile));
}
