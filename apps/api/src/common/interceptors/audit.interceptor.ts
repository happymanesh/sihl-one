import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { AuditService } from '../audit.service';
import { AUDIT_KEY, type AuditMetadata } from '../decorators';

/**
 * Writes an audit row for any route decorated with `@Audited(...)`.
 *
 * Only successful calls are audited here; failures are covered by
 * ProblemDetailsFilter's logging and by the explicit PERMISSION_DENIED write in
 * PermissionsGuard. Auditing attempts that never changed anything would bury
 * the rows that represent real changes.
 *
 * Services that need a before/after diff record it themselves via AuditService,
 * because only they have the prior state. This interceptor is the blanket that
 * guarantees *something* is recorded even when a developer forgets.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap((result) => {
        const resourceId =
          (result as { id?: string })?.id ??
          (request.params as Record<string, string> | undefined)?.id ??
          null;

        // Fire and forget: AuditService swallows its own failures and logs them,
        // so awaiting here would add latency to every audited request for no
        // behavioural benefit.
        void this.audit.record({
          action: metadata.action,
          resource: metadata.resource,
          resourceId,
        });
      }),
    );
  }
}
