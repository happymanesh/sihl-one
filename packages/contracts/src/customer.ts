import { z } from 'zod';
import {
  CUSTOMER_STATUSES,
  KYC_STATUSES,
  ONBOARDING_STAGES,
} from './enums';
import {
  codeSchema,
  emailSchema,
  idSchema,
  indianMobileSchema,
  paginationQuerySchema,
  panSchema,
  pincodeSchema,
} from './common';

export const createCustomerSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional(),
  email: emailSchema,
  mobile: indianMobileSchema,
  pan: panSchema,
  dateOfBirth: z.coerce.date().optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  relationshipManagerId: idSchema.optional(),
  partnerId: idSchema.optional(),
  productInterest: z.array(codeSchema).max(12).default([]),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  kycStatus: z.enum(KYC_STATUSES).optional(),
  onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/**
 * Which product relationship a filter is asking about.
 *
 * A customer has two, and they answer different questions. Filtering by "PMS"
 * without saying which produces three plausible result sets, and a rep who gets
 * the wrong one concludes the filter is broken.
 *
 * `opportunity` is the default because it is the actionable list: wants it,
 * does not hold it. Pitching a client something they already own is the mistake
 * this exists to prevent.
 */
export const PRODUCT_DIMENSIONS = ['opportunity', 'interested', 'holds'] as const;
export type ProductDimension = (typeof PRODUCT_DIMENSIONS)[number];

export const customerQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  kycStatus: z.enum(KYC_STATUSES).optional(),
  onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
  relationshipManagerId: idSchema.optional(),
  partnerId: idSchema.optional(),
  /** Product codes. Matching is OR, as on leads. */
  productInterest: z
    .union([codeSchema, z.array(codeSchema)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
  productDimension: z.enum(PRODUCT_DIMENSIONS).default('opportunity'),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

/**
 * Customer 360 — the single screen the brief asks for. Assembled by the API
 * from several aggregates so the client makes one call, not nine.
 */
export interface Customer360 {
  profile: {
    id: string;
    reference: string;
    fullName: string;
    email: string;
    mobileMasked: string;
    panMasked: string;
    city: string | null;
    state: string | null;
    status: string;
    createdAt: string;
  };
  onboarding: {
    kycStatus: string;
    onboardingStage: string;
    stageCompletedAt: string | null;
    accountOpenedAt: string | null;
    activatedAt: string | null;
    /** 0–100, derived from position in ONBOARDING_STAGES. */
    progressPercent: number;
  };
  relationship: {
    relationshipManager: { id: string; fullName: string; email: string } | null;
    partner: { id: string; name: string; type: string } | null;
    orgUnit: { id: string; name: string } | null;
  };
  acquisition: {
    leadId: string | null;
    leadReference: string | null;
    source: string | null;
    campaign: { id: string; name: string } | null;
    convertedAt: string | null;
  };
  holdings: Array<{
    product: string;
    status: string;
    openedAt: string | null;
    value: string | null;
  }>;
  engagement: {
    totalActivities: number;
    lastActivityAt: string | null;
    openTasks: number;
    lastVisitAt: string | null;
  };
  insights: Array<{ code: string; title: string; detail: string; severity: 'INFO' | 'WARN' | 'RISK' }>;
}

/** Percentage progress through onboarding, derived from the stage ordinal. */
export function onboardingProgress(stage: string): number {
  const index = (ONBOARDING_STAGES as readonly string[]).indexOf(stage);
  if (index < 0) return 0;
  return Math.round((index / (ONBOARDING_STAGES.length - 1)) * 100);
}
