import { z } from 'zod';

import { leadProfileSchema } from './lead-profile';
import {
  LEAD_LOST_REASONS,
  LEAD_STATUSES,
  PRIORITIES,
  type DataScope,
  type LeadStatus,
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
  /**
   * The client profile — occupation, income, holdings, family. Entirely
   * optional: a lead usually starts as a name and a number, and the rest
   * arrives over weeks if at all.
   */
  profile: leadProfileSchema.optional(),
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

/**
 * What a rep is told when the number they are typing is already on the book.
 *
 * Two shapes, and the difference is deliberate. If the existing lead is inside
 * the rep's own scope they get the whole picture — who it is, who owns it, when
 * it came in, what they wanted — because that is enough to pick up the phone to
 * a colleague and sort it out.
 *
 * If it is outside their scope they are told only that the number is taken.
 * Naming the client and the owner would hand any rep a lookup tool for the
 * entire firm's book: type a number, learn who holds that relationship. The
 * whole point of the data scopes is that this is not possible, and a duplicate
 * check is exactly the sort of helpful screen that quietly undoes them.
 */
export interface DuplicateLeadMatch {
  exists: boolean;
  /** Whether the caller's scope allows them to see whose lead it is. */
  visible: boolean;
  lead: {
    id: string;
    reference: string;
    name: string;
    status: LeadStatus;
    ownerName: string | null;
    createdAt: string;
    productInterest: string[];
    /** Closed leads are shown too, since reopening one beats creating a twin. */
    isOpen: boolean;
  } | null;
}

export const checkLeadMobileSchema = z.object({
  mobile: indianMobileSchema,
  /** Set when editing, so a lead does not report itself as its own duplicate. */
  excludeLeadId: idSchema.optional(),
});
export type CheckLeadMobileInput = z.infer<typeof checkLeadMobileSchema>;

/**
 * Handing a lead to someone outside your own team.
 *
 * Separate from `assign`, which stays what a manager does inside their team and
 * where a note is optional. A transfer crosses a boundary — another branch,
 * another manager's book — and the question afterwards is always why. Making
 * the reason optional would mean it is usually absent exactly when it matters,
 * so it is required and long enough to be a sentence rather than "ok".
 */
export const transferLeadSchema = z.object({
  ownerId: idSchema,
  reason: z
    .string()
    .trim()
    .min(10, 'Say why this lead is moving — a few words is not enough')
    .max(500),
});
export type TransferLeadInput = z.infer<typeof transferLeadSchema>;

/**
 * Who may move a lead out of their own book.
 *
 * A rep who can only see their own leads cannot hand one to somebody else and
 * quietly lose it from the numbers; anyone with sight of a team or wider can.
 * Expressed against the data scope rather than a role name so a new role does
 * not silently gain or lose it.
 */
export function canTransferLeads(dataScope: DataScope): boolean {
  return dataScope !== 'SELF';
}

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
  /**
   * Product codes. Matching is OR — a lead interested in *any* of the selected
   * products qualifies, which is what people expect from a multi-select filter.
   * "Interested in both" is a different question and would need its own control.
   */
  productInterest: z
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
  /**
   * `false` restricts to leads whose mobile has not been confirmed. This is the
   * view a manager actually wants — the unverified pile — so it has to be
   * reachable in one click rather than by sorting.
   */
  mobileVerified: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
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
  /** Null until someone confirms the number reaches this person. */
  mobileVerifiedAt: string | null;
  mobileVerificationMethod: MobileVerificationMethod | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mobile verification

/**
 * How a rep confirmed the number reaches the person it claims to.
 *
 * Recorded rather than inferred, and deliberately a short closed list: an
 * open text box would fill with "verified", which says nothing a checkbox did
 * not already say. Each value describes a thing that actually happened.
 */
export const MOBILE_VERIFICATION_METHODS = ['CALL', 'IN_PERSON', 'WHATSAPP'] as const;
export type MobileVerificationMethod = (typeof MOBILE_VERIFICATION_METHODS)[number];

export const MOBILE_VERIFICATION_METHOD_LABELS: Record<MobileVerificationMethod, string> = {
  CALL: 'Spoke on this number',
  IN_PERSON: 'Confirmed in person',
  WHATSAPP: 'Confirmed on WhatsApp',
};

export const verifyLeadMobileSchema = z.object({
  method: z.enum(MOBILE_VERIFICATION_METHODS),
  /** Optional context: who answered, where they were met. */
  note: z.string().trim().max(200).optional(),
});
export type VerifyLeadMobileInput = z.infer<typeof verifyLeadMobileSchema>;

/**
 * Whether an edit to a lead invalidates an existing mobile verification.
 *
 * This is the rule the whole feature rests on. Without it a rep verifies the
 * number they really did call, then edits the lead to a different number, and
 * the tick stays — which is precisely the fake-number route the verification
 * was introduced to close, only now with a mark of confidence on it.
 *
 * Comparison ignores spacing and punctuation so that reformatting the same
 * number does not throw away a genuine verification.
 */
export function verificationSurvivesEdit(
  current: string | null | undefined,
  next: string | null | undefined,
): boolean {
  if (next === undefined) return true; // The number was not part of this edit.
  return normaliseMobile(current) === normaliseMobile(next);
}

function normaliseMobile(value: string | null | undefined): string {
  if (!value) return '';
  // Digits only, and only the last ten: +91 98765 43210, 09876543210 and
  // 9876543210 are the same person, and reps type all three.
  const digits = value.replace(/\D/g, '');
  return digits.slice(-10);
}

export type LeadScoreBand = 'COLD' | 'WARM' | 'HOT';

export function scoreBandFor(score: number): LeadScoreBand {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}
