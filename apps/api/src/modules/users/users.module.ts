import { Module } from '@nestjs/common';

import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';

@Module({
  // For MfaService — the admin reset lives on the user screen, not in auth.
  imports: [AuthModule],
  controllers: [UsersController, UserAdminController],
  providers: [UsersService, UserAdminService],
  exports: [UsersService, UserAdminService],
})
export class UsersModule {}
