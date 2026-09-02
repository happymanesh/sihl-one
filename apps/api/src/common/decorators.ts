import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@sihl-one/contracts';

import type { AuthenticatedPrincipal } from './types';

/** Marks a route as reachable without a token (login, public lead capture). */
export const IS_PUBLIC_KEY = 'sihl:isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route as reachable while the caller still owes a password change.
 *
 * Opt-out rather than opt-in, matching `@Public()`: a user on a temporary
 * password is refused everywhere by default, so forgetting this decorator on a
 * new route closes a door rather than opening one. Only changing the password
 * and signing out should carry it.
 */
export const ALLOW_PENDING_PASSWORD_KEY = 'sihl:allowPendingPassword';
export const AllowPendingPasswordChange = (): MethodDecorator =>
  SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/**
 * Marks a route as reachable with a service-account key.
 *
 * Opt-*in*, unlike everything else here. A machine credential lives in another
 * system's configuration and is used unattended, so the set of endpoints it can
 * reach should be a short list somebody chose, not everything that happens to
 * match its permissions. A route without this decorator refuses a key even if
 * the key holds the permission the route requires.
 *
 * Permissions are still checked on top. This decides only that a non-human
 * caller is contemplated here at all.
 */
export const ALLOW_SERVICE_KEY = 'sihl:allowServiceKey';
/** Applies to a whole controller or a single route. */
export const AllowServiceAccount = () => SetMetadata(ALLOW_SERVICE_KEY, true);

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
