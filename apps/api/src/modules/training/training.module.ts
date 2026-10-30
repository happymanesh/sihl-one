import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

/** Training sessions. Independent of Test by design — see the schema notes. */
@Module({
  imports: [StorageModule],
  controllers: [TrainingController],
  providers: [TrainingService],
  exports: [TrainingService],
})
export class TrainingModule {}
