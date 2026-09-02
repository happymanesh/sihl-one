import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ALLOW_PENDING_PASSWORD_KEY, ALLOW_SERVICE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { RequestContextStore } from '../request-context';
import { TokenService } from '../../modules/auth/token.service';
import { PrincipalService } from '../../modules/auth/principal.service';
import { ServiceAccountService } from '../../modules/auth/service-account.service';

/**
 * Applied globally. Routes opt *out* with `@Public()` rather than opting in
 * with a guard, so a newly added controller is protected by default — the
 * failure mode of forgetting the decorator is a locked door, not an open one.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly serviceAccounts: ServiceAccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();

    // A machine key, if one was presented. Checked before the bearer path
    // because the two are different credentials and a caller presents one or
    // the other — never both.
    const apiKey = this.extractApiKey(request);
    if (apiKey) {
      // Opt-in, unlike the user path. A route has to say it is willing to serve
      // a machine, so a key cannot reach an endpoint whose author never
      // considered a non-human caller — the reverse of the `@Public()` default,
      // and for the same reason: the failure mode of forgetting is a closed
      // door. Permissions still apply on top; this only decides eligibility.
      const serviceAllowed = this.reflector.getAllAndOverride<boolean>(ALLOW_SERVICE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!serviceAllowed) {
        throw new ForbiddenException({
          title: 'Not available to service accounts',
          detail: 'This endpoint can only be used by a signed-in person.',
        });
      }

      const principal = await this.serviceAccounts.verify(apiKey);
      if (!principal) {
        // One message for unknown, revoked, expired and wrong-secret alike.
        throw new UnauthorizedException({
          title: 'Service key rejected',
          detail: 'The key is unknown, expired or revoked.',
        });
      }

      request.user = principal;
      RequestContextStore.setUser(principal);
      return true;
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException({
        title: 'Authentication required',
        detail: 'No bearer token was supplied.',
      });
    }

    const claims = await this.tokens.verifyAccessToken(token);

    // The token says what the user could do when it was issued. The principal
    // is rebuilt from the database on every request so that a revoked session,
    // a suspended account or a changed role takes effect immediately rather
    // than at the next token refresh — up to 15 minutes of stale authority is
    // not acceptable for a system holding customer PII.
    const principal = await this.principals.resolve(claims.sub, claims.sid);
    if (!principal) {
      throw new UnauthorizedException({
        title: 'Session is no longer valid',
        detail: 'Sign in again to continue.',
      });
    }

    // A temporary password gets the user in and no further. Enforced here
    // rather than only by a redirect in the browser: the screen is a courtesy,
    // and without this the issued password keeps working against the API
    // directly for as long as nobody changes it.
    if (principal.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          title: 'Password change required',
          detail: 'Set a new password before using the system.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
    }

    request.user = principal;
    RequestContextStore.setUser(principal);
    return true;
  }

  /**
   * Its own header, not `Authorization`. A key in the bearer slot would be
   * tried as a JWT first and rejected as malformed, and — worse — would end up
   * in every place a bearer token is already logged or forwarded.
   */
  private extractApiKey(request: Request): string | null {
    const header = request.headers['x-service-key'];
    const value = Array.isArray(header) ? header[0] : header;
    return value?.trim() || null;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
    // Cookie fallback for the browser app, which keeps the access token in an
    // httpOnly cookie rather than in JavaScript-reachable storage.
    const cookie = (request as unknown as { cookies?: Record<string, string> }).cookies?.[
      'sihl_access'
    ];
    return cookie ?? null;
  }
}
