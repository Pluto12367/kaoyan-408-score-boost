import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

const startTime = Date.now();

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth() {
    const checks: Record<string, string> = {};

    // Database check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch {
      checks.database = 'disconnected';
    }

    const allOk = Object.values(checks).every((v) => v === 'connected');

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

    return {
      status: 'ok',
      service: 'kaoyan-408-api',
      version: '1.0.0',
      uptimeSec: Math.round((Date.now() - startTime) / 1000),
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
