export type ModuleLoadState = 'loading' | 'ready' | 'mock' | 'error';

export interface ModuleResource<T> {
  data: T | null;
  state: ModuleLoadState;
  lastSyncAt?: string;
  error?: string;
}
