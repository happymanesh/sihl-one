import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  campaignQuerySchema,
  changeCampaignStatusSchema,
  createCampaignSchema,
  updateCampaignSchema,
  type CampaignQuery,
  type ChangeCampaignStatusInput,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { CampaignsService } from './campaigns.service';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermissions('campaign:read')
  @ApiOperation({ summary: 'List campaigns with attributed lead counts' })
  @ApiZodQuery(campaignQuerySchema)
  list(@ZodQuery(campaignQuerySchema) query: CampaignQuery) {
    return this.campaigns.list(query);
  }

  @Get(':id')
  @RequirePermissions('campaign:read')
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({
    summary: 'Campaign detail with attribution, pipeline and return on spend',
    description:
      'Attributed value is estimated from CRM lead values, never settled brokerage. ' +
      'Cost metrics are null rather than zero when no spend has been recorded.',
  })
  findOne(@Param('id', IdParamPipe) id: string) {
    return this.campaigns.findOne(id);
  }

  @Post()
  @RequirePermissions('campaign:create')
  @ApiOperation({
    summary: 'Create a campaign',
    description: 'The code is permanent — it is embedded in published tracking links.',
  })
  @ApiZodBody(createCampaignSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createCampaignSchema) body: CreateCampaignInput,
  ) {
    return this.campaigns.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Update a campaign' })
  @ApiZodBody(updateCampaignSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateCampaignSchema) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(user, id, body);
  }

  @Patch(':id/status')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({
    summary: 'Move a campaign through its lifecycle',
    description: 'A completed campaign cannot be reopened — its spend has already been reported.',
  })
  @ApiZodBody(changeCampaignStatusSchema)
  changeStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(changeCampaignStatusSchema) body: ChangeCampaignStatusInput,
  ) {
    return this.campaigns.changeStatus(user, id, body.status);
  }
}
