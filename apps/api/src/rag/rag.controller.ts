/**
 * RAG Controller.
 *
 * Provides the semantic search API for knowledge nodes.
 */

import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator';
import { RoleGuard } from '../auth/role.guard';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { KnowledgeSearchService } from './knowledge-search.service';
import { LearningRagService } from './learning-rag.service';
import type { MasteryEntry } from './learning-rag';

@Controller()
export class RagController {
  constructor(
    private readonly knowledgeSearch: KnowledgeSearchService,
    private readonly learningRag: LearningRagService,
  ) {}

  @Get('rag/knowledge/search')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async searchKnowledge(
    @CurrentUser() user: UserProfile,
    @Query('q') query?: string,
    @Query('subject') subject?: string,
    @Query('topK') topK?: string,
  ) {
    if (!query || !query.trim()) {
      throw new BadRequestException('q (query) is required');
    }

    const options: { subject?: string; topK?: number } = {};
    if (subject?.trim()) options.subject = subject.trim();
    if (topK?.trim()) {
      const parsed = Number.parseInt(topK.trim(), 10);
      if (!Number.isNaN(parsed) && parsed > 0) options.topK = parsed;
    }

    return this.knowledgeSearch.search(query.trim(), options);
  }

  /**
   * Learning RAG V2: query rewrite + hybrid retrieval + graph expansion +
   * optional difficulty awareness. The mastery query parameter (format
   * "nodeId:0.3,node2:0.85") exists for explicit callers and tests; the
   * production personalization path passes StudentContext mastery from the
   * agent tools instead of trusting client input.
   */
  @Get('rag/knowledge/v2/search')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async searchKnowledgeV2(
    @CurrentUser() user: UserProfile,
    @Query('q') query?: string,
    @Query('subject') subject?: string,
    @Query('topK') topK?: string,
    @Query('mastery') mastery?: string,
  ) {
    if (!query || !query.trim()) {
      throw new BadRequestException('q (query) is required');
    }
    let studentMastery: MasteryEntry[] | undefined;
    if (mastery?.trim()) {
      studentMastery = parseMasteryParam(mastery);
    }
    const options: { subject?: string; topK?: number } = {};
    if (subject?.trim()) options.subject = subject.trim();
    if (topK?.trim()) {
      const parsed = Number.parseInt(topK.trim(), 10);
      if (!Number.isNaN(parsed) && parsed > 0) options.topK = parsed;
    }
    return this.learningRag.search(query.trim(), {
      ...options,
      ...(studentMastery ? { studentMastery } : {}),
    });
  }
}

function parseMasteryParam(raw: string): MasteryEntry[] {
  const entries: MasteryEntry[] = [];
  for (const pair of raw.split(',')) {
    const [nodeId, value] = pair.split(':');
    const parsed = Number.parseFloat(value ?? '');
    if (!nodeId?.trim() || Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      throw new BadRequestException('mastery must be "nodeId:score" pairs with scores in [0,1]');
    }
    entries.push({ knowledgeNodeId: nodeId.trim(), mastery: parsed });
  }
  return entries;
}