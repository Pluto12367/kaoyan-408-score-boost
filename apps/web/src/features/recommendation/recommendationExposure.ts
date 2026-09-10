/**
 * V12-M2a — recommendation exposure reporting (client side of EB-3).
 *
 * The server can prove it *generated* a recommendation. Only the client can
 * observe that a surface actually *rendered* it for the student, so exposure
 * and "opened the explanation" are reported from here.
 *
 * Rules that keep this honest:
 *   • report only what was actually rendered (called from a render effect with
 *     real items), never from a request succeeding or a plan merely existing;
 *   • never report in static-demo mode — a demo has no student to observe;
 *   • de-duplicate per day/surface/item, because the telemetry endpoint is
 *     append-only and repeated renders would otherwise flood it and inflate
 *     nothing useful (the funnel counts stages, not hits).
 */

import { trackEvent } from '../../api/events';
import { isStaticDemoMode } from '../../api/env';

export interface ExposureTarget {
  readonly actionId?: string | null;
  readonly taskId?: string | null;
}

export type ExposureSurface = 'today_mission' | 'score_center' | 'review_queue' | 'exam_aligned';

const reported = new Set<string>();

/** Test seam: reset the de-duplication memory. */
export function resetExposureMemory(): void {
  reported.clear();
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function targetKey(target: ExposureTarget): string | null {
  return target.actionId ?? target.taskId ?? null;
}

function report(stage: 'recommendation.exposed' | 'recommendation.viewed', surface: ExposureSurface, target: ExposureTarget): void {
  if (isStaticDemoMode()) return;
  const id = targetKey(target);
  if (!id) return;
  const key = `${dayKey()}:${stage}:${surface}:${id}`;
  if (reported.has(key)) return;
  reported.add(key);
  void trackEvent(stage, {
    surface,
    actionId: target.actionId ?? null,
    taskId: target.taskId ?? null,
  });
}

/** The surface rendered this recommendation for the student. */
export function reportRecommendationExposed(surface: ExposureSurface, targets: readonly ExposureTarget[]): void {
  for (const target of targets) report('recommendation.exposed', surface, target);
}

/** The student opened this recommendation's explanation. */
export function reportRecommendationViewed(surface: ExposureSurface, target: ExposureTarget): void {
  report('recommendation.viewed', surface, target);
}
