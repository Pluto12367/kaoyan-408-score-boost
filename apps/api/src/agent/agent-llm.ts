/**
 * AgentLlm adapter over the existing DeepSeekClient (OpenAI-compatible).
 *
 * Created from env: when AI_API_KEY is configured the agent gets a real
 * tool-calling LLM; otherwise no adapter is wired and StudyAgentService
 * falls back to the deterministic workflow (explicit source label, no
 * silent mock).
 */

import { DeepSeekClient } from '../study/deepseek-client';
import type { AgentLlm, AgentLlmResponse, AgentLlmTurn } from './study-agent.service';

export class DeepSeekAgentLlm implements AgentLlm {
  readonly name: string;

  constructor(private readonly client: DeepSeekClient) {
    this.name = `agent-llm:${process.env.AI_MODEL ?? 'deepseek-v4-flash'}`;
  }

  async complete(input: { messages: AgentLlmTurn[]; tools: unknown[] }): Promise<AgentLlmResponse> {
    // Map agent turns to OpenAI chat messages. Tool-result turns use the
    // 'tool' role with tool_call_id; assistant tool_calls pass through.
    const messages = input.messages.map((turn) => {
      if (turn.role === 'assistant' && turn.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: turn.content || '',
          tool_calls: turn.toolCalls.map((call, index) => ({
            id: call.id ?? `call_${index}`,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments || '{}' },
          })),
        };
      }
      if (turn.role === 'tool') {
        return {
          role: 'tool' as const,
          content: turn.content,
          tool_call_id: turn.toolCallId ?? 'call_0',
        };
      }
      return { role: turn.role, content: turn.content };
    });
    const result = await this.client.chatCompletions({
      messages,
      tools: input.tools as Array<Record<string, unknown>>,
    });
    return {
      content: result.content ?? null,
      toolCalls: (result.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
      ...(result.usage
        ? {
            usage: {
              promptTokens: result.usage.prompt_tokens ?? 0,
              completionTokens: result.usage.completion_tokens ?? 0,
            },
          }
        : {}),
    };
  }
}

export function createAgentLlmFromEnv(): DeepSeekAgentLlm | null {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;
  return new DeepSeekAgentLlm(new DeepSeekClient({ apiKey }));
}