import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { PresentationsController } from './presentations.controller';
import { PresentationsService } from './presentations.service';

/**
 * Global, because the lead capture path issues booking tokens.
 *
 * A visitor proves their number in the leads module and books a seat here, so
 * the token has to be minted where verification happens and honoured where the
 * booking lands.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [PresentationsController],
  providers: [PresentationsService],
  exports: [PresentationsService],
})
export class PresentationsModule {}
