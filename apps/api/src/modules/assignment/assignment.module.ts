import { Global, Module } from '@nestjs/common';

import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

/** Global: import, event capture and offboarding all route through this engine. */
@Global()
@Module({
  controllers: [AssignmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
