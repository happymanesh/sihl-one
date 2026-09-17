import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  disableMfaSchema,
  enableMfaSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaAnswerSchema,
  refreshSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type DisableMfaInput,
  type EnableMfaInput,
  type ForgotPasswordInput,
  type LoginInput,
  type MfaAnswerInput,
  type RefreshInput,
  type ResetPasswordInput,
} from '@sihl-one/contracts';

import { CurrentUser, Public,
  AllowPendingPasswordChange,
} from '../../common/decorators';
import { ApiZodBody, ZodBody } from '../../common/zod';
import type { AuthenticatedPrincipal } from '../../common/types';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Tighter than the global limit. Login is the endpoint credential-stuffing
  // actually targets, and 5/minute per IP is generous for a human.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in with email or mobile',
    description:
      'Returns the authenticated user plus an access/refresh token pair. Failures are ' +
      'deliberately indistinguishable from one another to prevent account enumeration.',
  })
  @ApiResponse({ status: 200, description: 'Signed in.' })
  @ApiResponse({ status: 401, description: 'Credentials rejected, or the account is locked.' })
  @ApiZodBody(loginSchema)
  login(@ZodBody(loginSchema) body: LoginInput) {
    return this.auth.login(body);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  // Tighter than login. One person asking for a reset link does it once or
  // twice; a burst from one address is somebody testing which identifiers
  // exist, and the per-account cap inside the service is the second line.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ask for a password reset link',
    description:
      'Always answers 202, whether or not the identifier matches an account. A response ' +
      'that varied would let anyone test whether a given person is a SIHL user.',
  })
  @ApiResponse({ status: 202, description: 'Acknowledged. A link is sent only if the account exists.' })
  @ApiZodBody(forgotPasswordSchema)
  async forgotPassword(@ZodBody(forgotPasswordSchema) body: ForgotPasswordInput) {
    await this.auth.requestPasswordReset(body);
    return {
      message:
        'If that account exists, a reset link is on its way. Check your inbox, including spam.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set a new password using a reset link',
    description:
      'Single use. Spending a link ends every session the account had, and cancels any ' +
      'other outstanding link for it.',
  })
  @ApiResponse({ status: 204, description: 'Password set. Sign in with it.' })
  @ApiResponse({ status: 400, description: 'The link was expired, already spent, or unknown.' })
  @ApiZodBody(resetPasswordSchema)
  async resetPassword(@ZodBody(resetPasswordSchema) body: ResetPasswordInput) {
    await this.auth.resetPassword(body);
  }

  @Public()
  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Answer the second-factor challenge',
    description:
      'Accepts a TOTP code or an unused recovery code. Rate limited hard — six digits is ' +
      'guessable at any useful rate without it.',
  })
  @ApiZodBody(mfaAnswerSchema)
  mfaChallenge(@ZodBody(mfaAnswerSchema) body: MfaAnswerInput) {
    return this.auth.answerMfaChallenge(body);
  }

  @Get('mfa')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Whether two-factor is on, and how many recovery codes are left' })
  mfaStatus(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.mfa.status(user.id);
  }

  @Post('mfa/setup')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Begin enrolment',
    description: 'Returns a secret and QR URI. Nothing is stored until a code is verified.',
  })
  mfaSetup(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.mfa.setup(user.email);
  }

  @Post('mfa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish enrolment by proving a code works',
    description: 'Returns the recovery codes. They are shown once and never again.',
  })
  @ApiZodBody(enableMfaSchema)
  mfaEnable(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(enableMfaSchema) body: EnableMfaInput,
  ) {
    return this.mfa.enable(user.id, user.email, body.secret, body.code);
  }

  @Post('mfa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Turn two-factor off',
    description: 'Requires the password and a current code — both factors, since this removes one.',
  })
  @ApiZodBody(disableMfaSchema)
  mfaDisable(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(disableMfaSchema) body: DisableMfaInput,
  ) {
    return this.mfa.disable(user.id, body);
  }

  // Public, necessarily: this endpoint exists to be called when the access
  // token has expired, so requiring one is a contradiction. It was missing that
  // decorator and answered every call with "No bearer token was supplied",
  // which meant refresh had never once succeeded — the moment an access token
  // aged out, the session was effectively over. The refresh token in the body
  // is the credential, and it is verified against the session table.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Rotates the refresh token. Presenting an already-rotated token is tolerated for a few ' +
      'seconds, since a browser can race itself; later reuse revokes every session for that ' +
      'user, on the assumption the token leaked.',
  })
  @ApiZodBody(refreshSchema)
  refresh(@ZodBody(refreshSchema) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentUser() user: AuthenticatedPrincipal): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session for the signed-in user' })
  async logoutAll(@CurrentUser() user: AuthenticatedPrincipal) {
    const revoked = await this.auth.logoutEverywhere(user.id);
    return { revoked };
  }

  @Get('me')
  @AllowPendingPasswordChange()
  @ApiOperation({ summary: 'Current user, roles, permissions and data scope' })
  me(@CurrentUser('id') userId: string) {
    return this.auth.currentUser(userId);
  }

  @Post('change-password')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({
    summary: 'Change the signed-in user password',
    description: 'Succeeds only with the current password, and revokes every other session.',
  })
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @CurrentUser('id') userId: string,
    @ZodBody(changePasswordSchema) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(userId, body);
  }
}
