import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  bookPresentationSchema,
  createPresentationSlotSchema,
  setPresentationBookingSchema,
  updatePresentationSlotSchema,
  type BookPresentationInput,
  type CreatePresentationSlotInput,
  type SetPresentationBookingInput,
  type UpdatePresentationSlotInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody } from '../../common/zod';
import { PresentationsService } from './presentations.service';

/** Same window and shape as the other public capture endpoints. */
const PUBLIC_WINDOW_MS = 60_000;
function publicLimit(variable: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[variable] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@ApiTags('Presentations')
@ApiBearerAuth()
@Controller('presentations')
export class PresentationsController {
  constructor(
    private readonly presentations: PresentationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public — the visitor, straight after verifying their number
  // ---------------------------------------------------------------------------

  /*
    Declared before the authenticated routes so `public` is never read as a
    slot id, and throttled like the rest of the capture path: a stall's worth
    of visitors share one address, so the limit is sized for a crowd.
  */
  @Public()
  @Get('public/:eventCode')
  @Throttle({ default: { limit: publicLimit('CAPTURE_RATE_LIMIT', 600), ttl: PUBLIC_WINDOW_MS } })
  @ApiParam({ name: 'eventCode', description: 'The code on the QR, not an id' })
  @ApiOperation({
    summary: 'Talks a visitor can still book',
    description:
      'Cancelled talks and anything that has already started are left out. Takes the event ' +
      'code rather than an id, because the code is what the QR carries.',
  })
  bookable(@Param('eventCode') eventCode: string) {
    return this.presentations.bookableByCode(eventCode);
  }

  @Public()
  @Post('public/book')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: publicLimit('CAPTURE_RATE_LIMIT', 600), ttl: PUBLIC_WINDOW_MS } })
  @ApiZodBody(bookPresentationSchema)
  @ApiOperation({
    summary: 'Hold seats at one or more talks',
    description:
      'Authorised by the booking token issued when the visitor’s number was confirmed, not by ' +
      'a session. Every slot is re-checked on arrival; anything no longer bookable is reported ' +
      'as skipped rather than quietly treated as booked.',
  })
  book(@ZodBody(bookPresentationSchema) body: BookPresentationInput) {
    return this.presentations.book(body);
  }

  // ---------------------------------------------------------------------------
  // The desk
  // ---------------------------------------------------------------------------

  @Get('events/:eventId/slots')
  @RequirePermissions('campaign:read')
  @ApiParam({ name: 'eventId' })
  @ApiOperation({
    summary: 'The whole schedule for an event, grouped by day',
    description: 'Includes cancelled and finished talks — this is the planning view.',
  })
  schedule(@Param('eventId', IdParamPipe) eventId: string) {
    return this.presentations.schedule(eventId);
  }

  @Patch('events/:eventId/booking')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'eventId' })
  @ApiZodBody(setPresentationBookingSchema)
  @ApiOperation({
    summary: 'Open or close seat booking for an event',
    description:
      'Closing it hides every talk from visitors at once. The talks and the seats already ' +
      'taken are untouched, so it is reversible.',
  })
  setBookingEnabled(
    @Param('eventId', IdParamPipe) eventId: string,
    @ZodBody(setPresentationBookingSchema) body: SetPresentationBookingInput,
  ) {
    return this.presentations.setBookingEnabled(eventId, body.enabled);
  }

  @Post('events/:eventId/slots')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'eventId' })
  @ApiZodBody(createPresentationSlotSchema)
  @ApiOperation({
    summary: 'Add a talk',
    description: 'The start time must fall inside the event’s own start and end.',
  })
  createSlot(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('eventId', IdParamPipe) eventId: string,
    @ZodBody(createPresentationSlotSchema) body: CreatePresentationSlotInput,
  ) {
    return this.presentations.createSlot(user.id, eventId, body);
  }

  @Patch('slots/:slotId')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'slotId' })
  @ApiZodBody(updatePresentationSlotSchema)
  @ApiOperation({
    summary: 'Edit a talk, or switch it off',
    description:
      'Switching off is how a talk is cancelled. The bookings are kept, so whoever has to ring ' +
      'those visitors still has the list.',
  })
  updateSlot(
    @Param('slotId', IdParamPipe) slotId: string,
    @ZodBody(updatePresentationSlotSchema) body: UpdatePresentationSlotInput,
  ) {
    return this.presentations.updateSlot(slotId, body);
  }

  @Get('slots/:slotId/attendees')
  @RequirePermissions('campaign:read')
  @ApiParam({ name: 'slotId' })
  @ApiOperation({
    summary: 'Who booked a talk',
    description: 'Mobile numbers are masked here, as they are on the lead list.',
  })
  attendees(@Param('slotId', IdParamPipe) slotId: string) {
    return this.presentations.attendees(slotId);
  }

  @Get('slots/:slotId/attendees/export')
  @RequirePermissions('lead:export')
  @ApiParam({ name: 'slotId' })
  @ApiOperation({
    summary: 'The same list as a CSV',
    description:
      'Separate permission from reading the list: a screenful and a file somebody walks out ' +
      'with are different acts, and this one is audited.',
  })
  async exportAttendees(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('slotId', IdParamPipe) slotId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { csv, rows } = await this.presentations.attendeesCsv(slotId);

    await this.audit.record({
      action: 'EXPORT',
      resource: 'event.slot.attendees',
      resourceId: slotId,
      changes: { rows },
    });
    void user;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(csv);
  }
}
