import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@sihl-one/contracts';

import type { AuthenticatedPrincipal } from './types';

/** Marks a route as reachable without a token (login, public lead capture). */
export const IS_PUBLIC_KEY = 'sihl:isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Required permissions for a route. The guard requires ALL listed permissions;
 * an OR relationship is expressed by splitting into separate routes, because
 * "any of these" is almost always a sign that two different use cases have been
 * merged into one endpoint.
 */
export const PERMISSIONS_KEY = 'sihl:permissions';
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Audit metadata. Presence of this decorator is what makes a route audited. */
export interface AuditMetadata {
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'ASSIGN' | 'EXPORT' | 'STATUS_CHANGE';
  resource: string;
}
export const AUDIT_KEY = 'sihl:audit';
export const Audited = (metadata: AuditMetadata): MethodDecorator =>
  SetMetadata(AUDIT_KEY, metadata);

/** Injects the authenticated principal, or a single property of it. */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedPrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal }>();
    const user = request.user;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);
