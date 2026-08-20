import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  effectiveScope,
  type AuthTokens,
  type AuthenticatedUser,
  type ChangePasswordInput,
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
  ) {}

  async login(input: LoginInput): Promise<LoginResponse | MfaChallengeResponse> {
    const identifier = input.identifier.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier }, { mobile: identifier.replace(/^(\+91|91|0)/, '') }],
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
        // Reuse of an already-rotated token. Either the client raced itself or
        // the token leaked; the safe response to both is to kill every session
        // for that user and force a fresh sign-in.
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

    const roles = session.user.roles.map((assignment) => assignment.role.code as Role);
    const permissions = [
      ...new Set(session.user.roles.flatMap((a) => a.role.permissions as Permission[])),
    ];
    const rotated = this.tokens.createRefreshToken();

    const newSession = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      return tx.session.create({
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
