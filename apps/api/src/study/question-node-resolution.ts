/**
 * V12.1 — question → knowledge node, using PRODUCTION's resolution.
 *
 * ## Why this module exists
 *
 * Both shadow services used to build their question→node map by querying
 * `QuestionKnowledgeNodeTag` directly. In the real production database that
 * table is **empty** — 332 questions, 0 rows — and every node association comes
 * from the legacy bridge `QuestionKnowledgePoint` → `KnowledgePointNodeMap`.
 * The direct-only query therefore made both shadows blind to 100% of real
 * reviews. Measured symptom on the live deployment: a student with exactly one
 * review produced `eventsWithoutNode = 1`, i.e. the observation was recorded but
 * could not be attributed to any node, and the shadow reported "nothing to
 * compare" for every real student.
 *
 * That is the same root cause as the review→mastery projection defect found by
 * the live smoke; the fixture correction surfaced it here as well. Rather than
 * repeat a narrower query in each shadow, this helper delegates to
 * `resolveKnowledgeNodesForQuestion`, which is the production resolver (tiers:
 * trusted direct tag → bridge-sourced tag → `QuestionKnowledgePoint` →
 * `KnowledgePointNodeMap`). Production, the projection and both shadows now
 * resolve nodes through one implementation.
 *
 * Cost: the common case (a direct tag exists) stays exactly one batched query.
 * The per-question fallback only runs for questions the tag table cannot answer.
 */

import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveKnowledgeNodesForQuestion } from '../score-center/repository';

export interface ResolvedQuestionNode {
  readonly nodeId: string;
  readonly role: string;
}

/** PRIMARY outranks SECONDARY when one question resolves to several nodes. */
function rankRole(role: string): number {
  return role === 'PRIMARY' ? 0 : 1;
}

export async function resolvePrimaryNodeByQuestion(
  db: Prisma.TransactionClient | PrismaService,
  questionIds: readonly string[],
): Promise<Map<string, ResolvedQuestionNode>> {
  const resolved = new Map<string, ResolvedQuestionNode>();
  if (questionIds.length === 0) return resolved;

  // Fast path — one batched query for every question that has a tag row.
  const tags = await db.questionKnowledgeNodeTag.findMany({
    where: { questionId: { in: [...questionIds] } },
    select: { questionId: true, knowledgeNodeId: true, role: true },
  });
  for (const tag of [...tags].sort((left, right) => rankRole(left.role) - rankRole(right.role))) {
    if (!resolved.has(tag.questionId)) {
      resolved.set(tag.questionId, { nodeId: tag.knowledgeNodeId, role: tag.role });
    }
  }

  // Fallback tier — production's resolver, only where the tag table is silent.
  for (const questionId of questionIds) {
    if (resolved.has(questionId)) continue;
    const candidates = await resolveKnowledgeNodesForQuestion(db, questionId);
    if (candidates.length === 0) continue;
    const best = [...candidates].sort((left, right) => rankRole(left.role) - rankRole(right.role))[0];
    resolved.set(questionId, { nodeId: best.knowledgeNodeId, role: best.role });
  }

  return resolved;
}
