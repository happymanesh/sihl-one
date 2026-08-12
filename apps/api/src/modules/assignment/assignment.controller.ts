import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAssignmentRuleSchema,
  updateAssignmentRuleSchema,
  type CreateAssignmentRuleInput,
  type UpdateAssignmentRuleInput,
} from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody } from '../../common/zod';
import { AssignmentService } from './assignment.service';

const previewSchema = z.object({
  source: z.string().max(40),
  productInterest: z.array(z.string().max(40)).max(12).default([]),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  score: z.number().int().min(0).max(100).optional(),
});

@ApiTags('Assignment rules')
@ApiBearerAuth()
@Controller('assignment-rules')
export class AssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  @Get()
  @RequirePermissions('lead:assign')
  @ApiOperation({
    summary: 'List routing rules in evaluation order',
    description: 'Lowest priority runs first; the first matching rule wins.',
  })
  list() {
    return this.assignment.listRules();
  }

  @Post('preview')
  @RequirePermissions('lead:assign')
  @ApiOperation({
    summary: 'Dry run — which rule would fire for a hypothetical lead, and who would get it',
    description: 'Does not advance the round-robin cursor. Safe to call repeatedly.',
  })
  @ApiZodBody(previewSchema)
  preview(@ZodBody(previewSchema) body: z.infer<typeof previewSchema>) {
    return this.assignment.previewOwner(body);
  }

  @Post()
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Create a routing rule' })
  @ApiZodBody(createAssignmentRuleSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createAssignmentRuleSchema) body: CreateAssignmentRuleInput,
  ) {
    return this.assignment.createRule(user, body);
  }

  @Patch(':id')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Update a routing rule' })
  @ApiZodBody(updateAssignmentRuleSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateAssignmentRuleSchema) body: UpdateAssignmentRuleInput,
  ) {
    return this.assignment.updateRule(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Delete a routing rule' })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.assignment.deleteRule(user, id);
  }
}
