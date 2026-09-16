import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * Liveness probe used by Docker/Dokploy and by `scripts/deploy.sh`.
 *
 * It reports the two dependencies that decide whether the product works:
 * the database and the object storage data plane. Only the database makes the
 * endpoint fail: a broken storage endpoint cannot be fixed by restarting the
 * container, so it is reported in the payload (and in the logs at startup).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{
    status: string;
    db: string;
    storage: string;
    uptime: number;
    timestamp: string;
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }

    return {
      status: 'ok',
      db: 'up',
      storage: await this.storage.checkBucket(),
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
