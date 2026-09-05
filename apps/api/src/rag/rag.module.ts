/**
 * RAG Module.
 *
 * Provides semantic search for 408 knowledge nodes.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RagController } from './rag.controller';
import { KnowledgeCorpusLoader } from './knowledge-corpus.loader';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeRetriever } from './knowledge-retriever.service';
import { LearningRagService } from './learning-rag.service';
import { InMemoryVectorStore } from './vector-store';
import { createEmbeddingProvider, EmbeddingProvider } from './embedding-provider';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RagController],
  providers: [
    KnowledgeCorpusLoader,
    {
      provide: 'EMBEDDING_PROVIDER',
      useFactory: (): EmbeddingProvider => createEmbeddingProvider(),
    },
    {
      provide: 'VECTOR_STORE',
      useClass: InMemoryVectorStore,
    },
    {
      provide: KnowledgeSearchService,
      useFactory: (
        corpusLoader: KnowledgeCorpusLoader,
        provider: EmbeddingProvider,
        store: InMemoryVectorStore,
      ) => new KnowledgeSearchService(corpusLoader, provider, store),
      inject: [KnowledgeCorpusLoader, 'EMBEDDING_PROVIDER', 'VECTOR_STORE'],
    },
    KnowledgeRetriever,
    LearningRagService,
  ],
  exports: [KnowledgeSearchService, KnowledgeRetriever, LearningRagService],
})
export class RagModule {}