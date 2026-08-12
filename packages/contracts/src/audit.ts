import { z } from 'zod';

import { AUDIT_ACTIONS } from './enums';
import { idSchema, paginationQuerySchema } from './common';

/**
 * Reading the audit trail.
 *
 * The trail is append-only by design — there is no update or delete path in the
 * application and the runtime database role holds INSERT and SELECT only on the
 * table. So this file describes reads and nothing else; there is deliberately no
 * `updateAuditSchema` for anyone to reach for.
 *
 * Values were already redacted or masked on the way in (`sanitiseForAudit`).
 * Nothing here un-masks them: the trail is read by more people than the source
 * tables are — support, compliance, internal audit — and re-widening it at read
 * time would defeat the point of narrowing it at write time.
 */

/** Resources worth offering as a filter. Free text still works for the rest. */
export const AUDITABLE_RESOURCES = [
  'lead',
  'customer',
  'partner',
  'user',
  'visit',
  'document',
  'campaign',
  'task',
  'activity',
  'auth',
  'sales_target',
  'assignment_rule',
  'lead_import',
  'performance.scorecard',
  'security.export_during_notice',
] as const;
export type AuditableResource = (typeof AUDITABLE_RESOURCES)[number];

export const auditQuerySchema = paginationQuerySchema.extend({
  /** Matches the actor label, resource and resource id. */
  q: z.string().trim().max(120).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  resource: z.string().trim().max(60).optional(),
  resourceId: z.string().trim().max(64).optional(),
  actorId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Security-relevant entries only: failed logins, permission denials, exports
   * and the notice-period export flag. The single most common reason anyone
   * opens this screen, and tedious to assemble by hand from four filters.
   */
  securityOnly: z.coerce.boolean().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Actions that belong in the security view. */
export const SECURITY_AUDIT_ACTIONS = [
  'LOGIN_FAILED',
  'PERMISSION_DENIED',
  'EXPORT',
  'DELETE',
] as const;

export interface AuditChange {
  from: unknown;
  to: unknown;
}

export interface AuditEntryView {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actor: { id: string; fullName: string } | null;
  /** Snapshot taken at write time, so it survives the actor being deleted. */
  actorLabel: string | null;
  changes: Record<string, AuditChange> | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  traceId: string | null;
  createdAt: string;
  /** Plain-language line for the timeline. */
  summary: string;
  isSecurityRelevant: boolean;
}

const ACTION_VERBS: Record<string, string> = {
  CREATE: 'created',
  READ: 'read',
  UPDATE: 'updated',
  DELETE: 'deleted',
  LOGIN: 'signed in',
  LOGIN_FAILED: 'failed to sign in',
  LOGOUT: 'signed out',
  ASSIGN: 'reassigned',
  EXPORT: 'exported',
  STATUS_CHANGE: 'changed the status of',
  PERMISSION_DENIED: 'was denied access to',
};

/** SCREAMING_SNAKE or dotted resource → readable noun. */
function readableResource(resource: string): string {
  return resource.replace(/[._]/g, ' ').toLowerCase();
}

/** "a lead", "an audit log". Vowel test only — no resource name needs more. */
function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? 'an' : 'a';
}

/**
 * One sentence describing what happened.
 *
 * Built here rather than in the UI so the API, an export and any future alert
 * pipeline all describe the same row identically. An audit trail where two
 * readers get different wording for the same event is one nobody trusts.
 */
export function summariseAuditEntry(entry: {
  action: string;
  resource: string;
  resourceId?: string | null;
  actorLabel?: string | null;
  changes?: Record<string, AuditChange> | null;
}): string {
  const actor = entry.actorLabel?.split(' <')[0] ?? 'The system';
  const verb = ACTION_VERBS[entry.action] ?? entry.action.toLowerCase();
  const noun = readableResource(entry.resource);

  if (entry.action === 'LOGIN' || entry.action === 'LOGOUT' || entry.action === 'LOGIN_FAILED') {
    return `${actor} ${verb}.`;
  }

  // A denial names the permission, which is the only part anyone acts on.
  if (entry.action === 'PERMISSION_DENIED') {
    return entry.resourceId
      ? `${actor} was denied ${entry.resourceId}.`
      : `${actor} was denied an action they lack permission for.`;
  }

  const fieldCount = entry.changes ? Object.keys(entry.changes).length : 0;
  const fields =
    fieldCount === 0
      ? ''
      : fieldCount <= 3
        ? ` (${Object.keys(entry.changes!).join(', ')})`
        : ` (${fieldCount} fields)`;

  return `${actor} ${verb} ${article(noun)} ${noun}${fields}.`;
}

export function isSecurityRelevant(action: string, resource: string): boolean {
  return (
    (SECURITY_AUDIT_ACTIONS as readonly string[]).includes(action) ||
    resource.startsWith('security.')
  );
}
