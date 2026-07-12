import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Production safety checks
  if (process.env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL', 'JWT_SECRET'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      logger.error(`Missing required environment variables: ${missing.join(', ')}`);
      process.exit(1);
    }
    if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
      logger.error('JWT_SECRET must be at least 32 characters in production');
      process.exit(1);
    }
    logger.log('Production safety checks passed');
  }

  const app = await NestFactory.create(AppModule);

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

  // Request logging middleware
  app.use((req: { method: string; url: string }, _res: unknown, next: () => void) => {
    const start = Date.now();
    next();
    const ms = Date.now() - start;
    if (ms > 1000 || process.env.NODE_ENV !== 'production') {
      logger.log(`${req.method} ${req.url} ${ms}ms`);
    }
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  logger.log(`Demo auth: ${process.env.ALLOW_DEMO_AUTH === 'true' ? 'enabled' : 'disabled'}`);
}

void bootstrap();
