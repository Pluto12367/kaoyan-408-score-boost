/**
 * Learning Memory Service (Phase AI-7) — Nest shell over the pure derivation.
 *
 * Read-only: the only dependency is the canonical StudentContext query
 * service. No storage, no writes; memory is rebuilt per request and could
 * be recomputed from StudentContext at any time.
 */

import { Injectable, Optional } from '@nestjs/common';
import { StudentContextQueryService } from '../study/student-context.query.service';
import { buildLearningMemoryFromContext, buildMemoryBrief, type LearningMemory } from './learning-memory';

@Injectable()
export class LearningMemoryService {
  constructor(
    private readonly studentContext: StudentContextQueryService,
    @Optional() private readonly clock: (() => Date) | undefined,
  ) {}

  async getLearningMemory(userId: string): Promise<LearningMemory & { brief: string }> {
    const now = this.clock ? this.clock() : new Date();
    const context = await this.studentContext.getContext(userId, now);
    const memory = buildLearningMemoryFromContext(context);
    return { ...memory, brief: buildMemoryBrief(memory) };
  }
}