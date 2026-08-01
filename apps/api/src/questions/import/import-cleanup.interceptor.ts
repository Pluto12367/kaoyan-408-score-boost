import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, throwError } from 'rxjs';
import { ImportBatchService } from './import-batch.service';
import { ImportStorageService, type StoredImportFile, type UploadedImportFile } from './import-storage.service';

interface ImportRequest { user?: { id?: string }; file?: UploadedImportFile; questionImportStored?: StoredImportFile; }

@Injectable()
export class ImportCleanupInterceptor implements NestInterceptor {
  constructor(private readonly storage: ImportStorageService, private readonly batches: ImportBatchService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    return next.handle().pipe(catchError((error: unknown) => from(this.cleanup(request)).pipe(
      mergeMap(() => throwError(() => error)),
    )));
  }

  private async cleanup(request: ImportRequest) {
    await this.storage.cleanupIncoming(request.file);
    if (request.questionImportStored) await this.storage.removeTemporary(request.questionImportStored.storageKey);
    await this.batches.recordRejection(request.user?.id, request.file).catch(() => undefined);
  }
}
