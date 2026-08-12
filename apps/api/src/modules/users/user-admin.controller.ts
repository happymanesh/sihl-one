import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createDesignationSchema,
  createUserSchema,
  updateDesignationSchema,
  updateUserSchema,
  type CreateDesignationInput,
  type CreateUserInput,
  type UpdateDesignationInput,
  type UpdateUserInput,
  resetMfaSchema,
  type ResetMfaInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody } from '../../common/zod';
import { MfaService } from '../auth/mfa.service';
import { UserAdminService } from './user-admin.service';

@ApiTags('User administration')
@ApiBearerAuth()
@Controller('admin')
export class UserAdminController {
  constructor(
    private readonly admin: UserAdminService,
    private readonly mfa: MfaService,
  ) {}

  @Get('designations')
  @RequirePermissions('user:read')
  @ApiQuery({ name: 'includeInactive', required: false })
  @ApiOperation({
    summary: 'Sales hierarchy levels, most senior first',
    description:
      'Designations are data, not code: levels can be skipped (Regional and Zonal are ' +
      'optional) and new ones added without a deployment.',
  })
  designations(@Query('includeInactive') includeInactive?: string) {
    return this.admin.listDesignations(includeInactive === 'true');
  }

  @Post('designations')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Add a hierarchy level' })
  @ApiZodBody(createDesignationSchema)
  createDesignation(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @ZodBody(createDesignationSchema) body: CreateDesignationInput,
  ) {
    return this.admin.createDesignation(actor, body);
  }

  @Patch('designations/:id')
  @RequirePermissions('system:configure')
  @ApiOperation({ summary: 'Rename, re-level or deactivate a hierarchy level' })
  @ApiZodBody(updateDesignationSchema)
  updateDesignation(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateDesignationSchema) body: UpdateDesignationInput,
  ) {
    return this.admin.updateDesignation(actor, id, body);
  }

  @Get('users')
  @RequirePermissions('user:read')
  @ApiOperation({
    summary: 'Internal users with designation and reporting line',
    description: 'Scoped to the caller’s own org subtree unless they are an administrator.',
  })
  users(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.admin.listUsers(actor);
  }

  @Get('users/manager-options')
  @RequirePermissions('user:read')
  @ApiQuery({ name: 'designationId', required: true })
  @ApiOperation({
    summary: 'Who could manage someone at this level',
    description: 'Anyone strictly more senior — which is what makes skipped levels valid.',
  })
  managerOptions(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Query('designationId', IdParamPipe) designationId: string,
  ) {
    return this.admin.managerOptions(actor, designationId);
  }

  @Post('users')
  @RequirePermissions('user:create')
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Guarded against privilege escalation: the new user must sit below the creator’s ' +
      'designation, inside their org subtree, and carry no permission the creator lacks. ' +
      'Created as INVITED — no usable login is minted as a side effect.',
  })
  @ApiZodBody(createUserSchema)
  createUser(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @ZodBody(createUserSchema) body: CreateUserInput,
  ) {
    return this.admin.createUser(actor, body);
  }

  @Post('users/:id/credentials')
  @RequirePermissions('user:update')
  @ApiOperation({
    summary: 'Issue a one-time password so a new user can sign in',
    description:
      'Returned once in the response because there is no email delivery yet — the ' +
      'alternative is an account nobody can use. The user must change it at first ' +
      'sign-in, existing sessions are revoked, and the value is never written to a log.',
  })
  issueCredentials(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ) {
    return this.admin.issueCredentials(actor, id);
  }

  @Post('users/:id/mfa-reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:update')
  @ApiParam({ name: 'id', description: 'User id' })
  @ApiOperation({
    summary: 'Clear a user’s two-step verification',
    description:
      'For a lost phone with no recovery codes left, which is otherwise a permanent lockout. ' +
      'Revokes their sessions and cannot be used on your own account.',
  })
  @ApiZodBody(resetMfaSchema)
  resetMfa(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(resetMfaSchema) body: ResetMfaInput,
  ) {
    return this.mfa.adminReset(user, id, body.reason);
  }

  @Patch('users/:id')
  @RequirePermissions('user:update')
  @ApiOperation({
    summary: 'Update a user’s designation, roles, branch or reporting line',
    description:
      'The escalation guards run twice — against where the user is now, and against where ' +
      'the edit would put them — so an edit cannot promote someone past the editor.',
  })
  @ApiZodBody(updateUserSchema)
  updateUser(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateUserSchema) body: UpdateUserInput,
  ) {
    return this.admin.updateUser(actor, id, body);
  }
}
