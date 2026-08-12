import { createHash, randomInt } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verify as verifyPassword } from '@node-rs/argon2';
import {
  generateRecoveryCodes,
  normaliseRecoveryCode,
  TOTP_DIGITS,
  TOTP_PERIOD,
  TOTP_WINDOW,
  type DisableMfaInput,
  type MfaEnabledResponse,
  type MfaSetupResponse,
  type MfaStatus,
} from '@sihl-one/contracts';
import * as OTPAuth from 'otpauth';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

const ISSUER = 'SIHL ONE';

/** How long a half-finished sign-in stays valid. */
const CHALLENGE_TTL_SECONDS = 300;

/**
 * Two-factor authentication.
 *
 * The challenge token is signed with a **different key** from the access token
 * — the JWT secret with a fixed suffix. That is the important detail: a token
 * that only proves "this person knew a password" must not be usable as one that
 * proves "this person is authenticated", and separating the keys makes that a
 * cryptographic fact rather than a claim-checking convention somebody could
 * later loosen.
 */
@Injectable()
export class MfaService {
  private readonly challengeSecret: string;
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    // Assigned in the body, not as a defaulted parameter property: Nest
    // resolves constructor parameters by type metadata and would try to inject
    // one of those, which fails at startup rather than at the call site.
    this.pepper = config.get<string>('PASSWORD_PEPPER') ?? '';
    this.challengeSecret = `${config.get<string>('JWT_SECRET') ?? ''}:mfa-challenge`;
  }

  async status(userId: string): Promise<MfaStatus> {
    const [user, remaining] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { mfaEnabled: true, mfaEnrolledAt: true },
      }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);

    return {
      enabled: user?.mfaEnabled ?? false,
      enrolledAt: user?.mfaEnrolledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
    };
  }

  /**
   * Starts enrolment.
   *
   * The secret is returned but **not** stored. Persisting it here would leave
   * anyone who scans the QR and then closes the tab with MFA half-on and no way
   * to say so. It becomes real only when `enable` proves a code from it works.
   */
  setup(email: string): MfaSetupResponse {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: new OTPAuth.Secret({ size: 20 }),
    });

    return {
      secret: totp.secret.base32,
      otpauthUri: totp.toString(),
      issuer: ISSUER,
      accountName: email,
    };
  }

  async enable(
    userId: string,
    email: string,
    secret: string,
    code: string,
  ): Promise<MfaEnabledResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    if (user?.mfaEnabled) {
      throw new BadRequestException({
        title: 'Already enabled',
        detail: 'Two-factor authentication is already on for this account.',
      });
    }

    if (!this.verifyTotp(secret, code)) {
      throw new BadRequestException({
        title: 'That code did not match',
        detail:
          'Check the six digits in your authenticator app and try again. If it keeps failing, ' +
          'your phone’s clock may be out of step.',
      });
    }

    const codes = generateRecoveryCodes((max) => randomInt(max));

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: true, mfaSecret: secret, mfaEnrolledAt: new Date() },
      });

      // Any codes from an earlier enrolment are void — otherwise turning MFA
      // off and on again silently leaves the old printout working.
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((plain) => ({ userId, codeHash: this.hashRecoveryCode(plain) })),
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'auth.mfa',
      resourceId: userId,
      changes: { mfaEnabled: { from: false, to: true } },
    });

    return { enabled: true, recoveryCodes: codes };
  }

  async disable(userId: string, input: DisableMfaInput): Promise<{ enabled: false }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, passwordHash: true },
    });

    if (!user?.mfaEnabled || !user.mfaSecret || !user.passwordHash) {
      throw new BadRequestException({
        title: 'Not enabled',
        detail: 'Two-factor authentication is not on for this account.',
      });
    }

    const passwordOk = await verifyPassword(user.passwordHash, `${input.password}${this.pepper}`);
    const codeOk =
      this.verifyTotp(user.mfaSecret, input.code) ||
      (await this.consumeRecoveryCode(userId, input.code));

    // Both are checked before either is reported, and the message names
    // neither: which of the two was wrong is not information a caller who has
    // one of them should be handed.
    if (!passwordOk || !codeOk) {
      await this.audit.record({
        action: 'PERMISSION_DENIED',
        resource: 'auth.mfa',
        resourceId: userId,
        reason: 'Failed attempt to disable two-factor authentication',
      });
      throw new UnauthorizedException({
        title: 'Could not turn it off',
        detail: 'Your password or your code was not correct.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'auth.mfa',
      resourceId: userId,
      changes: { mfaEnabled: { from: true, to: false } },
    });

    return { enabled: false };
  }

  // -------------------------------------------------------------------------
  // The half-finished sign-in
  // -------------------------------------------------------------------------

  async issueChallenge(userId: string): Promise<{ token: string; expiresInSeconds: number }> {
    const token = await this.jwt.signAsync(
      { sub: userId, purpose: 'mfa_challenge' },
      { secret: this.challengeSecret, expiresIn: CHALLENGE_TTL_SECONDS },
    );
    return { token, expiresInSeconds: CHALLENGE_TTL_SECONDS };
  }

  /** Returns the user id the challenge belongs to, or throws. */
  async verifyChallenge(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(token, {
        secret: this.challengeSecret,
      });
      if (claims.purpose !== 'mfa_challenge' || !claims.sub) throw new Error('wrong purpose');
      return claims.sub;
    } catch {
      throw new UnauthorizedException({
        title: 'Sign-in expired',
        detail: 'Your sign-in took too long. Please enter your password again.',
      });
    }
  }

  /**
   * Checks the second factor.
   *
   * Accepts a TOTP code or an unused recovery code. A recovery code is consumed
   * whether or not the rest of the sign-in succeeds — it has been transmitted,
   * so it is spent.
   */
  async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });
    if (!user?.mfaEnabled || !user.mfaSecret) return false;

    if (this.verifyTotp(user.mfaSecret, code)) return true;

    const usedRecovery = await this.consumeRecoveryCode(userId, code);
    if (usedRecovery) {
      const remaining = await this.prisma.mfaRecoveryCode.count({
        where: { userId, usedAt: null },
      });
      // Loud on purpose. Somebody signing in with a recovery code has lost
      // their phone — or is not the account holder.
      await this.audit.record({
        action: 'LOGIN',
        resource: 'security.mfa_recovery_code_used',
        resourceId: userId,
        reason: `Signed in with a recovery code. ${remaining} remaining.`,
      });
    }
    return usedRecovery;
  }

  // -------------------------------------------------------------------------

  private verifyTotp(secret: string, code: string): boolean {
    const digits = code.replace(/\s/g, '');
    if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits)) return false;

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    // `validate` returns the time-step delta, or null. Anything within the
    // window counts; the constant-time comparison is otpauth's own.
    return totp.validate({ token: digits, window: TOTP_WINDOW }) !== null;
  }

  /**
   * SHA-256, not Argon2.
   *
   * These codes carry ~49 bits of real entropy, so there is nothing to stretch —
   * stretching protects low-entropy secrets people choose, not high-entropy ones
   * a machine generated. Ten Argon2 verifications per sign-in attempt would be a
   * denial-of-service surface of our own making.
   */
  private hashRecoveryCode(plain: string): string {
    return createHash('sha256')
      .update(`${normaliseRecoveryCode(plain)}${this.pepper}`)
      .digest('hex');
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalised = normaliseRecoveryCode(code);
    if (normalised.length < 6) return false;

    // Matched by hash, so the lookup is a single indexed read rather than a
    // comparison loop over the user's codes.
    const hash = this.hashRecoveryCode(normalised);

    const consumed = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: hash, usedAt: null },
      data: { usedAt: new Date() },
    });

    return consumed.count === 1;
  }
  /**
   * Clears another user's second factor.
   *
   * Never your own. `disable` requires the password and a live code; this
   * requires neither, so self-service would let anyone who has taken over an
   * admin session drop MFA and keep the account. The check is here rather than
   * in the guard because it is a property of the operation, not of the route.
   *
   * Sessions are revoked too: a reset happens because access was lost or
   * compromised, and in both cases anything still signed in should not stay so.
   */
  async adminReset(
    actor: AuthenticatedPrincipal,
    targetUserId: string,
    reason: string,
  ): Promise<{ enabled: false; sessionsRevoked: number }> {
    if (actor.id === targetUserId) {
      throw new ForbiddenException({
        title: 'Cannot reset your own',
        detail:
          'Turn your own two-step verification off from Security, where your password and a ' +
          'current code are required. Ask another administrator if you have lost both.',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, mfaEnabled: true },
    });
    if (!user) throw new NotFoundException({ title: 'User not found' });

    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: targetUserId } });

      const sessions = await tx.session.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return sessions.count;
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'security.mfa_admin_reset',
      resourceId: targetUserId,
      reason,
      changes: {
        subject: `${user.firstName} ${user.lastName}`.trim(),
        mfaEnabled: { from: user.mfaEnabled, to: false },
        sessionsRevoked: revoked,
      },
    });

    return { enabled: false, sessionsRevoked: revoked };
  }
}
