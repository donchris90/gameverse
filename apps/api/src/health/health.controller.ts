import { Controller, Get, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

const READINESS_TIMEOUT_MS = 2_000;

/** Probe endpoints for load balancers / orchestrators. Not rate limited, not versioned. */
@Controller('health')
@SkipThrottle({ default: true, auth: true, login: true })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up and the event loop is responsive. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies needed to serve traffic are reachable. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('database check timed out')),
            READINESS_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Service is not ready',
        { checks: { database: 'down' } },
      );
    }
  }
}
