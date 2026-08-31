import type { CatalogPointContext } from '@kaoyan408/shared';
import type { StudentAction } from '../studentAction';

export interface KnowledgeActionInput {
  nodeId?: string;
  title: string;
  prerequisiteContexts?: readonly CatalogPointContext[];
  relatedContexts?: readonly CatalogPointContext[];
  relatedQuestionIds?: readonly string[];
  questQuestionIds?: readonly string[];
}

export function buildKnowledgeActions(input: KnowledgeActionInput): StudentAction[] {
  if (!isRealId(input.nodeId)) return [];

  const actions: StudentAction[] = [];
  const actionIds = new Set<string>();
  const addAction = (action: StudentAction) => {
    if (actionIds.has(action.id)) return;
    actionIds.add(action.id);
    actions.push(action);
  };

  addAction({
    id: `knowledge-explore:${input.nodeId}`,
    type: 'knowledge_explore',
    title: input.title,
    destination: 'knowledge',
    source: 'knowledge',
    context: { knowledgeNodeId: input.nodeId },
  });

  for (const context of input.prerequisiteContexts ?? []) {
    const nodeId = context?.point?.id;
    if (isRealId(nodeId)) addAction(exploreAction(nodeId, context.point.name));
  }

  for (const context of input.relatedContexts ?? []) {
    const nodeId = context?.point?.id;
    if (isRealId(nodeId)) addAction(exploreAction(nodeId, context.point.name));
  }

  for (const questionId of input.relatedQuestionIds ?? []) {
    if (!isRealId(questionId)) continue;
    addAction({
      id: `knowledge-practice:${input.nodeId}:${questionId}`,
      type: 'practice_recommended',
      title: input.title,
      destination: 'practice',
      source: 'training',
      context: { knowledgeNodeId: input.nodeId, questionId },
    });
  }

  const questQuestionIds = uniqueRealIds(input.questQuestionIds ?? []);
  if (questQuestionIds.length > 0) {
    addAction({
      id: `knowledge-quest:${input.nodeId}`,
      type: 'knowledge_quest',
      title: input.title,
      destination: 'practice',
      source: 'knowledge',
      context: { knowledgeNodeId: input.nodeId, questionIds: questQuestionIds },
    });
  }

  return actions;
}

function isRealId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueRealIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!isRealId(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function exploreAction(nodeId: string, title: string): StudentAction {
  return {
    id: `knowledge-explore:${nodeId}`,
    type: 'knowledge_explore',
    title,
    destination: 'knowledge',
    source: 'knowledge',
    context: { knowledgeNodeId: nodeId },
  };
}
