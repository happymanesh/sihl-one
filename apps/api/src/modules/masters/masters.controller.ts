import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createLeadSourceSchema,
  createProductSchema,
  createMeetingModeSchema,
  createTaskStatusSchema,
  masterQuerySchema,
  updateMeetingModeSchema,
  updateTaskStatusSchema,
  updateLeadSourceSchema,
  updateProductSchema,
  type CreateLeadSourceInput,
  type CreateProductInput,
  type CreateMeetingModeInput,
  type CreateTaskStatusInput,
  type MasterQuery,
  type UpdateMeetingModeInput,
  type UpdateTaskStatusInput,
  type UpdateLeadSourceInput,
  type UpdateProductInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { MastersService } from './masters.service';

/**
 * Reads are open to anyone who can see leads — the "Add lead" dropdowns need
 * them. Writes are `system:configure`, which only SUPER_ADMIN holds.
 */
@ApiTags('Masters')
@ApiBearerAuth()
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get('lead-sources')
  @RequirePermissions('lead:read')
  @ApiOperation({ summary: 'Lead sources, active ones by default' })
  @ApiZodQuery(masterQuerySchema)
  listSources(@ZodQuery(masterQuerySchema) query: MasterQuery) {
    return this.masters.listSources(query);
  }

  @Post('lead-sources')
  @RequirePermissions('system:configure')
  @ApiOperation({
    summary: 'Add a lead source',
    description: 'The scoring weight is required — a new channel has to be worth something stated.',
  })
  @ApiZodBody(createLeadSourceSchema)
  createSource(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createLeadSourceSchema) body: CreateLeadSourceInput,
  ) {
    return this.masters.createSource(user, body);
  }

  @Patch('lead-sources/:id')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Edit a lead source, or switch it off',
    description: 'The code is immutable — rules and history point at it.',
  })
  @ApiZodBody(updateLeadSourceSchema)
  updateSource(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateLeadSourceSchema) body: UpdateLeadSourceInput,
  ) {
    return this.masters.updateSource(user, id, body);
  }

  @Delete('lead-sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Remove an unused, non-system source' })
  deleteSource(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.masters.deleteSource(user, id);
  }

  @Get('products')
  @RequirePermissions('lead:read')
  @ApiOperation({ summary: 'Products, active ones by default' })
  @ApiZodQuery(masterQuerySchema)
  listProducts(@ZodQuery(masterQuerySchema) query: MasterQuery) {
    return this.masters.listProducts(query);
  }

  @Get('products/:code')
  @RequirePermissions('lead:read')
  @ApiParam({ name: 'code' })
  @ApiOperation({
    summary: 'One product, with everything a salesperson needs in front of a client',
  })
  findProduct(@Param('code') code: string) {
    return this.masters.findProduct(code.toUpperCase());
  }

  @Post('products')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Add a product' })
  @ApiZodBody(createProductSchema)
  createProduct(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createProductSchema) body: CreateProductInput,
  ) {
    return this.masters.createProduct(user, body);
  }

  @Patch('products/:id')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Edit a product, or switch it off' })
  @ApiZodBody(updateProductSchema)
  updateProduct(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateProductSchema) body: UpdateProductInput,
  ) {
    return this.masters.updateProduct(user, id, body);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Remove an unused, non-system product' })
  deleteProduct(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.masters.deleteProduct(user, id);
  }

  // -------------------------------------------------------------------------
  // Task statuses
  // -------------------------------------------------------------------------

  @Get('task-statuses')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: 'Task statuses, active ones by default' })
  @ApiZodQuery(masterQuerySchema)
  listTaskStatuses(@ZodQuery(masterQuerySchema) query: MasterQuery) {
    return this.masters.listTaskStatuses(query);
  }

  @Post('task-statuses')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Add a task status under an existing category' })
  @ApiZodBody(createTaskStatusSchema)
  createTaskStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createTaskStatusSchema) body: CreateTaskStatusInput,
  ) {
    return this.masters.createTaskStatus(user, body);
  }

  @Patch('task-statuses/:id')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Relabel a status, or switch it off' })
  @ApiZodBody(updateTaskStatusSchema)
  updateTaskStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateTaskStatusSchema) body: UpdateTaskStatusInput,
  ) {
    return this.masters.updateTaskStatus(user, id, body);
  }


  // -------------------------------------------------------------------------
  // Meeting modes
  // -------------------------------------------------------------------------

  @Get('meeting-modes')
  @RequirePermissions('activity:read')
  @ApiOperation({ summary: 'How an interaction can have happened' })
  @ApiZodQuery(masterQuerySchema)
  listMeetingModes(@ZodQuery(masterQuerySchema) query: MasterQuery) {
    return this.masters.listMeetingModes(query);
  }

  @Post('meeting-modes')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Add a meeting mode' })
  @ApiZodBody(createMeetingModeSchema)
  createMeetingMode(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createMeetingModeSchema) body: CreateMeetingModeInput,
  ) {
    return this.masters.createMeetingMode(user, body);
  }

  @Patch('meeting-modes/:id')
  @RequirePermissions('system:configure')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Edit a meeting mode, or switch it off' })
  @ApiZodBody(updateMeetingModeSchema)
  updateMeetingMode(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateMeetingModeSchema) body: UpdateMeetingModeInput,
  ) {
    return this.masters.updateMeetingMode(user, id, body);
  }

}
