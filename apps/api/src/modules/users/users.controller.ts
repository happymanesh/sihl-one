import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod';
import { UsersService } from './users.service';

const searchSchema = z.string().trim().max(80).optional();

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('assignable')
  @RequirePermissions('user:read')
  @ApiQuery({ name: 'q', required: false })
  @ApiOperation({
    summary: 'Users this caller may assign work to',
    description:
      'Returns the caller plus their reports for a team-scoped user, or every active ' +
      'internal user for an unscoped one. Backs the owner picker.',
  })
  assignable(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('q', new ZodValidationPipe(searchSchema)) q?: string,
    // 'transfer' widens the list beyond the caller's team. Honoured in the
    // service only for someone who may transfer, so passing it changes nothing
    // for anyone else.
    @Query('for') target?: string,
  ) {
    return this.users.assignable(user, q, target === 'transfer');
  }

  @Get('colleagues')
  /*
    `visit:create`, not `user:read`.

    This was the whole bug. The attendee picker was reading `assignable`, which
    is guarded by `user:read` — a permission a sales executive does not hold —
    so the call 403'd, the page swallowed it into an empty list, and the field
    silently disappeared for exactly the people the feature was built for.

    Whoever may plan a visit may see who they could bring on it. Anyone who
    cannot still gets nothing.
  */
  @RequirePermissions('visit:create')
  @ApiQuery({ name: 'q', required: false })
  @ApiOperation({
    summary: 'Colleagues the caller could take along on a visit',
    description:
      'Zonal head and above see every active internal user; everyone below sees their own ' +
      'region. Partner logins see their own firm. Never the caller themselves.',
  })
  colleagues(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('q', new ZodValidationPipe(searchSchema)) q?: string,
  ) {
    return this.users.colleagues(user, q);
  }

  @Get('me/sessions')
  @ApiOperation({ summary: 'Active sessions for the signed-in user (device management)' })
  sessions(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.users.activeSessions(user.id, user.sessionId);
  }
}
