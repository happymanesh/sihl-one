import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';
import { ReferenceService } from './reference.service';
import { ScopeService } from './scope.service';

/**
 * Cross-cutting services every feature module needs. Global so that adding a
 * module does not mean remembering to import four things.
 */
@Global()
@Module({
  providers: [AuditService, OutboxService, ReferenceService, ScopeService],
  exports: [AuditService, OutboxService, ReferenceService, ScopeService],
})
export class CommonModule {}
