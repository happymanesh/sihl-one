import { Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createVisitExpenseSchema,
  type CreateVisitExpenseInput,  cancelVisitSchema,
  checkInSchema,
  checkOutSchema,
  planVisitSchema,
  visitQuerySchema,
  type CancelVisitInput,
  type CheckInInput,
  type CheckOutInput,
  type PlanVisitInput,
  type VisitQuery,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { VisitsService } from './visits.service';

@ApiTags('Visits')
@ApiBearerAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @RequirePermissions('visit:read')
  @ApiOperation({
    summary: 'List visits',
    description:
      'Scoped more tightly than leads: even a branch-scoped user sees their own team’s visits ' +
      'rather than the whole branch’s, because a visit records where a named person was.',
  })
  @ApiZodQuery(visitQuerySchema)
  list(@CurrentUser() user: AuthenticatedPrincipal, @ZodQuery(visitQuerySchema) query: VisitQuery) {
    return this.visits.list(user, query);
  }

  @Get('today')
  @RequirePermissions('visit:read')
  @ApiOperation({
    summary: 'Today’s plan for the signed-in user',
    description: 'Returns any visit currently open, so the app can resume it directly.',
  })
  today(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.visits.today(user);
  }

  @Get(':id')
  @RequirePermissions('visit:read')
  @ApiParam({ name: 'id', description: 'Visit id' })
  @ApiOperation({ summary: 'Visit detail with location evidence and integrity assessment' })
  findOne(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.visits.findOne(user, id);
  }

  @Get(':id/photo')
  @RequirePermissions('visit:read')
  @ApiOperation({ summary: 'Check-in photo, using the signed token from the visit detail' })
  async photo(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @Query('token') token: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.visits.photo(user, id, token ?? '');
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Private and short-lived: this is a photograph of an employee.
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.send(image.body);
  }

  @Post()
  @RequirePermissions('visit:create')
  @ApiOperation({ summary: 'Plan a visit to a lead or customer' })
  @ApiZodBody(planVisitSchema)
  plan(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(planVisitSchema) body: PlanVisitInput,
  ) {
    return this.visits.plan(user, body);
  }

  @Post(':id/check-in')
  @RequirePermissions('visit:update')
  @ApiOperation({
    summary: 'Check in to a visit',
    description:
      'Records one location event with its accuracy and a photograph. There is no endpoint ' +
      'that records a position between check-in and check-out — see ADR-0007.',
  })
  @ApiZodBody(checkInSchema)
  checkIn(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(checkInSchema) body: CheckInInput,
  ) {
    return this.visits.checkIn(user, id, body);
  }

  @Post(':id/check-out')
  @RequirePermissions('visit:update')
  @ApiOperation({
    summary: 'Check out and complete a visit',
    description:
      'Computes duration, assesses the location evidence, and writes the meeting on to the ' +
      'lead or customer timeline.',
  })
  @ApiZodBody(checkOutSchema)
  checkOut(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(checkOutSchema) body: CheckOutInput,
  ) {
    return this.visits.checkOut(user, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('visit:update')
  @ApiOperation({ summary: 'Cancel a planned visit' })
  @ApiZodBody(cancelVisitSchema)
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(cancelVisitSchema) body: CancelVisitInput,
  ) {
    return this.visits.cancel(user, id, body);
  }

  // -------------------------------------------------------------------------
  // Expenses — claims, not payables
  // -------------------------------------------------------------------------

  @Get(':id/expenses')
  @RequirePermissions('visit:read')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Expenses claimed for a visit' })
  listExpenses(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.visits.listExpenses(user, id);
  }

  @Post(':id/expenses')
  @RequirePermissions('visit:update')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Claim an expense against a visit',
    description:
      'Records what the rep says they spent, for finance to settle. Carries no ' +
      'approval or payment state — SIHL ONE is not a system of record for money.',
  })
  @ApiZodBody(createVisitExpenseSchema)
  addExpense(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(createVisitExpenseSchema) body: CreateVisitExpenseInput,
  ) {
    return this.visits.addExpense(user, id, body);
  }

}
