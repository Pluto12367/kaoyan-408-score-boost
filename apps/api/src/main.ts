import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { OperationLogService } from './operations/operation-log.service';

interface AuthenticatedRequest extends IncomingMessage {
  user?: { id: string; role: string };
}

function validatePublicEnvironment() {
  const errors: string[] = [];
  const required = ['DATABASE_URL', 'JWT_SECRET', 'WEB_ORIGIN'];
  const placeholders = /replace-me|replace-with|example\.com|user:password|your-/i;
  for (const key of required) {
    const value = process.env[key] ?? '';
    if (!value) errors.push(`${key} is required`);
    if (placeholders.test(value)) errors.push(`${key} contains a placeholder value`);
  }
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (process.env.ALLOW_DEMO_AUTH !== 'false') errors.push('ALLOW_DEMO_AUTH must be false');
  const origins = (process.env.WEB_ORIGIN ?? '').split(',').filter(Boolean);
  if (origins.some((origin) => !origin.trim().startsWith('https://'))) errors.push('WEB_ORIGIN must use HTTPS');
  return errors;
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Production safety checks
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    const errors = validatePublicEnvironment();
    if (errors.length > 0) {
      logger.error(`Unsafe environment configuration: ${errors.join('; ')}`);
      process.exit(1);
    }
    logger.log('Production safety checks passed');
  }

  const app = await NestFactory.create(AppModule);
  const operationLogService = app.get(OperationLogService);

  // CORS: allow configured origins in production, localhost in dev
  const originEnv = process.env.WEB_ORIGIN;
  app.enableCors({
    origin: originEnv?.split(',') ?? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ],
    credentials: true,
  });

  // Correlated request logs make failures traceable without recording request bodies.
  app.use((req: AuthenticatedRequest, res: ServerResponse, next: () => void) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id']?.toString() || randomUUID();
    res.setHeader('x-request-id', requestId);
    res.once('finish', () => {
      const ms = Date.now() - start;
      const path = (req.url ?? '/').split('?')[0];
      const message = `${requestId} ${req.method} ${path} ${res.statusCode} ${ms}ms`;
      if (res.statusCode >= 500) logger.error(message);
      else if (res.statusCode >= 400) logger.warn(message);
      else if (ms > 1000 || process.env.NODE_ENV !== 'production') logger.log(message);
      void operationLogService.record({
        requestId,
        userId: req.user?.id,
        role: req.user?.role,
        method: req.method ?? 'UNKNOWN',
        path,
        statusCode: res.statusCode,
        durationMs: ms,
      }).catch((error: unknown) => logger.warn(`Could not persist operation log ${requestId}: ${String(error)}`));
    });
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  logger.log(`Demo auth: ${process.env.ALLOW_DEMO_AUTH === 'true' ? 'enabled' : 'disabled'}`);
}

void bootstrap();
