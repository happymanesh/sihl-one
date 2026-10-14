import { z } from 'zod';

import { LEAD_LOST_REASONS, LEAD_STATUSES, type LeadStatus } from './enums';
import { codeSchema, idSchema } from './common';

/**
 * A lead's interest in one product, with its own outcome.
 *
 * The change the national sales head asked for. Somebody interested in equity,
 * F&O and mutual funds does not close all three on the same day: equity might
 * convert this week, F&O next month, and mutual funds never. A single status on
 * the lead forced all of that into one word, so a rep either marked the lead
 * converted and lost sight of the other two, or left it open and the conversion
 * went unrecorded.
 *
 * A product carries the same statuses a lead does, deliberately. Two vocabularies
 * for the same journey would be one more thing to explain and to keep aligned.
 */
export const LEAD_PRODUCT_STATUSES = LEAD_STATUSES;
export type LeadProductStatus = LeadStatus;

/** Still in play. Everything else is an outcome that has been reached. */
export const OPEN_LEAD_PRODUCT_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
] as const satisfies readonly LeadProductStatus[];

export function isOpenLeadProductStatus(status: LeadProductStatus): boolean {
  return (OPEN_LEAD_PRODUCT_STATUSES as readonly string[]).includes(status);
}

/**
 * How far along an open product is. Only meaningful for open statuses; closed
 * ones are ranked below everything so they never win the roll-up while work
 * remains.
 */
const ADVANCEMENT: Record<LeadProductStatus, number> = {
  PROPOSAL: 4,
  QUALIFIED: 3,
  CONTACTED: 2,
  NEW: 1,
  CONVERTED: 0,
  LOST: 0,
  DISQUALIFIED: 0,
};

/**
 * The lead's own status, derived from its products.
 *
 * Stored rather than computed on read — the pipeline groups and counts by it,
 * and a derived column that every query has to recompute is a table scan
 * waiting to happen. Recomputed on every product change so the two cannot
 * drift; this function is the single definition of how.
 *
 * While anything is open the lead reflects the furthest-advanced open product,
 * because that is the answer to "how close is this to business". Once nothing
 * is open the lead takes the best outcome reached: a client who bought equity
 * and declined the rest converted, and reporting them as lost would be wrong.
 */
export function rollUpLeadStatus(productStatuses: readonly LeadProductStatus[]): LeadStatus | null {
  // No products is not the same as no interest — plenty of leads are a name and
  // a number for a week. Null means "leave the lead's own status alone".
  if (productStatuses.length === 0) return null;

  const open = productStatuses.filter(isOpenLeadProductStatus);
  if (open.length > 0) {
    return open.reduce((furthest, status) =>
      ADVANCEMENT[status] > ADVANCEMENT[furthest] ? status : furthest,
    );
  }

  if (productStatuses.includes('CONVERTED')) return 'CONVERTED';
  if (productStatuses.includes('LOST')) return 'LOST';
  return 'DISQUALIFIED';
}

/**
 * Whether converting this product should also create the customer record.
 *
 * The first conversion does; later ones attach to the customer already made.
 * One client is one customer however many products they eventually take, and
 * creating a second record on the second product would split their history in
 * exactly the place it matters.
 */
export function shouldCreateCustomer(
  existingCustomerId: string | null,
  productStatuses: readonly LeadProductStatus[],
): boolean {
  if (existingCustomerId) return false;
  return !productStatuses.includes('CONVERTED');
}

export const changeLeadProductStatusSchema = z
  .object({
    productCode: codeSchema,
    status: z.enum(LEAD_PRODUCT_STATUSES),
    lostReason: z.enum(LEAD_LOST_REASONS).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((data) => (data.status === 'LOST' ? Boolean(data.lostReason) : true), {
    message: 'A reason is required when marking a product as lost',
    path: ['lostReason'],
  });
export type ChangeLeadProductStatusInput = z.infer<typeof changeLeadProductStatusSchema>;

export const setLeadProductsSchema = z.object({
  leadId: idSchema,
  productCodes: z.array(codeSchema).max(12),
});
export type SetLeadProductsInput = z.infer<typeof setLeadProductsSchema>;

export interface LeadProductView {
  productCode: string;
  productName: string | null;
  status: LeadProductStatus;
  isOpen: boolean;
  lostReason: string | null;
  closedAt: string | null;
  updatedAt: string;

  /**
   * What the rep typed when they recorded the outcome.
   *
   * Held on the row all along and never surfaced, so the note a rep wrote at
   * the moment of the decision was only readable by scrolling the timeline —
   * which is where "why did we lose this" goes to die.
   */
  note: string | null;

  /** What the client actually put in. Null unless converted. A rupee string. */
  finalAmount: string | null;
  /** The PAN or client code the conversion was recorded against. */
  conversionRef: string | null;
  conversionRefKind: string | null;

  /**
   * The lead product owner — who is working this product.
   *
   * Null when nobody has been named for it specifically, in which case the
   * lead's own owner answers for it. The screen says so rather than showing a
   * blank, because "nobody" and "the lead owner" are different answers.
   */
  owner: { id: string; fullName: string; designation: string | null; branch: string | null } | null;
  /** When it was handed to that person, for the history. */
  assignedAt: string | null;

  /**
   * Whether a client can take this product more than once, from the master.
   *
   * Carried on the row so the screen can warn without a second lookup.
   */
  isRecurring: boolean;
  /**
   * This client already holds this product, from the customer record.
   *
   * Only meaningful once the lead is linked to a customer — before that there
   * is no client to have a history. Paired with `isRecurring` it is the whole
   * of the one-time warning, and it warns: a second account for a spouse or a
   * reopened folio are real, and the rep in front of the client knows which
   * this is.
   */
  clientAlreadyHolds: boolean;

  /**
   * Sign-off on what was committed, when one has been asked for.
   *
   * Visible to everybody who can see the lead — "pending approval" is a thing
   * the next person to pick this up needs to know, not only the person who
   * raised it.
   */
  approval: LeadProductApprovalView | null;
}

/**
 * Whether this product on this lead is the viewer's to act on.
 *
 * One definition, used by the API guards and by the screens that decide what to
 * render, because two of them would drift and the drift shows up as a button
 * that refuses.
 *
 * A product is yours when you hold it. A product nobody holds falls to the
 * lead's own owner, which is the rule the rest of the product already follows —
 * the lead owner answers for anything nobody has been named for. A super
 * administrator acts on anything.
 *
 * Note what this is *not*: being the lead owner does not give you a product
 * somebody else is working. That was the old whole-lead behaviour and it is
 * what per-product ownership exists to stop.
 */
export function ownsLeadProduct(
  viewer: { id: string; isSuperAdmin: boolean },
  product: { ownerId: string | null },
  leadOwnerId: string | null,
): boolean {
  if (viewer.isSuperAdmin) return true;
  if (product.ownerId) return product.ownerId === viewer.id;
  return leadOwnerId !== null && leadOwnerId === viewer.id;
}

// ---------------------------------------------------------------------------
// Commitment approval
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** How long a reminder has to wait. One a day, so a nudge stays a nudge. */
export const APPROVAL_REMINDER_INTERVAL_HOURS = 24;

/**
 * Whether a reminder may be sent for this request right now.
 *
 * Decided here rather than in the button, because a disabled button is a
 * courtesy and the rule has to hold against a second tab, a stale page and a
 * direct call. `now` is passed in so the same function answers for the server
 * and for the screen without either reading its own clock.
 */
export function canRemindApproval(
  approval: { status: ApprovalStatus; lastReminderAt: string | null },
  now: Date,
): boolean {
  if (approval.status !== 'PENDING') return false;
  if (!approval.lastReminderAt) return true;
  const since = now.getTime() - new Date(approval.lastReminderAt).getTime();
  return since >= APPROVAL_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000;
}

export const requestApprovalSchema = z.object({
  productCode: codeSchema,
  /** What was committed. Carried from the remarks the rep just typed. */
  note: z.string().trim().max(1000).optional(),
});
export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

/** A nudge names only the product; everything else is already on the record. */
export const remindApprovalSchema = z.object({ productCode: codeSchema });
export type RemindApprovalInput = z.infer<typeof remindApprovalSchema>;

export const decideApprovalSchema = z
  .object({
    productCode: codeSchema,
    decision: z.enum(['APPROVED', 'REJECTED']),
    /** Required on a refusal: "no" without a reason cannot be acted on. */
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((input) => input.decision !== 'REJECTED' || Boolean(input.reason), {
    message: 'Give a reason for refusing',
    path: ['reason'],
  });
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export interface LeadProductApprovalView {
  status: ApprovalStatus;
  requestedBy: { id: string; fullName: string };
  approver: { id: string; fullName: string };
  requestNote: string | null;
  decisionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  lastReminderAt: string | null;
  /** Null when the email went, a short reason when it did not. */
  emailNote: string | null;
}

/**
 * Assigning one product on a lead.
 *
 * Separate from `assignLeadSchema`, which moves the lead as a whole. Once a
 * lead has products, work is handed over a product at a time — a client's
 * broking business and their wealth business are two conversations with two
 * desks, and one owner for both was the thing sales asked us to stop doing.
 */
export const assignLeadProductSchema = z.object({
  productCode: codeSchema,
  /** Null hands the product back, so the lead's own owner answers for it again. */
  ownerId: idSchema.nullable(),
  note: z.string().trim().max(500).optional(),
});
export type AssignLeadProductInput = z.infer<typeof assignLeadProductSchema>;

/**
 * Assigning every product on a lead to one person, in a single act.
 *
 * A shortcut, not a different rule: it writes the same per-product owner to
 * each row. Without it, handing a whole lead over means as many clicks as the
 * client has products, which is where people stop bothering.
 */
export const assignAllLeadProductsSchema = z.object({
  ownerId: idSchema,
  note: z.string().trim().max(500).optional(),
});
export type AssignAllLeadProductsInput = z.infer<typeof assignAllLeadProductsSchema>;

/**
 * How far back the Closed column reaches.
 *
 * Closed work is unbounded — every lost product since launch — so the column
 * needs a window or it becomes a list nobody scrolls.
 *
 * Rolling days, not calendar months. "Last month" was the first wording and it
 * was ambiguous in the worst way: to a reader it means the previous calendar
 * month, so on 24 August it sounds like July. It actually meant the preceding
 * thirty-odd days. Nobody would notice the difference until they reconciled a
 * count against a report, which is exactly when it costs something.
 *
 * A day count says what it does and needs no month arithmetic, which also
 * disposes of the end-of-month clamping the previous version needed.
 */
export const CLOSED_PERIODS = ['30D', '60D', '90D'] as const;
export type ClosedPeriod = (typeof CLOSED_PERIODS)[number];

export const CLOSED_PERIOD_LABELS: Record<ClosedPeriod, string> = {
  '30D': 'Last 30 days',
  '60D': 'Last 60 days',
  '90D': 'Last 90 days',
};

const PERIOD_DAYS: Record<ClosedPeriod, number> = { '30D': 30, '60D': 60, '90D': 90 };

/** The default: the question is usually "what closed recently". */
export const DEFAULT_CLOSED_PERIOD: ClosedPeriod = '30D';

/**
 * The earliest closing time the Closed column should show.
 *
 * Measured back from the moment it is called, not from midnight. A column that
 * silently redrew itself at 00:00 would change its own count while somebody was
 * looking at it.
 */
export function closedSince(period: ClosedPeriod, now: Date = new Date()): Date {
  return new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
}

export function isClosedPeriod(value: unknown): value is ClosedPeriod {
  return typeof value === 'string' && (CLOSED_PERIODS as readonly string[]).includes(value);
}
