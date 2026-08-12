import { z } from 'zod';

import { codeSchema, paginationQuerySchema } from './common';

/**
 * Editable masters for lead sources and products.
 *
 * These replaced two Postgres enums. An enum cannot be extended from an admin
 * screen — `ALTER TYPE` is DDL — so "add a source" used to mean a developer and
 * a deploy, which is why neither list had changed since day one.
 *
 * Three rules keep the change from costing more than it gives.
 *
 * **Shipped rows are permanent.** `isSystem` entries can be relabelled,
 * reweighted and deactivated, but never deleted or re-coded. Scoring,
 * assignment rules and every historical lead point at those codes; a rename
 * would detach a year of reporting from its own history without a single error.
 *
 * **Deactivate, never delete.** A deactivated source disappears from the "Add
 * lead" dropdown and stays readable on every lead that already carries it.
 * Deleting one would either orphan those leads or take them with it.
 *
 * **A new source must state its weight.** The scoring engine has a fallback,
 * but letting a new channel land on it silently means nobody ever decides what
 * a lead from that channel is worth — and the fallback then quietly becomes the
 * policy.
 */

/** Bounds on what one source can contribute to a lead score. */
export const MIN_SOURCE_WEIGHT = 0;
export const MAX_SOURCE_WEIGHT = 25;

export const createLeadSourceSchema = z.object({
  code: codeSchema,
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  scoringWeight: z
    .number()
    .int()
    .min(MIN_SOURCE_WEIGHT)
    .max(MAX_SOURCE_WEIGHT, `Weights run ${MIN_SOURCE_WEIGHT}–${MAX_SOURCE_WEIGHT}`),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});
export type CreateLeadSourceInput = z.infer<typeof createLeadSourceSchema>;

/** The code is absent on purpose — see the note on `isSystem` above. */
export const updateLeadSourceSchema = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  scoringWeight: z.number().int().min(MIN_SOURCE_WEIGHT).max(MAX_SOURCE_WEIGHT).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;

export interface LeadSourceItem {
  id: string;
  code: string;
  label: string;
  description: string | null;
  scoringWeight: number;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  /** Leads already carrying this code — what a deactivation would affect. */
  leadCount: number;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const createProductSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(80),
  summary: z.string().trim().max(300).optional(),
  description: z.string().trim().max(8000).optional(),
  keyBenefits: z.array(z.string().trim().min(2).max(200)).max(12).default([]),
  chargesSummary: z.string().trim().max(600).optional(),
  eligibility: z.string().trim().max(600).optional(),
  riskNote: z.string().trim().max(600).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  summary: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  keyBenefits: z.array(z.string().trim().min(2).max(200)).max(12).optional(),
  chargesSummary: z.string().trim().max(600).nullable().optional(),
  eligibility: z.string().trim().max(600).nullable().optional(),
  riskNote: z.string().trim().max(600).nullable().optional(),
  brochureKey: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export interface ProductItem {
  id: string;
  code: string;
  name: string;
  summary: string | null;
  description: string | null;
  keyBenefits: string[];
  chargesSummary: string | null;
  eligibility: string | null;
  riskNote: string | null;
  brochureKey: string | null;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  /** Open leads expressing interest — context before deactivating. */
  leadCount: number;
}

export const masterQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  /** Inactive rows are hidden unless asked for. */
  includeInactive: z.coerce.boolean().default(false),
});
export type MasterQuery = z.infer<typeof masterQuerySchema>;

/**
 * Whether a master row may be deleted outright.
 *
 * Only a row nobody shipped and nothing references. Everything else deactivates
 * — which is not a lesser action, it is the correct one: the row still explains
 * records that already point at it.
 */
export function canDeleteMasterRow(row: {
  isSystem: boolean;
  leadCount: number;
}): { ok: boolean; reason: string | null } {
  if (row.isSystem) {
    return {
      ok: false,
      reason:
        'This is one of the entries SIHL ONE shipped with. It can be renamed or switched off, ' +
        'but not removed — reports and rules refer to its code.',
    };
  }
  if (row.leadCount > 0) {
    return {
      ok: false,
      reason: `${row.leadCount} ${row.leadCount === 1 ? 'record uses' : 'records use'} this. Switch it off instead, and it will stop appearing on new entries.`,
    };
  }
  return { ok: true, reason: null };
}
