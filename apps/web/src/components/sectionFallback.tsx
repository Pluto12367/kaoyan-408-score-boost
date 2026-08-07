import { ModuleUnavailable } from './ModuleResourceState';

/** Phase 3.4: shared lightweight Suspense fallback for lazy section workspaces. */
export function sectionFallback(title: string) {
  return <ModuleUnavailable title={title} resource={{ data: null, state: 'loading' }} onRetry={() => {}} />;
}
