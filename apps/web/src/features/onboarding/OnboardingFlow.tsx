import { useCallback, useState } from 'react';
import { InitializationCore } from './InitializationCore';
import { WelcomeHero } from './WelcomeHero';
import { loadOnboardingProfile } from './onboardingProfile';

interface OnboardingFlowProps { userName: string; onEnterDashboard: () => void; }

export function OnboardingFlow({ userName, onEnterDashboard }: OnboardingFlowProps) {
  const [profile] = useState(loadOnboardingProfile);
  const [phase, setPhase] = useState<'initializing' | 'welcome'>('initializing');
  const onComplete = useCallback(() => setPhase('welcome'), []);
  return phase === 'initializing'
    ? <InitializationCore profile={profile} onComplete={onComplete} />
    : <WelcomeHero profile={profile} userName={userName} onEnterDashboard={onEnterDashboard} />;
}
