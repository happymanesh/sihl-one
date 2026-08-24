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
export function rollUpLeadStatus(
  productStatuses: readonly LeadProductStatus[],
): LeadStatus | null {
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
}
