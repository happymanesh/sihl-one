import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  markReadSchema,
  notificationListQuerySchema,
  type MarkReadInput,
  type NotificationListQuery,
} from '@sihl-one/contracts';

import { CurrentUser } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod';
import { NotificationsService } from './notifications.service';

/**
 * No `@RequirePermissions` anywhere in this controller, deliberately.
 *
 * Every route reads or writes only the caller's own notifications, so there is
 * no permission that could sensibly gate it — a user who may sign in may read
 * what was addressed to them. Authentication is still required; the global
 * guard handles that.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Notifications addressed to the signed-in user, newest first' })
  @ApiZodQuery(notificationListQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(notificationListQuerySchema) query: NotificationListQuery,
  ) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread count for the badge' })
  unreadCount(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(user);
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark specific notifications read' })
  @ApiZodBody(markReadSchema)
  markRead(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(markReadSchema) body: MarkReadInput,
  ) {
    return this.notifications.markRead(user, body);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every unread notification read' })
  markAllRead(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(user);
  }
}
