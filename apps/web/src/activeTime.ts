export interface ActiveClock {
  baseMs: number;
  segmentStartedAt: number | null;
}

export function activeElapsedMs(clock: ActiveClock, now: number) {
  const segmentMs = clock.segmentStartedAt == null ? 0 : Math.max(0, now - clock.segmentStartedAt);
  return Math.round(clock.baseMs + segmentMs);
}

export function pauseActiveClock(clock: ActiveClock, now: number): ActiveClock {
  return clock.segmentStartedAt == null
    ? clock
    : { baseMs: activeElapsedMs(clock, now), segmentStartedAt: null };
}

export function resumeActiveClock(clock: ActiveClock, now: number): ActiveClock {
  return clock.segmentStartedAt == null
    ? { ...clock, segmentStartedAt: now }
    : clock;
}
