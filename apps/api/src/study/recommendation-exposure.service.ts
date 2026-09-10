/**
 * V12-M2a — Recommendation Exposure service.
 *
 * Answers the second link of the intervention chain (audit breakpoint EB-3):
 * for the recommendations the engine produced, did the student actually SEE
 * them?
 *
 *   generated / started / completed  ← server facts (RecommendationAction)
 *   exposed / viewed                 ← client telemetry (POST /events)
 *
 * Honesty: when no exposure telemetry exists at all, the funnel reports
 * unknown (null) instead of a fabricated zero, and no stage is ever inferred
 * from another. Read-only: this service writes nothing.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildRecommendationFunnel,
  type ExposureObservation,
  type RecommendationFact,
  type RecommendationFunnel,
} from '@kaoyan408/shared';
import { RecommendationActionRepository } from './recommendation-action.repository';
import { UserEventRepository } from './user-event.repository';

/** Client-originated telemetry types that feed the exposure funnel. */
export const RECOMMENDATION_EXPOSED_EVENT = 'recommendation.exposed';
export const RECOMMENDATION_VIEWED_EVENT = 'recommendation.viewed';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;
const DEFAULT_ACTION_LIMIT = 50;
const MAX_ACTION_LIMIT = 200;
const MAX_TELEMETRY_ROWS = 500;

export interface RecommendationFunnelResult {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly funnel: RecommendationFunnel;
}

@Injectable()
export class RecommendationExposureService {
  constructor(
    @Optional() private readonly actions?: RecommendationActionRepository,
    @Optional() private readonly userEvents?: UserEventRepository,
  ) {}

  get enabled(): boolean {
    return Boolean(this.actions && this.userEvents?.enabled);
  }

  /** null = store unavailable (honestly absent, never an empty funnel). */
  async getFunnel(
    userId: string,
    options: { windowDays?: number; limit?: number } = {},
  ): Promise<RecommendationFunnelResult | null> {
    if (!this.enabled) return null;
    const windowDays = clamp(options.windowDays, 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS);
    const limit = clamp(options.limit, 1, MAX_ACTION_LIMIT, DEFAULT_ACTION_LIMIT);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [actionRows, exposedRows, viewedRows] = await Promise.all([
      this.actions!.listRecentByUser(userId, limit),
      this.userEvents!.listByType(userId, RECOMMENDATION_EXPOSED_EVENT, MAX_TELEMETRY_ROWS),
      this.userEvents!.listByType(userId, RECOMMENDATION_VIEWED_EVENT, MAX_TELEMETRY_ROWS),
    ]);

    const recommendations: RecommendationFact[] = actionRows
      .filter((row) => row.createdAt.getTime() >= since.getTime())
      .map((row) => ({
        actionId: row.id,
        title: row.reason?.trim() || row.targetId,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        status: row.status,
        taskId: row.studyTaskId,
      }));

    const observations: ExposureObservation[] = [
      ...toObservations(exposedRows, 'exposed', since),
      ...toObservations(viewedRows, 'viewed', since),
    ];

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      funnel: buildRecommendationFunnel({ recommendations, observations }),
    };
  }
}

/**
 * Defensive decode. A telemetry row without any identity cannot be attributed
 * to a recommendation, so it is dropped rather than counted against all of
 * them.
 */
function toObservations(
  rows: readonly { payload: unknown; createdAt: Date }[],
  stage: ExposureObservation['stage'],
  since: Date,
): ExposureObservation[] {
  const out: ExposureObservation[] = [];
  for (const row of rows) {
    if (row.createdAt.getTime() < since.getTime()) continue;
    const payload = row.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;
    const actionId = typeof record.actionId === 'string' ? record.actionId : null;
    const taskId = typeof record.taskId === 'string' ? record.taskId : null;
    if (!actionId && !taskId) continue;
    out.push({
      stage,
      actionId,
      taskId,
      surface: typeof record.surface === 'string' ? record.surface : null,
      at: row.createdAt.toISOString(),
    });
  }
  return out;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}
