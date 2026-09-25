import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  assignLeadSchema,
  changeLeadProductStatusSchema,
  convertProductSchema,
  isClosedPeriod,
  CLOSED_PERIODS,
  DEFAULT_CLOSED_PERIOD,
  checkLeadMobileSchema,
  transferLeadSchema,
  bulkAssignLeadSchema,
  changeLeadStatusSchema,
  verifyLeadMobileSchema,
  convertLeadSchema,
  createLeadSchema,
  instaLeadSchema,
  leadCaptureSchema,
  resendOtpSchema,
  verifyOtpSchema,
  type ResendOtpInput,
  type VerifyOtpInput,
  leadQuerySchema,
  updateLeadSchema,
  type AssignLeadInput,
  type ChangeLeadProductStatusInput,
  type ConvertProductInput,
  type CheckLeadMobileInput,
  type TransferLeadInput,
  type BulkAssignLeadInput,
  type ChangeLeadStatusInput,
  type VerifyLeadMobileInput,
  type ConvertLeadInput,
  type CreateLeadInput,
  type InstaLeadInput,
  type LeadCaptureInput,
  type LeadQuery,
  type UpdateLeadInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { istDayKey } from '../../common/ist-day';
import { Audited, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { AllocationService } from '../performance/allocation.service';
import { LeadsService } from './leads.service';

/*
  Throttles for the three public capture endpoints.

  Read straight from the environment rather than through the config service,
  because a decorator is evaluated when the class is defined — before any
  injector exists. The trade is deliberate and narrow: these three numbers can
  be raised during a release freeze, on the evening before an exhibition, by
  setting a variable and restarting. That is the difference between a tunable
  limit and a limit that needs a deployment nobody is allowed to make.

  The defaults are sized for a crowd rather than a website. Registrations at a
  stall arrive in bursts, and a hall's wifi puts every visitor behind one
  address, so the whole floor can share a single bucket however carefully the
  caller is identified. These numbers are meant to shape load and stop a runaway
  script; what actually protects the SMS spend is the per-number cap inside
  OtpService, and what protects the data is the duplicate check.
*/
function captureLimit(variable: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[variable] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CAPTURE_WINDOW_MS = 60_000;
const CAPTURE_LIMITS = {
  /** A registration. The expensive part is one SMS, capped again per number. */
  capture: captureLimit('CAPTURE_RATE_LIMIT', 600),
  /** Checking a code costs nothing and people mistype under pressure. */
  verify: captureLimit('CAPTURE_VERIFY_RATE_LIMIT', 600),
  /** A resend rings a phone and spends money, so it stays the tightest. */
  resend: captureLimit('CAPTURE_RESEND_RATE_LIMIT', 60),
} as const;

@ApiTags('Leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly allocation: AllocationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public capture endpoint for marketing landing pages and the website.
   *
   * Unauthenticated by design, so it carries its own protections: a rate limit
   * sized for a crowd, mandatory consent in the payload, and no response detail that could
   * be used to probe whether a number is already known to SIHL (`duplicate` is
   * returned, but the reference of an existing lead is not).
   */
  /*
    Verifying a code, and asking for another.

    Both public, because the person doing it has no account — they are standing
    at a stall with a phone. Verifying is as generously limited as capturing,
    since every registration is followed by one and people mistype under
    pressure. Resending stays tighter: it rings a phone and spends money, and
    the per-number cap inside OtpService is the line that actually holds.

    Neither takes a mobile number. The verification id handed back at capture is
    unguessable and scoped to that submission, so these endpoints cannot be used
    to ask questions about somebody else's number.
  */
  @Public()
  @Post('capture/verify-mobile')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: CAPTURE_LIMITS.verify, ttl: CAPTURE_WINDOW_MS } })
  @ApiZodBody(verifyOtpSchema)
  @ApiOperation({
    summary: 'Verify a mobile number with the code sent at registration',
    description:
      'Marks the lead created at capture as mobile-verified. Failure never says which check ' +
      'failed, only what the person should do next.',
  })
  verifyCaptureMobile(@ZodBody(verifyOtpSchema) body: VerifyOtpInput) {
    return this.leads.verifyCaptureMobile(body);
  }

  @Public()
  @Post('capture/resend-code')
  @HttpCode(HttpStatus.OK)
  // Tighter than verify. A resend costs money and rings somebody's phone; the
  // per-number cap inside the service is the second line behind this one.
  @Throttle({ default: { limit: CAPTURE_LIMITS.resend, ttl: CAPTURE_WINDOW_MS } })
  @ApiZodBody(resendOtpSchema)
  @ApiOperation({ summary: 'Send the verification code again' })
  resendCaptureCode(@ZodBody(resendOtpSchema) body: ResendOtpInput) {
    return this.leads.resendCaptureCode(body);
  }

  @Public()
  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: CAPTURE_LIMITS.capture, ttl: CAPTURE_WINDOW_MS } })
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
  pipeline(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(leadQuerySchema) query: LeadQuery,
  ) {
    return this.leads.pipeline(user, query);
  }

  @Get('pipeline/products')
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'Board counts with one card per lead-product',
    description:
      'A lead interested in three products counts three times, each at its own stage. Leads ' +
      'with no products yet count once, under their own status.',
  })
  @ApiZodQuery(leadQuerySchema)
  productPipeline(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(leadQuerySchema) query: LeadQuery,
  ) {
    return this.leads.productPipeline(user, query);
  }

  @Get('pipeline/products/column')
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'One column of the per-product board',
    description:
      'Returns lead-products rather than leads, so a client interested in three products ' +
      'appears in whichever three columns those products have reached.',
  })
  @ApiQuery({ name: 'status', required: true })
  @ApiZodQuery(leadQuerySchema)
  productBoardColumn(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('status') status: string,
    @ZodQuery(leadQuerySchema) query: LeadQuery,
  ) {
    return this.leads.productBoardColumn(user, status, query);
  }

  @Get('pipeline/closed')
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'Products closed inside a window, for the Closed column',
    description:
      'Converted, lost and disqualified together, newest first, with a count of each. ' +
      'Windowed because closed work is unbounded.',
  })
  @ApiQuery({ name: 'period', required: false, enum: CLOSED_PERIODS })
  @ApiZodQuery(leadQuerySchema)
  closedColumn(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('period') period: string | undefined,
    @ZodQuery(leadQuerySchema) query: LeadQuery,
  ) {
    // An unrecognised period falls back to the default rather than erroring:
    // this backs a dropdown, and a bad value there is a bookmark, not an attack.
    return this.leads.closedColumn(
      user,
      isClosedPeriod(period) ? period : DEFAULT_CLOSED_PERIOD,
      query,
    );
  }

  // A GET so it can be called on every settled keystroke in the mobile field
  // without writing anything. Scoped inside the service, which decides how much
  // of the match the caller is allowed to be told.
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

  /**
   * The current view of the list, as a CSV.
   *
   * Takes the same query as the list itself, so what downloads is what the
   * person was looking at. Guarded on `lead:export` rather than `lead:read`:
   * reading a screenful and walking out with the book are different acts, and
   * the permission matrix already separates them.
   *
   * Audited as an EXPORT. A copy of the client book leaving the system is
   * precisely the event a compliance reader needs to find later, and the row
   * records the filters so "what did they take" has an answer.
   *
   * Declared before `:id`, or Nest reads "export" as a lead id.
   */
  @Get('export')
  @RequirePermissions('lead:export')
  @ApiOperation({ summary: 'Download the filtered lead list as CSV' })
  @ApiZodQuery(leadQuerySchema)
  async exportCsv(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(leadQuerySchema) query: LeadQuery,
    @Res() response: Response,
  ): Promise<void> {
    const { csv, rows } = await this.leads.exportCsv(user, query);

    await this.audit.record({
      action: 'EXPORT',
      resource: 'lead',
      reason: `Lead list exported as CSV - ${rows} rows`,
      changes: { rows, scope: user.dataScope, filters: query as never },
    });

    const stamp = istDayKey(new Date());
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="sihl-leads-${stamp}.csv"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Never cached: the contents depend on who asked, and a shared cache
    // serving one person's scoped book to another is a data-protection
    // incident.
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(csv);
  }

  /*
    Declared before `:id`, or Nest would read "owners" as a lead id.
  */
  @Get('owners')
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'Distinct owners of the leads this caller can see',
    description:
      'Backs the owner filter. Derived from the leads themselves rather than from the user ' +
      'directory, so the list can never offer a name that returns nothing.',
  })
  owners(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.leads.owners(user);
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
  @ApiResponse({
    status: 400,
    description: 'A lead already exists for this mobile number; the reply says when it was added.',
  })
  @ApiZodBody(createLeadSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createLeadSchema) body: CreateLeadInput,
  ) {
    return this.leads.create(user, body);
  }

  @Post('insta')
  @RequirePermissions('lead:create', 'visit:create')
  @ApiOperation({
    summary: 'Insta Lead — capture someone in person and start the meeting',
    description:
      'Two fields and a mode. Writes the lead first and commits it before the visit is ' +
      'touched, so a failed check-in never costs the client. A mobile that already has an ' +
      'open lead attaches to it rather than being refused.',
  })
  @ApiResponse({
    status: 201,
    description: 'Lead and visit created. `awaitingCheckIn` says whether a photo is still needed.',
  })
  @ApiZodBody(instaLeadSchema)
  instaLead(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(instaLeadSchema) body: InstaLeadInput,
  ) {
    return this.leads.instaLead(user, body);
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

  @Get(':id/products')
  @RequirePermissions('lead:read')
  @ApiOperation({ summary: "A lead's products and where each one stands" })
  products(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.leads.productsFor(user, id);
  }

  @Post(':id/products/convert')
  @RequirePermissions('lead:convert')
  @ApiOperation({
    summary: 'Record one product as converted, against a PAN or a client code',
    description:
      'The lenient path, for when the account already exists in the back office and the rep ' +
      'has the client code. The dedicated convert endpoint still requires a PAN and email.',
  })
  @ApiZodBody(convertProductSchema)
  convertProduct(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(convertProductSchema) body: ConvertProductInput,
  ) {
    return this.leads.convertProduct(user, id, body);
  }

  @Post(':id/products/status')
  @RequirePermissions('lead:update')
  @ApiOperation({
    summary: 'Record the outcome of one product on a lead',
    description:
      "The lead's own status is rolled up from its products afterwards, so a rep marking one " +
      'product lost does not have to work out what that means for the lead.',
  })
  @ApiZodBody(changeLeadProductStatusSchema)
  changeProductStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(changeLeadProductStatusSchema) body: ChangeLeadProductStatusInput,
  ) {
    return this.leads.changeProductStatus(user, id, body);
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
    summary: 'Hand out many unowned leads at once',
    description:
      'Only leads that nobody currently owns are moved. Ids that are already owned, are ' +
      'converted, or fall outside the caller’s data scope are skipped and reported in the ' +
      'response. To move a lead away from its current owner, use transfer, which requires a ' +
      'reason.',
  })
  @ApiZodBody(bulkAssignLeadSchema)
  bulkAssign(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(bulkAssignLeadSchema) body: BulkAssignLeadInput,
  ) {
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
