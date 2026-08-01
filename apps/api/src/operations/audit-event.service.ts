import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

export type AuditAction =
  | 'invitation.create'
  | 'invitation.disable'
  | 'invitation.redeem'
  | 'account.disable'
  | 'account.restore'
  | 'account.temporary_password'
  | 'account.create_managed'
  | 'question_import.preview'
  | 'question_import.confirm'
  | 'question_import.disable'
  | 'question_import.upload'
  | 'question_import.reject'
  | 'question_import.cancel'
  | 'question_import.retry';

export interface AuditEventInput {
  actorId?: string;
  action: AuditAction;
  targetType: 'invitation' | 'user' | 'question_import';
  targetId?: string;
  result: 'success' | 'rejected' | 'failed';
  metadata?: Record<string, string | number | boolean>;
}

@Injectable()
export class AuditEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditEventInput, tx?: Prisma.TransactionClient) {
    const metadata = input.metadata && Object.fromEntries(Object.entries(input.metadata)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)));
    await (tx ?? this.prisma).auditEvent.create({ data: { ...input, metadata } });
  }
}
