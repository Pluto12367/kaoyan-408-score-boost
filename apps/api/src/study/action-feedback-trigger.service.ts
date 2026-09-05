import { Injectable, Logger } from '@nestjs/common';
import { ActionLearningSignalConsumerService } from './action-learning-signal-consumer.service';

/**
 * Starts the feedback projection only after an outcome transaction has
 * completed. The trigger deliberately owns no domain reads or writes; those
 * remain in ActionLearningSignalConsumerService and its collaborators.
 */
@Injectable()
export class ActionFeedbackTriggerService {
  private readonly logger = new Logger(ActionFeedbackTriggerService.name);

  constructor(private readonly consumer: ActionLearningSignalConsumerService) {}

  async trigger(userId: string, actionId: string | null | undefined): Promise<void> {
    if (!actionId) return;

    try {
      await this.consumer.consumeAction(userId, actionId);
    } catch (error) {
      this.logger.warn(
        `Action feedback trigger failed for ${userId}/${actionId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
