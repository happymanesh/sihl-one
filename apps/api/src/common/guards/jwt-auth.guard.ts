import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators';
import { RequestContextStore } from '../request-context';
import { TokenService } from '../../modules/auth/token.service';
import { PrincipalService } from '../../modules/auth/principal.service';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
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

    request.user = principal;
    RequestContextStore.setUser(principal);
    return true;
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
