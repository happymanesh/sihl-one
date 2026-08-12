import { z } from 'zod';

import { PARTNER_STATUSES, PARTNER_TYPES } from './enums';
import {
  emailSchema,
  indianMobileSchema,
  paginationQuerySchema,
  panSchema,
  pincodeSchema,
} from './common';

export const createPartnerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(PARTNER_TYPES),
  contactPerson: z.string().trim().max(120).optional(),
  email: emailSchema,
  mobile: indianMobileSchema,
  pan: panSchema.optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Enter a valid 15-character GSTIN')
    .optional(),
  sebiRegNo: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  status: z.enum(PARTNER_STATUSES).optional(),
});
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export const partnerQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(PARTNER_STATUSES).optional(),
  type: z.enum(PARTNER_TYPES).optional(),
});
export type PartnerQuery = z.infer<typeof partnerQuerySchema>;

/**
 * Partner 360.
 *
 * `business` figures are computed from the CRM's own attribution — leads this
 * partner sourced and what those became. They are **not** settled revenue.
 * Commission is likewise an *estimate*, derived from the agreed rate applied to
 * attributed business value, and is labelled as such everywhere it appears.
 *
 * ADR-0002 is why: brokerage actually earned and payouts actually due are
 * computed by the back office, which is the system of record for money. A
 * partner portal that quietly presents its own arithmetic as an amount payable
 * creates a dispute the day the two disagree.
 */
export interface Partner360 {
  profile: {
    id: string;
    reference: string;
    name: string;
    type: string;
    status: string;
    contactPerson: string | null;
    email: string;
    mobileMasked: string;
    city: string | null;
    state: string | null;
    sebiRegNo: string | null;
    commissionRate: string | null;
    onboardedAt: string | null;
  };
  business: {
    leadsSourced: number;
    leadsOpen: number;
    leadsConverted: number;
    conversionRate: number;
    clientsTotal: number;
    clientsActive: number;
    clientsOnboarding: number;
  };
  /** Every figure here is an estimate from CRM attribution, never settled money. */
  estimatedEarnings: {
    attributedBusinessValue: string;
    commissionRatePercent: string | null;
    estimatedCommission: string | null;
    basis: string;
  };
  activity: {
    leadsLast30: number;
    conversionsLast30: number;
    lastLeadAt: string | null;
  };
  compliance: {
    hasPan: boolean;
    hasGstin: boolean;
    hasSebiRegistration: boolean;
    documentCount: number;
  };
}
