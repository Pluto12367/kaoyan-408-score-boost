import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { buildOperationalHealth, validateStartupConfiguration } from './operations/startup-validation';

const startTime = Date.now();

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth() {
    const checks: Record<string, string> = {};

    if (!process.env.DATABASE_URL) {
      checks.database = 'disabled';
    } else {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        checks.database = 'connected';
      } catch {
        checks.database = 'disconnected';
      }
    }

    const allOk = Object.values(checks).every((value) => value === 'connected' || value === 'disabled');

    if (!allOk) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'kaoyan-408-api',
        version: '1.0.0',
        uptimeSec: Math.round((Date.now() - startTime) / 1000),
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    const startup = validateStartupConfiguration(process.env);
    const operational = buildOperationalHealth(
      checks.database === 'connected',
      Boolean(process.env.DATABASE_URL),
      startup.aiProvider === 'configured',
      false, // embedding: local deterministic is the default; remote needs EMBEDDING_API_KEY + provider
    );

    return {
      status: 'ok',
      operational,
      service: 'kaoyan-408-api',
      version: '1.0.0',
      dataSource: process.env.DATABASE_URL ? 'postgresql' : 'memory-api',
      uptimeSec: Math.round((Date.now() - startTime) / 1000),
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
