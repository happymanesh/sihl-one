import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions, type Permission } from '@sihl-one/contracts';

import { AuditService } from '../audit.service';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import type { AuthenticatedPrincipal } from '../types';

/**
 * RBAC check. Runs after JwtAuthGuard, so `request.user` is populated.
 *
 * A denial is audited. "Someone tried to do something they are not allowed to
 * do" is exactly the signal a security team wants, and it is invisible if the
 * only record is a 403 in an access log.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal }>();
    const user = request.user;
    if (!user) return false;

    if (hasAllPermissions(user.permissions, required)) return true;

    const missing = required.filter((permission) => !user.permissions.includes(permission));
    await this.audit.record({
      action: 'PERMISSION_DENIED',
      // The permission, not the controller class. "Denied access to a
      // CampaignsController" tells a compliance reader nothing; "denied
      // campaign:read" tells them exactly which grant is missing.
      resource: 'permission',
      resourceId: missing[0] ?? null,
      changes: { required, missing, handler: context.getHandler().name },
    });

    throw new ForbiddenException({
      title: 'Insufficient permissions',
      // The missing permission is named deliberately: it turns a support
      // ticket from "it says forbidden" into "this role needs lead:assign".
      detail: `This action requires: ${missing.join(', ')}.`,
    });
  }
}
