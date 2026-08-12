import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { RequestContextStore } from '../request-context';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

/** Known Prisma error codes we translate rather than leak. */
const PRISMA_CONFLICT_CODES = new Set(['P2002']);
const PRISMA_NOT_FOUND_CODES = new Set(['P2025', 'P2001']);
const PRISMA_FK_CODES = new Set(['P2003', 'P2014']);

/**
 * Single error contract for the whole API: RFC 9457 Problem Details.
 *
 * Two rules that matter more than the format:
 *  - No internal detail crosses the boundary. Stack traces, SQL, constraint
 *    names and Prisma messages stay in the log; the client gets a stable title
 *    and a traceId to quote at support.
 *  - Every 5xx is logged at error with the traceId, so the log line and the
 *    user's screenshot can always be joined.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = RequestContextStore.traceId();

    const problem = this.toProblem(exception, request);
    problem.traceId = traceId;
    problem.instance = request.originalUrl;

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${problem.status} [${traceId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (problem.status === 403 || problem.status === 401) {
      this.logger.warn(
        `${request.method} ${request.originalUrl} -> ${problem.status} [${traceId}] ` +
          `user=${RequestContextStore.user()?.id ?? 'anonymous'}`,
      );
    }

    response.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        return {
          type: `https://docs.sihl.in/errors/${status}`,
          title:
            (typeof record.title === 'string' && record.title) ||
            (typeof record.error === 'string' && record.error) ||
            exception.name,
          status,
          detail:
            (typeof record.detail === 'string' && record.detail) ||
            (typeof record.message === 'string' ? record.message : undefined),
          errors: record.errors as Record<string, string[]> | undefined,
        };
      }

      return {
        type: `https://docs.sihl.in/errors/${status}`,
        title: exception.name,
        status,
        detail: typeof payload === 'string' ? payload : undefined,
      };
    }

    // Prisma known-request errors carry a `code`. Translating the handful that
    // map cleanly to HTTP keeps controllers free of try/catch noise, and stops
    // a raw constraint name (which names our columns) reaching the client.
    const code = (exception as { code?: unknown })?.code;
    if (typeof code === 'string') {
      if (PRISMA_CONFLICT_CODES.has(code)) {
        const target = (exception as { meta?: { target?: string[] } }).meta?.target;
        return {
          type: 'https://docs.sihl.in/errors/conflict',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: this.describeConflict(target),
        };
      }
      if (PRISMA_NOT_FOUND_CODES.has(code)) {
        return {
          type: 'https://docs.sihl.in/errors/not-found',
          title: 'Not found',
          status: HttpStatus.NOT_FOUND,
          detail: 'The requested record does not exist or is not visible to you.',
        };
      }
      if (PRISMA_FK_CODES.has(code)) {
        return {
          type: 'https://docs.sihl.in/errors/conflict',
          title: 'Related record missing or still in use',
          status: HttpStatus.CONFLICT,
          detail: 'The operation references a record that does not exist, or is still referenced.',
        };
      }
    }

    return {
      type: 'https://docs.sihl.in/errors/500',
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: `An unexpected error occurred while processing ${request.method} ${request.originalUrl}.`,
    };
  }

  /**
   * Turns a unique-constraint target into something a user can act on, without
   * revealing the index name. The duplicate-lead index is special-cased because
   * hitting it is a normal, expected outcome that the UI must explain properly.
   */
  private describeConflict(target: string[] | string | undefined): string {
    const fields = Array.isArray(target) ? target : target ? [target] : [];
    const joined = fields.join(', ');

    if (joined.includes('lead_active_mobile_key') || fields.includes('mobile')) {
      return 'An open lead already exists for this mobile number. Add your update to that lead instead of creating a second one.';
    }
    if (joined.includes('lead_active_pan_key') || fields.includes('pan')) {
      return 'An open lead already exists for this PAN.';
    }
    if (fields.includes('email')) {
      return 'That email address is already registered.';
    }
    return 'A record with the same unique details already exists.';
  }
}
