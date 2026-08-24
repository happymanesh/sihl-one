import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  assignLeadSchema,
  checkLeadMobileSchema,
  transferLeadSchema,
  bulkAssignLeadSchema,
  changeLeadStatusSchema,
  verifyLeadMobileSchema,
  convertLeadSchema,
  createLeadSchema,
  leadCaptureSchema,
  leadQuerySchema,
  updateLeadSchema,
  type AssignLeadInput,
  type CheckLeadMobileInput,
  type TransferLeadInput,
  type BulkAssignLeadInput,
  type ChangeLeadStatusInput,
  type VerifyLeadMobileInput,
  type ConvertLeadInput,
  type CreateLeadInput,
  type LeadCaptureInput,
  type LeadQuery,
  type UpdateLeadInput,
} from '@sihl-one/contracts';

import { Audited, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { AllocationService } from '../performance/allocation.service';
import { LeadsService } from './leads.service';

@ApiTags('Leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly allocation: AllocationService,
  ) {}

  /**
   * Public capture endpoint for marketing landing pages and the website.
   *
   * Unauthenticated by design, so it carries its own protections: a tight rate
   * limit, mandatory consent in the payload, and no response detail that could
   * be used to probe whether a number is already known to SIHL (`duplicate` is
   * returned, but the reference of an existing lead is not).
   */
  @Public()
  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Public lead capture',
    description:
      'Accepts an enquiry from a website or landing page. A repeat enquiry from a number ' +
      'already in the pipeline is logged against the existing lead rather than creating a ' +
      'duplicate.',
  })
  @ApiResponse({ status: 201, description: 'Enquiry accepted.' })
  @ApiZodBody(leadCaptureSchema)
  capture(@ZodBody(leadCaptureSchema) body: LeadCaptureInput) {
    return this.leads.capture(body);
  }

  @Get()
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'List leads',
    description:
      'Results are always filtered to the caller’s data scope. Contact details are masked ' +
      'in list responses; fetch a single lead to see them in full.',
  })
  @ApiZodQuery(leadQuerySchema)
  list(@CurrentUser() user: AuthenticatedPrincipal, @ZodQuery(leadQuerySchema) query: LeadQuery) {
    return this.leads.list(user, query);
  }

  @Get('pipeline')
  @RequirePermissions('lead:read')
  @ApiOperation({ summary: 'Lead counts and value by status, for the kanban board' })
  @ApiZodQuery(leadQuerySchema)
  pipeline(@CurrentUser() user: AuthenticatedPrincipal, @ZodQuery(leadQuerySchema) query: LeadQuery) {
    return this.leads.pipeline(user, query);
  }

  // A GET so it can be called on every keystroke-settled change of the mobile
  // field without writing anything. Scoped inside the service, which decides
  // how much of the match the caller is allowed to be told.
  @Get('check-mobile')
  @RequirePermissions('lead:create')
  @ApiOperation({ summary: 'Ask whether a mobile number is already on the book' })
  @ApiZodQuery(checkLeadMobileSchema)
  checkMobile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(checkLeadMobileSchema) query: CheckLeadMobileInput,
  ) {
    return this.leads.checkMobile(user, query);
  }

  @Get(':id')
  @RequirePermissions('lead:read')
  @ApiParam({ name: 'id', description: 'Lead id' })
  @ApiOperation({
    summary: 'Lead detail with timeline, score breakdown and next best actions',
    description: 'Returns unmasked contact details. The read is written to the audit trail.',
  })
  findOne(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.leads.findOne(user, id);
  }

  @Get(':id/owner-suggestions')
  @RequirePermissions('lead:assign')
  @ApiParam({ name: 'id', description: 'Lead id' })
  @ApiOperation({
    summary: 'Who this lead should be offered to, and why',
    description:
      'Ranked suggestions with reasons, plus everyone who was passed over and why. ' +
      'Purely advisory — it assigns nothing. A share of high-value leads is ' +
      'deliberately steered to people still building a record.',
  })
  ownerSuggestions(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ) {
    return this.allocation.recommendForLead(user, id);
  }

  @Post()
  @RequirePermissions('lead:create')
  @Audited({ action: 'CREATE', resource: 'lead' })
  @ApiOperation({ summary: 'Create a lead' })
  @ApiResponse({ status: 400, description: 'An open lead already exists for this mobile number.' })
  @ApiZodBody(createLeadSchema)
  create(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(createLeadSchema) body: CreateLeadInput) {
    return this.leads.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('lead:update')
  @ApiOperation({ summary: 'Update lead details (not status)' })
  @ApiZodBody(updateLeadSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateLeadSchema) body: UpdateLeadInput,
  ) {
    return this.leads.update(user, id, body);
  }

  @Post(':id/verify-mobile')
  @RequirePermissions('lead:update')
  @ApiOperation({
    summary: 'Record that the mobile number reaches this person',
    description:
      'Only the lead owner may do this: it records that they made contact themselves. The ' +
      'verification is cleared automatically if the number is later edited.',
  })
  @ApiZodBody(verifyLeadMobileSchema)
  verifyMobile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(verifyLeadMobileSchema) body: VerifyLeadMobileInput,
  ) {
    return this.leads.verifyMobile(user, id, body);
  }

  @Delete(':id/verify-mobile')
  @RequirePermissions('lead:update')
  @ApiOperation({
    summary: 'Withdraw a mobile verification',
    description: 'For a mistake. Audited, like recording one.',
  })
  unverifyMobile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ) {
    return this.leads.unverifyMobile(user, id);
  }

  @Post(':id/status')
  @RequirePermissions('lead:update')
  @ApiOperation({
    summary: 'Move a lead to a new status',
    description:
      'Validated against the transition table shared with the web app. Marking a lead LOST ' +
      'requires a reason.',
  })
  @ApiZodBody(changeLeadStatusSchema)
  changeStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(changeLeadStatusSchema) body: ChangeLeadStatusInput,
  ) {
    return this.leads.changeStatus(user, id, body);
  }

  @Post(':id/transfer')
  @RequirePermissions('lead:assign')
  @ApiOperation({
    summary: 'Transfer a lead to someone outside your own team',
    description:
      'Unlike assign, the new owner may be any active user and the reason is mandatory. ' +
      'Refused for callers who can only see their own leads.',
  })
  @ApiZodBody(transferLeadSchema)
  transfer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(transferLeadSchema) body: TransferLeadInput,
  ) {
    return this.leads.transfer(user, id, body);
  }


  @Post(':id/assign')
  @RequirePermissions('lead:assign')
  @ApiOperation({ summary: 'Assign a lead to a relationship manager' })
  @ApiZodBody(assignLeadSchema)
  assign(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(assignLeadSchema) body: AssignLeadInput,
  ) {
    return this.leads.assign(user, id, body);
  }

  @Post('bulk-assign')
  @RequirePermissions('lead:assign')
  @ApiOperation({
    summary: 'Assign many leads at once',
    description: 'Ids outside the caller’s data scope are skipped and reported in the response.',
  })
  @ApiZodBody(bulkAssignLeadSchema)
  bulkAssign(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(bulkAssignLeadSchema) body: BulkAssignLeadInput) {
    return this.leads.bulkAssign(user, body);
  }

  @Post(':id/convert')
  @RequirePermissions('lead:convert')
  @ApiOperation({
    summary: 'Convert a qualified lead into a customer',
    description:
      'Creates the customer record and emits `lead.converted` for the onboarding/eKYC ' +
      'integration. SIHL ONE does not open the account itself.',
  })
  @ApiZodBody(convertLeadSchema)
  convert(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(convertLeadSchema) body: ConvertLeadInput,
  ) {
    return this.leads.convert(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('lead:delete')
  @ApiOperation({ summary: 'Soft-delete a lead' })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.leads.remove(user, id);
  }
}
