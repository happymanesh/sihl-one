import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions, type Permission } from '@sihl-one/contracts';

import { AuditService } from '../audit.service';
import { ANY_PERMISSIONS_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
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
    const anyOf = this.reflector.getAllAndOverride<Permission[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasRequired = Boolean(required?.length);
    const hasAnyOf = Boolean(anyOf?.length);
    if (!hasRequired && !hasAnyOf) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal }>();
    const user = request.user;
    if (!user) return false;

    // Both forms may sit on one route, and they compose the obvious way: every
    // `required` permission, and at least one of `anyOf`.
    const requiredOk = !hasRequired || hasAllPermissions(user.permissions, required!);
    const anyOk = !hasAnyOf || anyOf!.some((permission) => user.permissions.includes(permission));
    if (requiredOk && anyOk) return true;

    const missing = [
      ...(required ?? []).filter((permission) => !user.permissions.includes(permission)),
      // Named as a choice, because listing them as missing would tell a reader
      // they need all of them when any one would have done.
      ...(anyOk ? [] : [`one of ${(anyOf ?? []).join(' or ')}` as Permission]),
    ];
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
