/**
 * Supervisor Agent (Phase PX-5).
 *
 * Routes a student message to the specialized agent (tutor / planner /
 * exam / coach) through the Agent Protocol. The supervisor holds no data
 * access itself; it only adapts the existing services into the protocol
 * (each of those services already reaches data exclusively through the
 * tool registry / canonical services).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AGENT_INTENTS,
  detectIntent,
  makeCorrelationId,
  type AgentIntent,
  type AgentProtocolRequest,
  type AgentProtocolResponse,
  type CooperatingAgent,
} from './agent-protocol';
import { TutorService } from './tutor.service';
import { StudyPlannerService } from './study-planner.service';
import { ExamSimulatorService } from './exam-simulator.service';
import { StudyAgentService } from './study-agent.service';

/** Adapts TutorService (Socratic sessions) to the protocol. */
class TutorAgent implements CooperatingAgent {
  readonly name = 'tutor-agent';
  readonly intents: readonly AgentIntent[] = ['tutor'];
  constructor(private readonly tutor: TutorService) {}
  async handle(request: AgentProtocolRequest): Promise<AgentProtocolResponse> {
    try {
      const result = await this.tutor.start(request.userId, {
        topic: String(request.payload.message ?? request.payload.topic ?? ''),
        ...(typeof request.payload.knowledgeNodeId === 'string' ? { knowledgeNodeId: request.payload.knowledgeNodeId } : {}),
      });
      return { correlationId: request.correlationId, from: this.name, ok: true, data: result, citations: result.node.knowledgeNodeId !== 'unknown' ? [result.node.knowledgeNodeId] : [] };
    } catch (error) {
      return this.failure(request, error);
    }
  }
  private failure(request: AgentProtocolRequest, error: unknown): AgentProtocolResponse {
    return { correlationId: request.correlationId, from: this.name, ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Adapts StudyPlannerService (validate-only by default) to the protocol. */
class PlannerAgent implements CooperatingAgent {
  readonly name = 'planner-agent';
  readonly intents: readonly AgentIntent[] = ['plan'];
  constructor(private readonly planner: StudyPlannerService) {}
  async handle(request: AgentProtocolRequest): Promise<AgentProtocolResponse> {
    try {
      const result = await this.planner.generatePlan(request.userId, {
        goal: String(request.payload.message ?? ''),
        ...(typeof request.payload.scheduledDate === 'string' ? { scheduledDate: request.payload.scheduledDate } : {}),
        ...(typeof request.payload.availableMinutes === 'number' ? { availableMinutes: request.payload.availableMinutes as 30 | 60 | 120 | 180 } : {}),
        execute: request.payload.execute === true,
      }, new Date());
      return { correlationId: request.correlationId, from: this.name, ok: true, data: result };
    } catch (error) {
      return { correlationId: request.correlationId, from: this.name, ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Adapts ExamSimulatorService to the protocol. */
class ExamAgent implements CooperatingAgent {
  readonly name = 'exam-agent';
  readonly intents: readonly AgentIntent[] = ['exam'];
  constructor(private readonly simulator: ExamSimulatorService) {}
  async handle(request: AgentProtocolRequest): Promise<AgentProtocolResponse> {
    try {
      const result = await this.simulator.generateExam(request.userId, {
        ...(typeof request.payload.subject === 'string' ? { subject: request.payload.subject as 'DS' | 'CO' | 'OS' | 'CN' } : {}),
        ...(typeof request.payload.questionCount === 'number' ? { questionCount: request.payload.questionCount } : {}),
      });
      return {
        correlationId: request.correlationId,
        from: this.name,
        ok: true,
        data: result,
        citations: result.knowledgeContext.retrievedNodes.map((node) => node.knowledgeNodeId),
      };
    } catch (error) {
      return { correlationId: request.correlationId, from: this.name, ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Adapts StudyAgentService (full agent loop / workflow) to the protocol. */
class CoachAgent implements CooperatingAgent {
  readonly name = 'coach-agent';
  readonly intents: readonly AgentIntent[] = ['coach'];
  constructor(private readonly studyAgent: StudyAgentService) {}
  async handle(request: AgentProtocolRequest): Promise<AgentProtocolResponse> {
    try {
      const result = await this.studyAgent.run(request.userId, {
        message: String(request.payload.message ?? ''),
        ...(request.payload.createTasks === true ? { createTasks: true } : {}),
      });
      return { correlationId: request.correlationId, from: this.name, ok: true, data: result };
    } catch (error) {
      return { correlationId: request.correlationId, from: this.name, ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export interface SupervisorRunResult {
  correlationId: string;
  intent: AgentIntent;
  routedTo: string;
  ok: boolean;
  data: unknown;
  error?: string;
  citations?: readonly string[];
}

@Injectable()
export class SupervisorAgentService {
  private readonly logger = new Logger(SupervisorAgentService.name);
  private readonly agents: CooperatingAgent[];

  constructor(
    tutor: TutorService,
    planner: StudyPlannerService,
    simulator: ExamSimulatorService,
    studyAgent: StudyAgentService,
    @Optional() private readonly metrics?: import('../ai-metrics/ai-metrics.service').AiMetricsService,
  ) {
    this.agents = [
      new TutorAgent(tutor),
      new PlannerAgent(planner),
      new ExamAgent(simulator),
      new CoachAgent(studyAgent),
    ];
  }

  async run(userId: string, input: { message?: string; intent?: AgentIntent; payload?: Record<string, unknown> }, now: Date = new Date()): Promise<SupervisorRunResult> {
    const correlationId = makeCorrelationId(now);
    const intent = this.resolveIntent(input);
    const agent = this.agents.find((candidate) => candidate.intents.includes(intent));
    if (!agent) {
      return { correlationId, intent, routedTo: 'none', ok: false, data: null, error: `no agent registered for intent ${intent}` };
    }
    const request: AgentProtocolRequest = {
      intent,
      userId,
      correlationId,
      payload: { ...(input.payload ?? {}), message: input.message ?? '' },
    };
    const response: AgentProtocolResponse = await agent.handle(request);
    this.metrics?.recordAgentRun({
      mode: 'workflow',
      failed: !response.ok,
      toolCalls: 1,
      failedTools: response.ok ? 0 : 1,
      durationMs: 0,
    });
    this.logger.log(JSON.stringify({
      event: 'supervisor.routed',
      userId,
      correlationId,
      intent,
      routedTo: agent.name,
      ok: response.ok,
    }));
    return {
      correlationId,
      intent,
      routedTo: agent.name,
      ok: response.ok,
      data: response.data,
      ...(response.error ? { error: response.error } : {}),
      ...(response.citations ? { citations: response.citations } : {}),
    };
  }

  listAgents(): Array<{ name: string; intents: readonly string[] }> {
    return this.agents.map((agent) => ({ name: agent.name, intents: agent.intents }));
  }

  private resolveIntent(input: { message?: string; intent?: AgentIntent }): AgentIntent {
    if (input.intent && AGENT_INTENTS.includes(input.intent)) return input.intent;
    return detectIntent(input.message ?? '');
  }
}