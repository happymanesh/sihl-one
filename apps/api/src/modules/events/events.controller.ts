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

  /*
    `event:view`, not `campaign:read`.

    A rep at a stall needs the event list and their own QR; they have no
    business in campaign spend and attribution. Every role that could reach
    these two routes before still holds `event:view` statically, so this takes
    nothing away — it only opens a door for the reps whose hierarchy level and
    branch have both been switched on.

    The management routes below keep `campaign:update`: seeing an event and
    running one are different things.
  */
  @Get()
  @ApiBearerAuth()
  @RequirePermissions('event:view')
  @ApiOperation({ summary: 'List events with captured lead counts' })
  @ApiZodQuery(eventQuerySchema)
  list(@CurrentUser() user: AuthenticatedPrincipal, @ZodQuery(eventQuerySchema) query: EventQuery) {
    return this.events.list(user, query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions('event:view')
  @ApiParam({ name: 'id', description: 'Event id' })
  @ApiOperation({ summary: 'Event detail with its QR capture URL and what the leads became' })
  findOne(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.events.findOne(user, id);
  }

  @Get(':id/by-rep')
  @ApiBearerAuth()
  @RequirePermissions('event:view')
  @ApiParam({ name: 'id', description: 'Event id' })
  @ApiOperation({ summary: 'Leads this event produced, broken down by the rep whose QR captured them' })
  byRep(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.events.byRep(user, id);
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
