import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * Operational visibility for the outbox.
 *
 * A queue nobody can see is a queue nobody notices has stopped. `pending` and
 * `oldestPendingAt` are the two numbers worth alerting on: a backlog that is
 * growing, or an event that has been waiting far longer than it should.
 */
@ApiTags('Outbox')
@ApiBearerAuth()
@Controller('outbox')
export class OutboxController {
  constructor(private readonly relay: OutboxRelayService) {}

  @Get('stats')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Relay health: pending, dead-lettered and throughput counters' })
  stats() {
    return this.relay.stats();
  }

  @Post('flush')
  @RequirePermissions('system:configure')
  @ApiOperation({
    summary: 'Run one relay pass immediately',
    description:
      'For incident response and tests — the relay polls on its own schedule. Safe to call ' +
      'concurrently: the pass is guarded against re-entry and claims rows with SKIP LOCKED.',
  })
  async flush() {
    const processed = await this.relay.tick();
    return { processed };
  }
}
