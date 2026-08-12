import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { offboardUserSchema, type OffboardUserInput } from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { OffboardingService } from './offboarding.service';

const noticeSchema = z.object({ from: z.coerce.date().optional() });

@ApiTags('Offboarding')
@ApiBearerAuth()
@Controller('users')
export class OffboardingController {
  constructor(private readonly offboarding: OffboardingService) {}

  @Get(':id/offboard/preview')
  @RequirePermissions('user:update')
  @ApiOperation({
    summary: 'What this person holds, and what a handover would move',
    description:
      'Closed leads and completed visits stay with them for historical accuracy; only live ' +
      'work is listed under `willReassign`.',
  })
  preview(@Param('id', IdParamPipe) id: string) {
    return this.offboarding.preview(id);
  }

  @Post(':id/notice-period')
  @RequirePermissions('user:update')
  @ApiOperation({
    summary: 'Flag a user as being in their notice period',
    description:
      'Changes no permission. It raises the audit level on bulk exports by this user, so an ' +
      'unusual data pull is visible while they are still employed and still entitled to work.',
  })
  markNotice(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodValidationPipe(noticeSchema)) body: { from?: Date },
  ) {
    return this.offboarding.markNoticePeriod(actor, id, body.from ?? new Date());
  }

  @Post(':id/offboard')
  @RequirePermissions('user:update')
  @ApiOperation({
    summary: 'Offboard a user and hand over their live work',
    description:
      'Revokes every session first, then disables the account, then reassigns open leads, ' +
      'customers and tasks. Planned visits are cancelled rather than reassigned — a visit is ' +
      'a commitment by a named person to be somewhere.',
  })
  @ApiZodBody(offboardUserSchema)
  offboard(
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(offboardUserSchema) body: OffboardUserInput,
  ) {
    return this.offboarding.offboard(actor, id, body);
  }
}
