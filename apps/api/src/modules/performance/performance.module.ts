import { Global, Module } from '@nestjs/common';

import { AllocationService } from './allocation.service';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

/** Global: lead assignment advances the development rotation from here. */
@Global()
@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService, AllocationService],
  exports: [PerformanceService, AllocationService],
})
export class PerformanceModule {}
