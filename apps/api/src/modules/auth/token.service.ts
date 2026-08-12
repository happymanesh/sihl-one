import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims } from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';

export interface IssueAccessTokenInput {
  userId: string;
  sessionId: string;
  userType: AccessTokenClaims['typ'];
  roles: AccessTokenClaims['roles'];
  permissions: AccessTokenClaims['perms'];
  dataScope: AccessTokenClaims['scope'];
  orgUnitId: string | null;
}

/**
 * Token issuance and verification.
 *
 * ADR-0004: this class is the *only* place that knows how a token is minted or
 * checked. When SIHL Synapse becomes the identity provider, `verifyAccessToken`
 * changes to validate Synapse-signed RS256 tokens against its JWKS and
 * `issueAccessToken` disappears — and nothing else in the codebase moves,
 * because every caller depends on this interface rather than on jsonwebtoken.
 *
 * Symmetric HS256 is used while SIHL ONE is its own issuer: there is exactly
 * one verifier, so asymmetric keys would buy nothing but key management.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  async issueAccessToken(input: IssueAccessTokenInput): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.config.auth.accessTtlSeconds;
    const token = await this.jwt.signAsync(
      {
        typ: input.userType,
        roles: input.roles,
        perms: input.permissions,
        scope: input.dataScope,
        ou: input.orgUnitId,
        sid: input.sessionId,
      },
      {
        subject: input.userId,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        secret: this.config.auth.accessSecret,
        expiresIn,
      },
    );
    return { token, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.auth.accessSecret,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
    } catch {
      throw new UnauthorizedException({
        title: 'Invalid or expired token',
        detail: 'Sign in again to continue.',
      });
    }
  }

  /**
   * Refresh tokens are opaque random strings, not JWTs.
   *
   * A JWT refresh token is self-validating, which means it stays valid until it
   * expires even after the user hits "sign out everywhere". An opaque token is
   * only valid while its hash is present and unrevoked in the session table, so
   * revocation is immediate — which is the entire point of having one.
   */
  createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.config.auth.refreshTtlSeconds * 1000),
    };
  }

  /** SHA-256 is correct here, not Argon2: the input is 384 bits of entropy, so
   *  there is nothing to brute-force, and this runs on every token refresh. */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
