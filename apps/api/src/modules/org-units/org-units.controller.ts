import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createOrgUnitSchema,
  moveOrgUnitSchema,
  updateOrgUnitSchema,
  type CreateOrgUnitInput,
  type MoveOrgUnitInput,
  type UpdateOrgUnitInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody } from '../../common/zod';
import { OrgUnitsService } from './org-units.service';

/**
 * Reads need `user:read` — the user form has to offer somewhere to put people.
 * Writes are `system:configure`, which only SUPER_ADMIN holds: this tree decides
 * who can see whose customers.
 */
@ApiTags('Org units')
@ApiBearerAuth()
@Controller('org-units')
export class OrgUnitsController {
  constructor(private readonly orgUnits: OrgUnitsService) {}

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'The whole tree, in parent-then-children order' })
  tree() {
    return this.orgUnits.tree();
  }

  @Post()
  @RequirePermissions('system:configure')
  @ApiOperation({
    summary: 'Open a branch, region or zone',
    description: 'Placement is checked: a zone cannot sit under a branch.',
  })
  @ApiZodBody(createOrgUnitSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createOrgUnitSchema) body: CreateOrgUnitInput,
  ) {
    return this.orgUnits.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Rename a unit, or switch it off',
    description: 'Does not re-parent — moving is a separate, audited action.',
  })
  @ApiZodBody(updateOrgUnitSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateOrgUnitSchema) body: UpdateOrgUnitInput,
  ) {
    return this.orgUnits.update(user, id, body);
  }

  @Patch(':id/move')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Move a unit to a different parent',
    description:
      'Rewrites the whole subtree and changes who can see whose records, which is why the ' +
      'reason is mandatory and recorded.',
  })
  @ApiZodBody(moveOrgUnitSchema)
  move(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(moveOrgUnitSchema) body: MoveOrgUnitInput,
  ) {
    return this.orgUnits.move(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Remove an empty unit created by mistake' })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.orgUnits.remove(user, id);
  }
}
