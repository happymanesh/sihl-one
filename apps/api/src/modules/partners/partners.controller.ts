import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { partnerQuerySchema, type PartnerQuery } from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { PartnersService } from './partners.service';

const rotateSchema = z.object({
  reason: z.string().trim().min(5, 'Record why the code is being replaced').max(300),
});

@ApiTags('Partners')
@ApiBearerAuth()
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get('me')
  @RequirePermissions('analytics:partner:read')
  @ApiOperation({
    summary: 'The signed-in partner’s own 360 view',
    description:
      'Backs the partner portal. Earnings figures are estimates derived from CRM attribution, ' +
      'never settled brokerage.',
  })
  me(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.partners.me(user);
  }

  @Get()
  @RequirePermissions('partner:read')
  @ApiOperation({ summary: 'List partners' })
  @ApiZodQuery(partnerQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(partnerQuerySchema) query: PartnerQuery,
  ) {
    return this.partners.list(user, query);
  }

  @Get('me/referral-link')
  @RequirePermissions('analytics:partner:read')
  @ApiOperation({
    summary: 'The signed-in partner’s own onboarding link',
    description:
      'Issued on first request and stable thereafter. Anyone who opens an account through ' +
      'it is attributed to this partner, and that attribution is handed to the back office ' +
      'when the account is activated.',
  })
  referralLink(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.partners.referralLink(user);
  }

  @Get(':id/referral-link')
  @RequirePermissions('partner:read')
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiOperation({ summary: 'A partner’s onboarding link, for staff' })
  referralLinkFor(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ) {
    return this.partners.referralLink(user, id);
  }

  @Post(':id/referral-link/rotate')
  @RequirePermissions('partner:update')
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiOperation({
    summary: 'Issue a new code, invalidating every link already handed out',
    description: 'Breaks printed cards and QR codes in circulation, so the reason is recorded.',
  })
  @ApiZodBody(rotateSchema)
  rotate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(rotateSchema) body: z.infer<typeof rotateSchema>,
  ) {
    return this.partners.rotateReferralCode(user, id, body.reason);
  }

  @Get(':id')
  @RequirePermissions('partner:read')
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiOperation({ summary: 'Partner 360 — business, estimated earnings, activity, compliance' })
  find360(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.partners.find360(user, id);
  }
}
