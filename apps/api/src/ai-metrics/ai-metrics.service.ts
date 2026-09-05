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
}

export interface CoachResponseEvent {
  at: number;
  source: string;
  fallback: boolean;
  durationMs: number;
}

const MAX_EVENTS = 5000;
const WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class AiMetricsService {
  private agentRuns: AgentRunEvent[] = [];
  private ragSearches: RagSearchEvent[] = [];
  private coachResponses: CoachResponseEvent[] = [];

  recordAgentRun(event: Omit<AgentRunEvent, 'at'> & { at?: number }): void {
    this.push(this.agentRuns, { at: event.at ?? Date.now(), ...event } as AgentRunEvent);
  }

  recordRagSearch(event: Omit<RagSearchEvent, 'at'> & { at?: number }): void {
    this.push(this.ragSearches, { at: event.at ?? Date.now(), ...event } as RagSearchEvent);
  }

  recordCoachResponse(event: Omit<CoachResponseEvent, 'at'> & { at?: number }): void {
    this.push(this.coachResponses, { at: event.at ?? Date.now(), ...event } as CoachResponseEvent);
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
      },
      coach: {
        responses: coach.length,
        fallbackRate: ratio(coach.filter((event) => event.fallback).length, coach.length),
        avgLatencyMs: avg(coach.map((event) => event.durationMs)),
      },
    };
  }

  reset(): void {
    this.agentRuns = [];
    this.ragSearches = [];
    this.coachResponses = [];
  }

  private push<T>(list: T[], event: T): void {
    list.push(event);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  }
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
  };
  coach: {
    responses: number;
    fallbackRate: number;
    avgLatencyMs: number | null;
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