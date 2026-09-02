import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction } from '@sihl-one/contracts';

import { PrismaService } from '../prisma/prisma.service';
import { RequestContextStore } from './request-context';

export interface AuditEntry {
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  /**
   * Who did it, when the request context cannot say.
   *
   * Sign-in is the case: the audit row is written *while* authenticating, so
   * there is no authenticated principal on the request yet and the trail would
   * otherwise attribute every login to "the system".
   */
  actor?: { id: string; fullName: string; email: string; isService?: boolean } | null;
}

/**
 * Field names whose values must never reach the audit table. The audit trail is
 * read by more people than the source tables are — support, compliance, internal
 * audit — so writing a full PAN or a password hash into it quietly widens who
 * can see that data.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'refreshToken',
  'accessToken',
  'mfaSecret',
  'pan',
  'dateOfBirth',
  'checkInPhotoKey',
]);

/** Fields kept but masked, because "which mobile changed" is a real audit need. */
const MASKED_FIELDS = new Set(['mobile', 'email']);

function maskValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

export function sanitiseForAudit(input: unknown, depth = 0): unknown {
  if (depth > 4 || input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => sanitiseForAudit(item, depth + 1));
  if (typeof input !== 'object') return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key)) {
      output[key] = '[redacted]';
    } else if (MASKED_FIELDS.has(key)) {
      output[key] = maskValue(value);
    } else if (value && typeof value === 'object') {
      output[key] = sanitiseForAudit(value, depth + 1);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * Computes a field-level diff. Storing only what changed keeps the audit table
 * an order of magnitude smaller than storing whole rows, and makes "what did
 * this person actually change" answerable at a glance.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> | null {
  if (!before || !after) return null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt') continue;
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    const sanitise = (value: unknown): unknown =>
      (sanitiseForAudit({ [key]: value }) as Record<string, unknown>)[key];

    changes[key] = { from: sanitise(from), to: sanitise(to) };
  }

  return Object.keys(changes).length ? changes : null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit row.
   *
   * Never throws. An audit write failing must not fail the business operation
   * the user asked for — but it must be screamed about in the logs, because a
   * silently empty audit trail is a compliance finding.
   */
  async record(entry: AuditEntry): Promise<void> {
    const context = RequestContextStore.get();
    const user = entry.actor ?? context?.user;

    // A service account is a real actor but not a row in `app_user`, and
    // `actorId` is a foreign key into that table. Writing the key's id there
    // would violate the constraint and — because this method deliberately never
    // throws — the failure would surface as a silently missing audit row.
    // The label carries the attribution instead.
    const isService = user?.isService === true;

    if (entry.action === 'EXPORT' && user && !isService) {
      // Fire and forget — an alert must never delay or fail the audit write it
      // decorates. Skipped for services: the notice-period check looks the actor
      // up in `app_user`, where a key does not exist. Services cannot hold an
      // export permission in any case.
      void this.flagIfInNoticePeriod(user.id, user.fullName, entry);
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: isService ? null : (user?.id ?? null),
          actorLabel: user ? `${user.fullName} <${user.email}>` : null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          changes: (entry.changes ? sanitiseForAudit(entry.changes) : null) as never,
          reason: entry.reason ?? null,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent?.slice(0, 400) ?? null,
          traceId: context?.traceId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED action=${entry.action} resource=${entry.resource} ` +
          `id=${entry.resourceId ?? '-'} trace=${context?.traceId ?? '-'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Raises the visibility of a data export by someone serving notice.
   *
   * A departing salesperson exporting the book is the most common data-loss
   * event in a broking business, and it is difficult to prevent without also
   * preventing them doing their job — they are still employed and exports are
   * a legitimate part of the role. So the control is detective rather than
   * preventive: the export proceeds, and it is made loud.
   *
   * This is the hook a real alerting pipeline attaches to; today it is a
   * WARN log plus a dedicated audit row, which is enough for the SOC to pick
   * up once log aggregation is wired (see the production checklist).
   */
  private async flagIfInNoticePeriod(
    userId: string,
    fullName: string,
    entry: AuditEntry,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { noticePeriodFrom: true },
      });
      if (!user?.noticePeriodFrom) return;

      this.logger.warn(
        `EXPORT BY USER IN NOTICE PERIOD — ${fullName} (${userId}) exported ` +
          `${entry.resource}. Notice began ${user.noticePeriodFrom.toISOString()}.`,
      );

      await this.prisma.auditLog.create({
        data: {
          actorId: userId,
          actorLabel: fullName,
          action: 'EXPORT',
          resource: 'security.export_during_notice',
          resourceId: entry.resourceId ?? null,
          changes: {
            exportedResource: entry.resource,
            noticePeriodFrom: user.noticePeriodFrom.toISOString(),
          } as never,
          reason: 'Export performed by a user serving notice',
          traceId: RequestContextStore.traceId(),
        },
      });
    } catch (error) {
      this.logger.error('Notice-period export check failed', String(error));
    }
  }
}
