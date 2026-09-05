/**
 * AI Metrics (Phase AI-12) — in-memory sliding-window observability.
 *
 * Aggregates run/search/response events for the three AI surfaces
 * (agent / rag / coach) into a queryable snapshot consumed by
 * GET /ai/metrics (admin). No persistence, no schema: a bounded ring of
 * recent events (max 5000, max age 60 min) — restart resets to zero, which
 * is acceptable for an operational live view; durable analytics remain a
 * future infrastructure decision outside the frozen-schema constraint.
 */

import { Injectable } from '@nestjs/common';

export interface AgentRunEvent {
  at: number;
  mode: 'llm' | 'workflow';
  failed: boolean;
  toolCalls: number;
  failedTools: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface RagSearchEvent {
  at: number;
  available: boolean;
  resultCount: number;
  topScore: number | null;
  durationMs: number;
  /** True when a warm index served the search (no cold rebuild). */
  cacheHit?: boolean;
}

export interface CoachResponseEvent {
  at: number;
  source: string;
  fallback: boolean;
  durationMs: number;
}

export interface EvaluationEvent {
  at: number;
  suite: string;
  passed: boolean;
  score: number;
}

export interface RiskDetectedEvent {
  at: number;
  type: string;
  severity: string;
  userId: string;
}

export interface AdaptiveRecommendationEvent {
  at: number;
  adjustedCount: number;
  strategyNote: string;
}

export interface PlanAdaptationEvent {
  at: number;
  planId: string;
  adapted: boolean;
}

export interface ReviewAdaptationEvent {
  at: number;
  intervalDays: number;
  intensity: string;
}

export interface CoachInterventionEvent {
  at: number;
  trigger: string;
  actorHint: string;
}

export interface LearningOutcomeDeltaEvent {
  at: number;
  masteryDelta: number;
  accuracyDelta: number;
}

const MAX_EVENTS = 5000;
const WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class AiMetricsService {
  private agentRuns: AgentRunEvent[] = [];
  private ragSearches: RagSearchEvent[] = [];
  private coachResponses: CoachResponseEvent[] = [];
  private evaluations: EvaluationEvent[] = [];
  private risksDetected: Array<{ at: number; type: string; severity: string; userId: string }> = [];
  private adaptiveRecommendations: Array<{ at: number; adjustedCount: number; strategyNote: string }> = [];
  private planAdaptations: Array<{ at: number; planId: string; adapted: boolean }> = [];
  private reviewAdaptations: Array<{ at: number; intervalDays: number; intensity: string }> = [];
  private coachInterventions: Array<{ at: number; trigger: string; actorHint: string }> = [];
  private learningOutcomeDeltas: Array<{ at: number; masteryDelta: number; accuracyDelta: number }> = [];

  recordRiskDetected(event: { type: string; severity: string; userId: string; at?: number }): void {
    this.push(this.risksDetected, { at: event.at ?? Date.now(), type: event.type, severity: event.severity, userId: event.userId });
  }

  recordAdaptiveRecommendation(event: { adjustedCount: number; strategyNote?: string; at?: number }): void {
    this.push(this.adaptiveRecommendations, { at: event.at ?? Date.now(), adjustedCount: event.adjustedCount, strategyNote: event.strategyNote ?? '' });
  }

  recordPlanAdaptation(event: { planId: string; adapted: boolean; at?: number }): void {
    this.push(this.planAdaptations, { at: event.at ?? Date.now(), planId: event.planId, adapted: event.adapted });
  }

  recordReviewAdaptation(event: { intervalDays: number; intensity: string; at?: number }): void {
    this.push(this.reviewAdaptations, { at: event.at ?? Date.now(), intervalDays: event.intervalDays, intensity: event.intensity });
  }

  recordCoachIntervention(event: { trigger: string; actorHint: string; at?: number }): void {
    this.push(this.coachInterventions, { at: event.at ?? Date.now(), trigger: event.trigger, actorHint: event.actorHint });
  }

  recordLearningOutcomeDelta(event: { masteryDelta: number; accuracyDelta: number; at?: number }): void {
    this.push(this.learningOutcomeDeltas, { at: event.at ?? Date.now(), masteryDelta: event.masteryDelta, accuracyDelta: event.accuracyDelta });
  }

  recordAgentRun(event: Omit<AgentRunEvent, 'at'> & { at?: number }): void {
    this.push(this.agentRuns, { at: event.at ?? Date.now(), ...event } as AgentRunEvent);
  }

  recordRagSearch(event: Omit<RagSearchEvent, 'at'> & { at?: number }): void {
    this.push(this.ragSearches, { at: event.at ?? Date.now(), ...event } as RagSearchEvent);
  }

  recordCoachResponse(event: Omit<CoachResponseEvent, 'at'> & { at?: number }): void {
    this.push(this.coachResponses, { at: event.at ?? Date.now(), ...event } as CoachResponseEvent);
  }

  recordEvaluation(event: Omit<EvaluationEvent, 'at'> & { at?: number }): void {
    this.push(this.evaluations, { at: event.at ?? Date.now(), ...event } as EvaluationEvent);
  }

  snapshot(now: number = Date.now()): AiMetricsSnapshot {
    const since = now - WINDOW_MS;
    const agent = this.agentRuns.filter((event) => event.at >= since);
    const rag = this.ragSearches.filter((event) => event.at >= since);
    const coach = this.coachResponses.filter((event) => event.at >= since);

    const agentLatencies = agent.map((event) => event.durationMs).sort((left, right) => left - right);
    const promptTokens = agent.reduce((sum, event) => sum + (event.promptTokens ?? 0), 0);
    const completionTokens = agent.reduce((sum, event) => sum + (event.completionTokens ?? 0), 0);
    const ragScores = rag.map((event) => event.topScore).filter((score): score is number => score != null);
    const ragCacheHits = rag.filter((event) => event.cacheHit === true).length;

    return {
      window: { maxAgeMinutes: WINDOW_MS / 60000, eventCap: MAX_EVENTS },
      agent: {
        runs: agent.length,
        llmRuns: agent.filter((event) => event.mode === 'llm').length,
        workflowRuns: agent.filter((event) => event.mode === 'workflow').length,
        failureRate: ratio(agent.filter((event) => event.failed).length, agent.length),
        toolCalls: agent.reduce((sum, event) => sum + event.toolCalls, 0),
        failedToolCalls: agent.reduce((sum, event) => sum + event.failedTools, 0),
        avgLatencyMs: avg(agentLatencies),
        p95LatencyMs: percentile(agentLatencies, 0.95),
        tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
      },
      rag: {
        searches: rag.length,
        hitRate: ratio(rag.filter((event) => event.available && event.resultCount > 0).length, rag.length),
        avgTopScore: avg(ragScores),
        avgLatencyMs: avg(rag.map((event) => event.durationMs)),
        cacheHitRate: ratio(rag.filter((event) => event.cacheHit === true).length, rag.length),
      },
      coach: {
        responses: coach.length,
        fallbackRate: ratio(coach.filter((event) => event.fallback).length, coach.length),
        avgLatencyMs: avg(coach.map((event) => event.durationMs)),
      },
      evaluation: {
        runs: this.evaluations.filter((event) => event.at >= since).length,
        passRate: 0,
        avgScore: null,
        suites: [],
      },
    };
  }

  snapshotLearningIntelligence(now: number = Date.now()): LearningIntelligenceSnapshot {
    const since = now - WINDOW_MS;
    const risks = this.risksDetected.filter((event) => event.at >= since);
    const adaptiveRecs = this.adaptiveRecommendations.filter((event) => event.at >= since);
    const planAdaptations = this.planAdaptations.filter((event) => event.at >= since);
    const reviewAdaptations = this.reviewAdaptations.filter((event) => event.at >= since);
    const coachInterventions = this.coachInterventions.filter((event) => event.at >= since);
    const outcomeDeltas = this.learningOutcomeDeltas.filter((event) => event.at >= since);

    const byTrigger: Record<string, number> = {};
    for (const intervention of coachInterventions) {
      byTrigger[intervention.trigger] = (byTrigger[intervention.trigger] ?? 0) + 1;
    }
    const bySeverity: Record<string, number> = {};
    for (const risk of risks) {
      bySeverity[risk.severity] = (bySeverity[risk.severity] ?? 0) + 1;
    }
    const masteryAvg = outcomeDeltas.length > 0
      ? Math.round((outcomeDeltas.reduce((sum, delta) => sum + delta.masteryDelta, 0) / outcomeDeltas.length) * 10000) / 10000
      : null;
    const accuracyAvg = outcomeDeltas.length > 0
      ? Math.round((outcomeDeltas.reduce((sum, delta) => sum + delta.accuracyDelta, 0) / outcomeDeltas.length) * 10000) / 10000
      : null;

    return {
      riskDetected: { total: risks.length, bySeverity },
      adaptiveRecommendation: { count: adaptiveRecs.length, avgAdjustedCount: adaptiveRecs.length > 0 ? Math.round((adaptiveRecs.reduce((sum, rec) => sum + rec.adjustedCount, 0) / adaptiveRecs.length) * 100) / 100 : null },
      planAdaptation: { count: planAdaptations.length },
      reviewAdaptation: { count: reviewAdaptations.length },
      coachIntervention: { count: coachInterventions.length, byTrigger },
      learningOutcomeDelta: { masteryAvg, accuracyAvg, sampleCount: outcomeDeltas.length },
    };
  }

  reset(): void {
    this.agentRuns = [];
    this.ragSearches = [];
    this.coachResponses = [];
    this.evaluations = [];
    this.risksDetected = [];
    this.adaptiveRecommendations = [];
    this.planAdaptations = [];
    this.reviewAdaptations = [];
    this.coachInterventions = [];
    this.learningOutcomeDeltas = [];
  }

  private push<T>(list: T[], event: T): void {
    list.push(event);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  }
}


export interface LearningIntelligenceSnapshot {
  riskDetected: { total: number; bySeverity: Record<string, number> };
  adaptiveRecommendation: { count: number; avgAdjustedCount: number | null };
  planAdaptation: { count: number };
  reviewAdaptation: { count: number };
  coachIntervention: { count: number; byTrigger: Record<string, number> };
  learningOutcomeDelta: { masteryAvg: number | null; accuracyAvg: number | null; sampleCount: number };
}

export interface AiMetricsSnapshot {
  window: { maxAgeMinutes: number; eventCap: number };
  agent: {
    runs: number;
    llmRuns: number;
    workflowRuns: number;
    failureRate: number;
    toolCalls: number;
    failedToolCalls: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    tokens: { prompt: number; completion: number; total: number };
  };
  rag: {
    searches: number;
    hitRate: number;
    avgTopScore: number | null;
    avgLatencyMs: number | null;
    cacheHitRate: number;
  };
  coach: {
    responses: number;
    fallbackRate: number;
    avgLatencyMs: number | null;
  };
  evaluation: {
    runs: number;
    passRate: number;
    avgScore: number | null;
    suites: string[];
  };
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 10000) / 10000;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}