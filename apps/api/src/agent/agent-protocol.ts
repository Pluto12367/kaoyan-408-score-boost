/**
 * Agent Protocol (Phase PX-5).
 *
 * Agents NEVER share database handles or each other's internals — they
 * communicate exclusively through typed envelopes. Every request carries a
 * correlation id; every response names its origin agent and reports the
 * knowledge citations it grounded on (when applicable).
 */

export type AgentIntent = 'tutor' | 'plan' | 'exam' | 'coach';

export const AGENT_INTENTS: readonly AgentIntent[] = ['tutor', 'plan', 'exam', 'coach'];

export interface AgentProtocolRequest<P = Record<string, unknown>> {
  intent: AgentIntent;
  userId: string;
  correlationId: string;
  payload: P;
}

export interface AgentProtocolResponse<T = unknown> {
  correlationId: string;
  from: string;
  ok: boolean;
  data: T | null;
  error?: string;
  citations?: readonly string[];
}

/** Contract every specialized agent fulfills to join the system. */
export interface CooperatingAgent {
  readonly name: string;
  readonly intents: readonly AgentIntent[];
  handle(request: AgentProtocolRequest): Promise<AgentProtocolResponse>;
}

export function makeCorrelationId(now: Date = new Date()): string {
  return `corr-${now.getTime()}-${Math.abs(now.getMilliseconds())}`;
}

/** Intent routing from free text (deterministic keyword rules). */
export function detectIntent(message: string): AgentIntent {
  const text = (message ?? '').trim();
  if (/(考试|模考|模拟考|出题|来一套|测验)/.test(text)) return 'exam';
  if (/(安排|计划|任务|今天学|规划|日程)/.test(text)) return 'plan';
  if (/(解释|讲讲|不懂|不会|为什么|什么是|明白|教我|引导)/.test(text)) return 'tutor';
  return 'coach';
}