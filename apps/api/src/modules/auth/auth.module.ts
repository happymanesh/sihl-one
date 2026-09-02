import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { PrincipalService } from './principal.service';
import { ServiceAccountService } from './service-account.service';
import { TokenService } from './token.service';

/**
 * Global because JwtAuthGuard is registered application-wide and needs
 * TokenService and PrincipalService wherever it runs.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    PasswordService,
    TokenService,
    PrincipalService,
    ServiceAccountService,
  ],
  exports: [
    AuthService,
    MfaService,
    PasswordService,
    TokenService,
    PrincipalService,
    ServiceAccountService,
  ],
})
export class AuthModule {}
