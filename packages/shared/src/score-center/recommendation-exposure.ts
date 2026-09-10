/**
 * V12-M2a — Recommendation Exposure funnel (pure module).
 *
 * ## Why this module exists
 *
 * V12-0 audit breakpoint EB-3: the engine recorded that it *generated* a
 * recommendation and that a task was *started* and *completed*, but the second
 * link of the intervention chain — "did the student actually SEE it?" — had no
 * telemetry at all. Without that link, exposure can never be separated from
 * generation, and the funnel is unfalsifiable.
 *
 * ## The honesty rule this module enforces
 *
 * There are two ways to fabricate a funnel, and both are rejected here:
 *
 *   1. Reporting `0 exposed` when no exposure telemetry exists at all. That is
 *      not a measurement, it is an absence — so we return **null (unknown)**.
 *   2. Reporting `exposed` from anything other than a real client observation
 *      (e.g. inferring it from "a task exists" or "a plan was generated").
 *      Exposure is only ever set by an observation that says so.
 *
 * Once telemetry *is* flowing, absence becomes meaningful: the instrument
 * works, so a recommendation with no observation was genuinely not seen, and
 * the row is `false` rather than `null`.
 *
 * Generated / started / completed come from the server's own facts
 * (`RecommendationAction`), which need no telemetry.
 *
 * Pure: zero imports, no clock, deterministic.
 */

export type RecommendationStage = 'generated' | 'exposed' | 'viewed' | 'started' | 'completed';

/** A recommendation the server knows it produced (RecommendationAction). */
export interface RecommendationFact {
  readonly actionId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly status: string;
  readonly taskId?: string | null;
}

/**
 * A client-reported observation. `exposed` = the surface actually rendered the
 * item for this student; `viewed` = the student opened its explanation.
 */
export interface ExposureObservation {
  readonly stage: 'exposed' | 'viewed';
  readonly actionId?: string | null;
  readonly taskId?: string | null;
  readonly surface?: string | null;
  readonly at: string;
}

export interface RecommendationFunnelStages {
  readonly generated: true;
  /** null = no exposure telemetry exists yet (unknown, not zero). */
  readonly exposed: boolean | null;
  readonly viewed: boolean | null;
  readonly started: boolean;
  readonly completed: boolean;
}

export interface RecommendationFunnelRow {
  readonly actionId: string;
  readonly title: string;
  readonly stages: RecommendationFunnelStages;
  readonly reachedStage: RecommendationStage;
  readonly basis: string;
}

export interface RecommendationFunnelSummary {
  readonly generated: number;
  /** null = unknown because no exposure telemetry exists. */
  readonly exposed: number | null;
  readonly viewed: number | null;
  readonly started: number;
  readonly completed: number;
  readonly exposureTelemetryAvailable: boolean;
  readonly basis: string;
}

export interface RecommendationFunnel {
  readonly rows: readonly RecommendationFunnelRow[];
  readonly summary: RecommendationFunnelSummary;
}

export function buildRecommendationFunnel(input: {
  readonly recommendations: readonly RecommendationFact[];
  readonly observations: readonly ExposureObservation[];
}): RecommendationFunnel {
  const telemetryAvailable = input.observations.length > 0;

  const exposedKeys = collectKeys(input.observations, 'exposed');
  const viewedKeys = collectKeys(input.observations, 'viewed');

  const rows: RecommendationFunnelRow[] = input.recommendations.map((fact) => {
    const keys = keysFor(fact);
    const exposed = telemetryAvailable ? matches(keys, exposedKeys) : null;
    const viewed = telemetryAvailable ? matches(keys, viewedKeys) : null;
    const started = isStarted(fact);
    const completed = isCompleted(fact);

    const stages: RecommendationFunnelStages = { generated: true, exposed, viewed, started, completed };
    return {
      actionId: fact.actionId,
      title: fact.title,
      stages,
      reachedStage: reachedStage(stages),
      basis: rowBasis(stages, telemetryAvailable),
    };
  });

  const exposedCount = telemetryAvailable ? rows.filter((row) => row.stages.exposed === true).length : null;
  const viewedCount = telemetryAvailable ? rows.filter((row) => row.stages.viewed === true).length : null;
  const startedCount = rows.filter((row) => row.stages.started).length;
  const completedCount = rows.filter((row) => row.stages.completed).length;

  return {
    rows,
    summary: {
      generated: rows.length,
      exposed: exposedCount,
      viewed: viewedCount,
      started: startedCount,
      completed: completedCount,
      exposureTelemetryAvailable: telemetryAvailable,
      basis: summaryBasis({
        generated: rows.length,
        telemetryAvailable,
        exposed: exposedCount,
        started: startedCount,
        completed: completedCount,
      }),
    },
  };
}

function keysFor(fact: RecommendationFact): readonly string[] {
  return [fact.actionId, fact.taskId].filter((value): value is string => Boolean(value));
}

function collectKeys(
  observations: readonly ExposureObservation[],
  stage: ExposureObservation['stage'],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const observation of observations) {
    if (observation.stage !== stage) continue;
    if (observation.actionId) keys.add(observation.actionId);
    if (observation.taskId) keys.add(observation.taskId);
  }
  return keys;
}

function matches(keys: readonly string[], observed: ReadonlySet<string>): boolean {
  return keys.some((key) => observed.has(key));
}

function isStarted(fact: RecommendationFact): boolean {
  if (fact.startedAt) return true;
  return fact.status === 'STARTED' || fact.status === 'COMPLETED';
}

function isCompleted(fact: RecommendationFact): boolean {
  if (fact.completedAt) return true;
  return fact.status === 'COMPLETED';
}

/**
 * The deepest stage the evidence actually supports. Server facts outrank absent
 * telemetry, so a started recommendation is never downgraded to "generated"
 * merely because exposure was never recorded.
 */
function reachedStage(stages: RecommendationFunnelStages): RecommendationStage {
  if (stages.completed) return 'completed';
  if (stages.started) return 'started';
  if (stages.viewed === true) return 'viewed';
  if (stages.exposed === true) return 'exposed';
  return 'generated';
}

function rowBasis(stages: RecommendationFunnelStages, telemetryAvailable: boolean): string {
  if (stages.completed) return '推荐已完成，链路走到完成。';
  if (stages.started) return '推荐已开始，链路走到执行。';
  if (stages.viewed === true) return '学生打开了该推荐的解释，可确认推荐被看到并查看。';
  if (stages.exposed === true) return '前端已上报该推荐曝光，可确认推荐被看到。';
  if (!telemetryAvailable) return '曝光遥测尚无数据，无法判断该推荐是否被学生看到。';
  return '曝光遥测正常但未收到该推荐的曝光上报，判定为未被看到。';
}

function summaryBasis(input: {
  generated: number;
  telemetryAvailable: boolean;
  exposed: number | null;
  started: number;
  completed: number;
}): string {
  if (input.generated === 0) {
    return '近窗口内没有生成过推荐，漏斗为空。';
  }
  if (!input.telemetryAvailable) {
    return `已生成 ${input.generated} 条推荐（开始 ${input.started}、完成 ${input.completed}），但曝光遥测尚无数据：无法判断学生是否看到推荐，不给出曝光数字。`;
  }
  return `已生成 ${input.generated} 条推荐，其中被看到 ${input.exposed ?? 0} 条、开始 ${input.started} 条、完成 ${input.completed} 条。`;
}
