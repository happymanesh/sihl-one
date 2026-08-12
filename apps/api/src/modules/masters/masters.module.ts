import { Global, Module } from '@nestjs/common';

import { MastersController } from './masters.controller';
import { MastersService } from './masters.service';

/** Global: lead writes validate their codes and read scoring weights from here. */
@Global()
@Module({
  controllers: [MastersController],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
