/**
 * Study Agent Module (Phase AI-3/AI-4).
 *
 * Composes existing services without touching existing module export
 * contracts: the read-model dependency chain (projections → query services)
 * is registered here directly. Every provider in the chain only depends on
 * the global PrismaService; projections are stateless, so a module-local
 * instance is safe.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QuestionsModule } from '../questions/questions.module';
import { ScoreCenterModule } from '../score-center/score-center.module';
import { RagModule } from '../rag/rag.module';
import { KnowledgeSearchService } from '../rag/knowledge-search.service';
import { QuestionsService } from '../questions/questions.service';
import { MasterySummaryProjectionService } from '../study/mastery-summary-projection.service';
import { StudentStateProjectionService } from '../study/student-state-projection.service';
import { PracticeProjectionService } from '../study/practice-projection.service';
import { WrongQuestionProjectionService } from '../study/wrong-question-projection.service';
import { TodayPlanProjectionService } from '../study/today-plan-projection.service';
import { AssessmentProjectionService } from '../study/assessment-projection.service';
import { StudentContextQueryService } from '../study/student-context.query.service';
import { WrongQuestionQueryService } from '../study/wrong-question-query.service';
import { RecommendationService } from '../study/recommendation.service';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';
import { AgentController } from './agent.controller';
import { StudyAgentToolRegistry } from './agent-tools';
import { StudyAgentService } from './study-agent.service';
import { StudyPlannerService } from './study-planner.service';
import { DailyPlanningService } from './daily-planning.service';
import { ExamSimulatorService } from './exam-simulator.service';
import { TutorService } from './tutor.service';
import { SupervisorAgentService } from './supervisor.service';
import { ExamQuestionRepository } from './exam-question.repository';
import { LearningMemoryService } from './learning-memory.service';
import { createAgentLlmFromEnv } from './agent-llm';
import type { AgentLlm } from './study-agent.service';

@Module({
  imports: [PrismaModule, AuthModule, QuestionsModule, ScoreCenterModule, RagModule],
  controllers: [AgentController],
  providers: [
    // Read-model chain for getStudentContext / getWrongQuestions tools
    MasterySummaryProjectionService,
    StudentStateProjectionService,
    PracticeProjectionService,
    WrongQuestionProjectionService,
    TodayPlanProjectionService,
    AssessmentProjectionService,
    StudentContextQueryService,
    WrongQuestionQueryService,
    // Agent layer
    LearningMemoryService,
    {
      provide: StudyAgentToolRegistry,
      useFactory: (
        studentContext: StudentContextQueryService,
        knowledgeSearch: KnowledgeSearchService,
        questions: QuestionsService,
        wrongQuestions: WrongQuestionQueryService,
        recommendation: RecommendationService,
      ) => new StudyAgentToolRegistry({ studentContext, knowledgeSearch, questions, wrongQuestions, recommendation }),
      inject: [StudentContextQueryService, KnowledgeSearchService, QuestionsService, WrongQuestionQueryService, RecommendationService],
    },
    {
      provide: 'AGENT_LLM',
      useFactory: (): AgentLlm | null => createAgentLlmFromEnv(),
    },
    {
      provide: StudyAgentService,
      useFactory: (tools: StudyAgentToolRegistry, llm: AgentLlm | null, memory: LearningMemoryService, metrics: AiMetricsService) =>
        new StudyAgentService(tools, llm ?? undefined, memory, metrics),
      inject: [StudyAgentToolRegistry, 'AGENT_LLM', LearningMemoryService, AiMetricsService],
    },
    StudyPlannerService,
    DailyPlanningService,
    ExamSimulatorService,
    ExamQuestionRepository,
    TutorService,
    SupervisorAgentService,
  ],
  exports: [StudyAgentService, StudyPlannerService, DailyPlanningService, ExamSimulatorService, SupervisorAgentService],
})
export class AgentModule {}