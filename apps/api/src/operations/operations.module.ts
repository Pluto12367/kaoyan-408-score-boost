import { Global, Module } from '@nestjs/common';
import { AuditEventService } from './audit-event.service';
import { OperationLogService } from './operation-log.service';

@Global()
@Module({
  providers: [AuditEventService, OperationLogService],
  exports: [AuditEventService, OperationLogService],
})
export class OperationsModule {}
