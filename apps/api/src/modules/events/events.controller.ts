import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  changeEventStatusSchema,
  createEventSchema,
  eventQuerySchema,
  updateEventSchema,
  type ChangeEventStatusInput,
  type CreateEventInput,
  type EventQuery,
  type UpdateEventInput,
} from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery, ZodValidationPipe } from '../../common/zod';
import { CaptureCodeService } from './capture-code.service';
import { EventsService } from './events.service';

const codeParamSchema = z.string().trim().min(3).max(60);

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly captureCodes: CaptureCodeService,
  ) {}

  /**
   * What a public capture page needs to render itself.
   *
   * Unauthenticated by design — the person scanning the QR has no account — so
   * it carries its own protections: a rate limit, and a response that names the
   * partner or event but exposes nothing else about either.
   */
  @Public()
  @Get('capture-context/:kind/:code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiParam({ name: 'kind', enum: ['p', 'e'] })
  @ApiParam({ name: 'code', description: 'Referral or event code' })
  @ApiOperation({ summary: 'Resolve a capture code for the public join page' })
  captureContext(
    @Param('kind') kind: string,
    @Param('code', new ZodValidationPipe(codeParamSchema)) code: string,
  ) {
    return this.captureCodes.context(kind === 'p' ? 'PARTNER' : 'EVENT', code);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions('campaign:read')
  @ApiOperation({ summary: 'List events with captured lead counts' })
  @ApiZodQuery(eventQuerySchema)
  list(@ZodQuery(eventQuerySchema) query: EventQuery) {
    return this.events.list(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions('campaign:read')
  @ApiParam({ name: 'id', description: 'Event id' })
  @ApiOperation({ summary: 'Event detail with its QR capture URL and what the leads became' })
  findOne(@Param('id', IdParamPipe) id: string) {
    return this.events.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @RequirePermissions('campaign:create')
  @ApiOperation({
    summary: 'Create an event',
    description: 'The code is permanent — it goes under the QR that gets printed.',
  })
  @ApiZodBody(createEventSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createEventSchema) body: CreateEventInput,
  ) {
    return this.events.create(user, body);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'id', description: 'Event id' })
  @ApiOperation({ summary: 'Update an event' })
  @ApiZodBody(updateEventSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateEventSchema) body: UpdateEventInput,
  ) {
    return this.events.update(user, id, body);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'id', description: 'Event id' })
  @ApiOperation({
    summary: 'Open or close an event for captures',
    description: 'Only a running event accepts scans. A printed QR outlives the event.',
  })
  @ApiZodBody(changeEventStatusSchema)
  changeStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(changeEventStatusSchema) body: ChangeEventStatusInput,
  ) {
    return this.events.changeStatus(user, id, body);
  }
}
