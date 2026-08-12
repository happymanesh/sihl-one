import { z } from 'zod';
import {
  LEAD_LOST_REASONS,
  LEAD_STATUSES,
  PRIORITIES,
} from './enums';
import {
  attributionSchema,
  codeSchema,
  emailSchema,
  idSchema,
  indianMobileSchema,
  panSchema,
  paginationQuerySchema,
  pincodeSchema,
} from './common';

/**
 * Public lead capture — the payload posted by marketing landing pages, the
 * website contact form and partner micro-sites. Intentionally minimal: every
 * extra required field measurably drops conversion, and everything else can be
 * collected during the qualification call.
 */
export const leadCaptureSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().max(60).optional().or(z.literal('')),
  mobile: indianMobileSchema,
  email: emailSchema.optional().or(z.literal('')),
  city: z.string().trim().max(80).optional(),
  productInterest: z.array(codeSchema).max(6).default([]),
  message: z.string().trim().max(1000).optional(),
  source: codeSchema.default('WEBSITE'),
  attribution: attributionSchema.optional(),
  /**
   * Provenance codes from a coded capture link.
   *
   * The *code*, never a resolved id. This endpoint is unauthenticated, so a
   * client-supplied `partnerId` would let anyone attribute someone else's
   * business to themselves. The API resolves the code and decides.
   */
  partnerCode: z.string().trim().max(24).optional(),
  eventCode: z.string().trim().max(60).optional(),
  /** Consent is captured, timestamped and stored — DPDP Act 2023 requirement. */
  consentToContact: z.literal(true, {
    errorMap: () => ({ message: 'Consent is required before we can contact you' }),
  }),
});
export type LeadCaptureInput = z.infer<typeof leadCaptureSchema>;

export const createLeadSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional(),
  mobile: indianMobileSchema,
  email: emailSchema.optional(),
  pan: panSchema.optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  source: codeSchema,
  productInterest: z.array(codeSchema).max(12).default([]),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  estimatedValue: z.number().nonnegative().max(1_000_000_000).optional(),
  ownerId: idSchema.optional(),
  partnerId: idSchema.optional(),
  campaignId: idSchema.optional(),
  attribution: attributionSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().extend({
  status: z.enum(LEAD_STATUSES).optional(),
  lostReason: z.enum(LEAD_LOST_REASONS).optional(),
  lostNote: z.string().trim().max(500).optional(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const changeLeadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
    lostReason: z.enum(LEAD_LOST_REASONS).optional(),
    note: z.string().trim().max(1000).optional(),
    nextFollowUpAt: z.coerce.date().optional(),
  })
  .refine((data) => (data.status === 'LOST' ? Boolean(data.lostReason) : true), {
    message: 'A reason is required when marking a lead as lost',
    path: ['lostReason'],
  });
export type ChangeLeadStatusInput = z.infer<typeof changeLeadStatusSchema>;

export const assignLeadSchema = z.object({
  ownerId: idSchema,
  note: z.string().trim().max(500).optional(),
});
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

export const bulkAssignLeadSchema = z.object({
  leadIds: z.array(idSchema).min(1).max(200),
  ownerId: idSchema,
});
export type BulkAssignLeadInput = z.infer<typeof bulkAssignLeadSchema>;

export const convertLeadSchema = z.object({
  /** Mandatory at conversion — a customer without a PAN cannot be onboarded. */
  pan: panSchema,
  email: emailSchema,
  note: z.string().trim().max(1000).optional(),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const leadQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z
    .union([z.enum(LEAD_STATUSES), z.array(z.enum(LEAD_STATUSES))])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
  source: z
    .union([codeSchema, z.array(codeSchema)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
  priority: z.enum(PRIORITIES).optional(),
  ownerId: idSchema.optional(),
  partnerId: idSchema.optional(),
  campaignId: idSchema.optional(),
  /** `true` restricts to leads whose follow-up date has passed. */
  overdueOnly: z.coerce.boolean().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
});
export type LeadQuery = z.infer<typeof leadQuerySchema>;

export interface LeadListItem {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  mobileMasked: string;
  email: string | null;
  city: string | null;
  status: (typeof LEAD_STATUSES)[number];
  source: string;
  priority: (typeof PRIORITIES)[number];
  productInterest: string[];
  score: number;
  scoreBand: LeadScoreBand;
  estimatedValue: string | null;
  owner: { id: string; fullName: string } | null;
  partner: { id: string; name: string } | null;
  nextFollowUpAt: string | null;
  isOverdue: boolean;
  lastActivityAt: string | null;
  createdAt: string;
}

export type LeadScoreBand = 'COLD' | 'WARM' | 'HOT';

export function scoreBandFor(score: number): LeadScoreBand {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}
