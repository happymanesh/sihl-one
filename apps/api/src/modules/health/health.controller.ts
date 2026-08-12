import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Liveness and readiness are separate on purpose.
 *
 * Kubernetes restarts a pod that fails liveness and merely stops routing to one
 * that fails readiness. If liveness also checked the database, a brief database
 * blip would restart every pod simultaneously — turning a recoverable incident
 * into an outage.
 */
@ApiTags('Health')
// Version-neutral, so the probes live at exactly `/health/live` and
// `/health/ready`. `setGlobalPrefix({ exclude })` strips the `/api` prefix but
// URI versioning still injects `/v1`, which silently moves the endpoints to
// `/v1/health/live` — a probe configured against `/health/live` then fails and
// the orchestrator restarts a perfectly healthy pod.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness — is the process running? No dependencies checked.' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — can this instance serve traffic?' })
  async ready() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        checks: { database: { status: 'up', latencyMs: Date.now() - started } },
      };
    } catch (error) {
      return {
        status: 'error',
        checks: {
          database: {
            status: 'down',
            // The message is safe to expose here: /health/ready is not routed
            // publicly in any environment, and without it a failing readiness
            // probe tells an operator nothing.
            error: error instanceof Error ? error.message : 'unknown',
          },
        },
      };
    }
  }
}
