import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PASSWORD_RESET_TTL_MINUTES,
  effectiveScope,
  type AuthTokens,
  type AuthenticatedUser,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type DataScope,
  type LoginInput,
  type LoginResponse,
  type Permission,
  type Role,
  type MfaChallengeResponse,
  type MfaAnswerInput,
} from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { AuditService } from '../../common/audit.service';
import { RequestContextStore } from '../../common/request-context';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Mailer } from '../mail/mailer';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Uniform failure message.
 *
 * Every unsuccessful login returns this same text whether the account does not
 * exist, the password is wrong, or the user is suspended. Distinguishing them
 * turns the login form into an account-enumeration oracle, which for a broker
 * means an attacker can confirm who holds a demat account with SIHL. The real
 * reason is recorded in `login_attempt` for the security team.
 */
const GENERIC_LOGIN_FAILURE = {
  title: 'Sign in failed',
  detail: 'The credentials you entered are incorrect.',
} as const;

/**
 * How long after a legitimate rotation a superseded refresh token is still
 * followed forward rather than read as theft.
 *
 * Sized to cover one page load racing itself, not to be a grace period in any
 * broader sense. A stolen token surfacing seconds after the victim refreshed is
 * indistinguishable from the race and is accepted; one surfacing later is not.
 * That trade is the standard one for refresh-token rotation, and the
 * alternative was signing the whole team out every fifteen minutes.
 */
const ROTATION_GRACE_MS = 30_000;

/** Bound on chain-walking, so a corrupt or looping chain cannot spin. */
const ROTATION_CHAIN_MAX_HOPS = 10;

/** The user row `login` loads, shared with `completeSignIn` so the two cannot drift. */
type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    roles: { include: { role: true } };
    orgUnit: { select: { id: true; name: true } };
  };
}>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
  ) {}

  async login(input: LoginInput): Promise<LoginResponse | MfaChallengeResponse> {
    const identifier = input.identifier.trim().toLowerCase();
    // Employee codes are stored uppercase (SIHL-0001, R0018). Without this the
    // lowercasing above — which email and mobile need — would mean a code
    // typed exactly as it appears on someone's ID card never matches.
    const asCode = input.identifier.trim().toUpperCase();

    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: identifier },
          { mobile: identifier.replace(/^(\+91|91|0)/, '') },
          { employeeCode: asCode },
        ],
      },
      include: {
        roles: { include: { role: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });

    if (!user || !user.passwordHash) {
      // Hash a dummy value anyway. Returning early on "no such user" makes the
      // response measurably faster than a wrong-password response, and that
      // timing difference alone enumerates accounts.
      await this.passwords.verify(input.password, '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      await this.recordAttempt(identifier, null, false, 'NO_SUCH_USER');
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordAttempt(identifier, user.id, false, 'LOCKED');
      throw new UnauthorizedException({
        title: 'Account temporarily locked',
        detail: `Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString('en-IN')}.`,
      });
    }

    if (user.status !== 'ACTIVE') {
      await this.recordAttempt(identifier, user.id, false, `STATUS_${user.status}`);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    const passwordValid = await this.passwords.verify(input.password, user.passwordHash);
    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.recordAttempt(identifier, user.id, false, 'BAD_PASSWORD');
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    const roles = user.roles.map((assignment) => assignment.role.code as Role);
    if (roles.length === 0) {
      // An active account with no role can do nothing but would otherwise get a
      // token and then a confusing 403 on every screen.
      await this.recordAttempt(identifier, user.id, false, 'NO_ROLES');
      throw new UnauthorizedException({
        title: 'No access configured',
        detail: 'Your account has no roles assigned. Contact your administrator.',
      });
    }

    const permissions = [
      ...new Set(user.roles.flatMap((assignment) => assignment.role.permissions as Permission[])),
    ];
    const scope = effectiveScope(roles, user.dataScope as DataScope | null);

    // Password proven. If a second factor is enrolled, no session is created
    // and no token is issued — the caller gets a short-lived challenge instead,
    // signed with a different key so it can never act as an access token.
    if (user.mfaEnabled && user.mfaSecret) {
      const challenge = await this.mfa.issueChallenge(user.id);
      await this.recordAttempt(identifier, user.id, true, 'MFA_PENDING');
      return {
        mfaRequired: true as const,
        challengeToken: challenge.token,
        expiresInSeconds: challenge.expiresInSeconds,
      };
    }

    return this.completeSignIn(user, roles, permissions, scope, identifier, input.deviceId);
  }

  /**
   * Second half of a sign-in that needed two factors.
   *
   * Deliberately re-loads the user and re-derives roles rather than carrying
   * them in the challenge token. Five minutes is long enough for someone to be
   * deactivated or have a role pulled between the two halves, and a token
   * carrying stale claims would hand them a session anyway.
   */
  async answerMfaChallenge(input: MfaAnswerInput): Promise<LoginResponse> {
    const userId = await this.mfa.verifyChallenge(input.challengeToken);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { include: { role: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    const ok = await this.mfa.verifySecondFactor(user.id, input.code);
    if (!ok) {
      await this.recordAttempt(user.email, user.id, false, 'MFA_FAILED');
      await this.audit.record({
        action: 'LOGIN_FAILED',
        resource: 'auth',
        resourceId: user.id,
        reason: 'Second factor did not match',
        actor: {
          id: user.id,
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
        },
      });
      throw new UnauthorizedException({
        title: 'That code did not match',
        detail: 'Check your authenticator app, or use one of your recovery codes.',
      });
    }

    const roles = user.roles.map((assignment) => assignment.roleCode as Role);
    const permissions = [
      ...new Set(user.roles.flatMap((assignment) => assignment.role.permissions as Permission[])),
    ];
    const scope = effectiveScope(roles, user.dataScope as DataScope | null);

    return this.completeSignIn(user, roles, permissions, scope, user.email);
  }

  /**
   * Completes a sign-in that has cleared every factor.
   *
   * Shared by the password-only path and the MFA path so the two cannot drift —
   * a second copy of session creation is how one of them ends up missing the
   * audit write or the failed-attempt reset.
   */
  async completeSignIn(
    user: UserWithRoles,
    roles: Role[],
    permissions: Permission[],
    scope: DataScope,
    identifier: string,
    deviceId?: string,
  ): Promise<LoginResponse> {
    const context = RequestContextStore.get();
    const refresh = this.tokens.createRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        deviceId: deviceId ?? null,
        userAgent: context?.userAgent?.slice(0, 400) ?? null,
        ipAddress: context?.ipAddress ?? null,
        expiresAt: refresh.expiresAt,
      },
    });

    const access = await this.tokens.issueAccessToken({
      userId: user.id,
      sessionId: session.id,
      userType: user.userType,
      roles,
      permissions,
      dataScope: scope,
      orgUnitId: user.orgUnitId,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.recordAttempt(identifier, user.id, true, null);
    await this.audit.record({
      action: 'LOGIN',
      resource: 'auth',
      resourceId: user.id,
      // Named explicitly: there is no authenticated principal on the request
      // yet, so the context cannot supply one.
      actor: {
        id: user.id,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
      },
    });

    return {
      user: this.toAuthenticatedUser(user, roles, permissions, scope),
      tokens: {
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresIn: access.expiresIn,
        tokenType: 'Bearer',
      },
    };
  }

  /**
   * Refresh with rotation: the presented token is revoked and a new one issued
   * in the same transaction. A refresh token is therefore single-use, so a
   * stolen one is only usable until the legitimate client next refreshes — at
   * which point the theft becomes visible as a reuse of a revoked token.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = this.tokens.hashRefreshToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: {
        user: {
          include: {
            roles: { include: { role: true } },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      if (session?.revokedAt) {
        // A token presented moments after its own rotation is the client racing
        // itself, not a theft. The browser middleware sends every protected
        // request that lacks an access cookie to /auth/refresh, and a page load
        // is several requests, so one wins the rotation and the others arrive
        // holding the token it just replaced.
        //
        // Treating that as reuse revoked every session the user had, which is
        // how an entire team got signed out mid-task. Inside the grace window
        // the chain is followed forward to the live session instead.
        //
        // The security property survives: a token that surfaces after the
        // window, or one whose chain has already been revoked, still trips
        // detection below and still revokes everything.
        const rotatedRecently =
          session.revokedReason === 'ROTATED' &&
          Date.now() - session.revokedAt.getTime() <= ROTATION_GRACE_MS;

        if (rotatedRecently && session.replacedById) {
          const successor = await this.followRotationChain(session.replacedById);
          if (successor) {
            this.logger.log(
              `Refresh raced itself for user ${session.userId}; followed the rotation chain rather than revoking.`,
            );
            return this.rotate(successor.id);
          }
        }

        // Either the client raced itself outside the window or the token
        // leaked; the safe response to both is to kill every session for that
        // user and force a fresh sign-in.
        this.logger.warn(`Refresh token reuse detected for user ${session.userId}; revoking all sessions.`);
        await this.prisma.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE_DETECTED' },
        });
      }
      throw new UnauthorizedException({
        title: 'Session expired',
        detail: 'Sign in again to continue.',
      });
    }

    if (session.user.status !== 'ACTIVE' || session.user.deletedAt) {
      throw new UnauthorizedException({ title: 'Session expired', detail: 'Sign in again to continue.' });
    }

    // Idle timeout, enforced here rather than only in the browser. A countdown
    // on the screen is a courtesy; without this check the refresh token still
    // works for its full lifetime and the timeout is decorative.
    const idleMs = this.config.auth.idleTimeoutMinutes * 60_000;
    if (Date.now() - session.lastSeenAt.getTime() > idleMs) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'IDLE_TIMEOUT' },
      });
      throw new UnauthorizedException({
        title: 'Signed out for inactivity',
        detail: 'Sign in again to continue.',
      });
    }

    return this.rotate(session.id);
  }

  /**
   * Walk forward from a rotated session to the live one at the end of the chain.
   *
   * Bounded rather than unbounded: a corrupt or looping chain must not spin. A
   * page load produces a handful of racing refreshes, never hundreds, so a short
   * bound is generous and still terminates.
   */
  private async followRotationChain(startId: string): Promise<{ id: string } | null> {
    let id: string | null = startId;

    for (let hop = 0; hop < ROTATION_CHAIN_MAX_HOPS && id; hop += 1) {
      const next: { id: string; revokedAt: Date | null; replacedById: string | null } | null =
        await this.prisma.session.findUnique({
          where: { id },
          select: { id: true, revokedAt: true, replacedById: true },
        });

      if (!next) return null;
      if (!next.revokedAt) return { id: next.id };
      id = next.replacedById;
    }

    return null;
  }

  /**
   * Issue a new token pair for a live session, retiring the one it replaces.
   *
   * Split out of `refresh` so the raced-itself path can reach it without
   * re-running the checks that path has already satisfied.
   */
  private async rotate(sessionId: string): Promise<AuthTokens> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        title: 'Session expired',
        detail: 'Sign in again to continue.',
      });
    }

    const roles = session.user.roles.map((assignment) => assignment.role.code as Role);
    const permissions = [
      ...new Set(session.user.roles.flatMap((a) => a.role.permissions as Permission[])),
    ];
    const rotated = this.tokens.createRefreshToken();

    const newSession = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: rotated.hash,
          deviceId: session.deviceId,
          deviceLabel: session.deviceLabel,
          userAgent: session.userAgent,
          ipAddress: RequestContextStore.get()?.ipAddress ?? session.ipAddress,
          expiresAt: rotated.expiresAt,
        },
      });
      // Created before the old one is retired, so `replacedById` is never null
      // on a revoked row — a racing request that reads between the two writes
      // would otherwise find a dead end and fall through to mass revocation.
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedById: created.id },
      });
      return created;
    });

    const access = await this.tokens.issueAccessToken({
      userId: session.userId,
      sessionId: newSession.id,
      userType: session.user.userType,
      roles,
      permissions,
      dataScope: effectiveScope(roles, session.user.dataScope as DataScope | null),
      orgUnitId: session.user.orgUnitId,
    });

    return {
      accessToken: access.token,
      refreshToken: rotated.token,
      expiresIn: access.expiresIn,
      tokenType: 'Bearer',
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
    });
    await this.audit.record({ action: 'LOGOUT', resource: 'auth', resourceId: sessionId });
  }

  async logoutEverywhere(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT_ALL' },
    });
    await this.audit.record({
      action: 'LOGOUT',
      resource: 'auth',
      resourceId: userId,
      changes: { sessionsRevoked: result.count },
    });
    return result.count;
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user?.passwordHash) throw new BadRequestException({ title: 'Password cannot be changed' });

    const valid = await this.passwords.verify(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException({
        title: 'Current password is incorrect',
        errors: { currentPassword: ['Current password is incorrect'] },
      });
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    // Changing a password ends every other session. If the change was prompted
    // by a suspected compromise, leaving the attacker's session alive defeats
    // the point.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      }),
    ]);

    await this.audit.record({ action: 'UPDATE', resource: 'user.password', resourceId: userId });
  }

  /**
   * Issue a reset link, and say nothing about who has an account.
   *
   * The response is identical whether the identifier matched a live user, a
   * suspended one, or nobody at all — no message difference, no status
   * difference. A forgot-password form is the classic account-enumeration
   * oracle: "no account with that email" hands anyone a way to test whether a
   * given person banks with SIHL, which for a broker is a disclosure in itself.
   * It is the same mistake finding 1 of docs/pii-egress-review.md records on
   * the capture endpoint, and it is not worth making twice.
   *
   * The work is therefore done quietly and the caller is told nothing:
   * unknown identifier, locked account, no email on file, mailer not
   * configured — all of them return the same acknowledgement.
   */
  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    const context = RequestContextStore.get();
    const identifier = input.identifier.trim().toLowerCase();
    const asCode = input.identifier.trim().toUpperCase();

    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: identifier },
          { mobile: identifier.replace(/^(\+91|91|0)/, '') },
          { employeeCode: asCode },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        employeeCode: true,
        status: true,
      },
    });

    // Every early return below is silent by design. See the note above.
    if (!user || user.status !== 'ACTIVE' || !user.email) {
      this.logger.warn(
        `Password reset requested for an identifier that resolved to ${
          user ? `a ${user.status} account` : 'no account'
        }`,
      );
      return;
    }

    /*
      A cap on outstanding links per account.

      Without it, anyone who knows an address can post the form repeatedly and
      fill somebody's inbox — annoying for them, and an effective way to bury a
      genuine security email under noise. Existing unspent links stay valid, so
      a legitimate user who clicks twice is not locked out of their own reset.
    */
    const recent = await this.prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent >= 5) {
      this.logger.warn(`Password reset throttled for user ${user.id}: ${recent} in the last hour`);
      return;
    }

    // 32 bytes of CSPRNG, base64url. Long enough that guessing is not a
    // strategy, short enough to survive a mail client wrapping the URL.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestedIp: context?.ipAddress ?? null,
        requestedUa: context?.userAgent?.slice(0, 400) ?? null,
      },
    });

    const base = (this.config.mail.appUrl ?? '').replace(/\/$/, '');
    const resetUrl = `${base}/reset-password?token=${token}`;

    // Audited before the send, and recording *that* a reset was requested
    // rather than the token — an audit row holding a working key to an account
    // would defeat the hashing above.
    await this.audit.record({
      action: 'UPDATE',
      resource: 'user.password-reset-requested',
      resourceId: user.id,
      reason: 'Self-service password reset requested',
    });

    try {
      const result = await this.mailer.sendPasswordResetLink({
        to: user.email,
        firstName: user.firstName,
        employeeCode: user.employeeCode,
        resetUrl,
        validForMinutes: PASSWORD_RESET_TTL_MINUTES,
        productName: this.config.mail.fromName,
      });
      if (!result.accepted) {
        // Loud in the logs, silent to the caller. An administrator needs to
        // know the mailer is not configured; the person at the form must not
        // learn anything from it either way.
        this.logger.error(
          `Password reset link for user ${user.id} was not sent: ${result.failureReason ?? 'unknown'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Password reset link for user ${user.id} failed to send`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Spend a reset link.
   *
   * Unlike the request side, this one does report failure — the person is
   * holding a link they believe in, and "that link is no longer valid" is
   * information they need and which reveals nothing about anyone else.
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const tokenHash = createHash('sha256').update(input.token.trim()).digest('hex');

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, status: true, deletedAt: true } } },
    });

    const invalid = new BadRequestException({
      title: 'This reset link is no longer valid',
      detail:
        'It may have expired, or already been used. Ask for a new one from the sign-in page.',
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) throw invalid;
    if (!record.user || record.user.deletedAt || record.user.status !== 'ACTIVE') throw invalid;

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();

    await this.prisma.$transaction([
      // Marked used inside the same transaction as the password write, so two
      // requests racing with one link cannot both succeed.
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),

      // Every other outstanding link for this account dies too. Somebody who
      // has just regained control should not leave live keys behind them.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: now },
      }),

      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
          // A person who has forgotten their password has usually just locked
          // themselves out trying to remember it. Proving control of the
          // mailbox is a stronger signal than the lockout it clears.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),

      // As with a deliberate change: if the reset was prompted by a takeover,
      // leaving the intruder's session alive defeats the point.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      }),
    ]);

    await this.audit.record({
      action: 'UPDATE',
      resource: 'user.password',
      resourceId: record.userId,
      reason: 'Password reset via emailed link',
    });
  }

  async currentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { include: { role: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
    const roles = user.roles.map((assignment) => assignment.role.code as Role);
    const permissions = [
      ...new Set(user.roles.flatMap((a) => a.role.permissions as Permission[])),
    ];
    return this.toAuthenticatedUser(
      user,
      roles,
      permissions,
      effectiveScope(roles, user.dataScope as DataScope | null),
    );
  }

  // -------------------------------------------------------------------------

  private toAuthenticatedUser(
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      mobile: string | null;
      userType: AuthenticatedUser['userType'];
      orgUnitId: string | null;
      orgUnit?: { id: string; name: string } | null;
      mustChangePassword: boolean;
      avatarUrl: string | null;
    },
    roles: Role[],
    permissions: Permission[],
    dataScope: DataScope,
  ): AuthenticatedUser {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      mobile: user.mobile,
      userType: user.userType,
      roles,
      permissions,
      dataScope,
      orgUnitId: user.orgUnitId,
      orgUnitName: user.orgUnit?.name ?? null,
      mustChangePassword: user.mustChangePassword,
      avatarUrl: user.avatarUrl,
    };
  }

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const attempts = current + 1;
    const shouldLock = attempts >= this.config.auth.maxFailedAttempts;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000)
          : null,
      },
    });
  }

  private async recordAttempt(
    identifier: string,
    userId: string | null,
    successful: boolean,
    failReason: string | null,
  ): Promise<void> {
    const context = RequestContextStore.get();
    await this.prisma.loginAttempt
      .create({
        data: {
          identifier: identifier.slice(0, 160),
          userId,
          successful,
          failReason,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent?.slice(0, 400) ?? null,
        },
      })
      .catch((error: unknown) => {
        this.logger.error('Failed to record login attempt', String(error));
      });
  }
}
