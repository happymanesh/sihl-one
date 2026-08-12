import { z } from 'zod';

import { idSchema } from './common';
import type { MatchSignal } from './matching';

/**
 * Merging two lead records for the same person.
 *
 * Distinct from what the importer does. At import time a definite match is
 * **skipped** — the incumbent record and its owner win, and nothing changes.
 * That is right for a bulk operation nobody is watching. This file covers the
 * other case: a human has looked at two records, decided they are one person,
 * and asked for them to become one record.
 *
 * Three rules run through everything below.
 *
 * **Nothing is deleted.** The duplicate is closed and points at the survivor.
 * A lead is a record of a person who spoke to SIHL, and a merge that erases one
 * erases the evidence of that conversation along with it.
 *
 * **A merge only ever adds.** A field already filled on the survivor is never
 * overwritten by the duplicate's version. Silently replacing a mobile number
 * that somebody confirmed on a call is the one failure nobody would catch.
 *
 * **Conflicts are surfaced, not resolved.** Where both records hold a different
 * non-empty value, the merge keeps the survivor's and reports the discarded one
 * so it can be checked. Picking a winner automatically is how the wrong PAN
 * ends up on an account.
 */

/** Fields a merge can fill in on the survivor. */
export const MERGEABLE_FIELDS = [
  'lastName',
  'email',
  'pan',
  'city',
  'state',
  'pincode',
  'estimatedValue',
  'partnerId',
  'campaignId',
  'eventId',
] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export const MERGEABLE_FIELD_LABELS: Record<MergeableField, string> = {
  lastName: 'Last name',
  email: 'Email',
  pan: 'PAN',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  estimatedValue: 'Estimated value',
  partnerId: 'Sourcing partner',
  campaignId: 'Campaign',
  eventId: 'Event',
};

export interface MergeableRecord {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  ownerId?: string | null;
  ownerName?: string | null;
  mergedIntoId?: string | null;
  customerId?: string | null;
  activityCount?: number;
  [field: string]: unknown;
}

export interface MergeFieldOutcome {
  field: MergeableField;
  label: string;
  /** What the survivor ends up with. */
  value: unknown;
  /** Set when the duplicate held a different non-empty value that was kept out. */
  discarded?: unknown;
  /** The survivor gained this from the duplicate. */
  gained: boolean;
}

export interface MergePreview {
  fields: MergeFieldOutcome[];
  /** Values the duplicate held that the survivor keeps instead. */
  conflicts: MergeFieldOutcome[];
  /** Filled in on the survivor because it had nothing there. */
  gains: MergeFieldOutcome[];
}

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '';

/**
 * Works out what the survivor looks like afterwards.
 *
 * Pure, so the preview a reviewer approves and the write that follows are
 * computed by the same function. A preview produced by different code from the
 * write is a preview that eventually lies.
 */
export function previewMerge(
  survivor: MergeableRecord,
  duplicate: MergeableRecord,
): MergePreview {
  const fields: MergeFieldOutcome[] = [];

  for (const field of MERGEABLE_FIELDS) {
    const mine = survivor[field];
    const theirs = duplicate[field];

    if (isEmpty(theirs)) {
      fields.push({ field, label: MERGEABLE_FIELD_LABELS[field], value: mine, gained: false });
      continue;
    }

    if (isEmpty(mine)) {
      // The whole point of a merge: the survivor picks up what it was missing.
      fields.push({ field, label: MERGEABLE_FIELD_LABELS[field], value: theirs, gained: true });
      continue;
    }

    const same = String(mine) === String(theirs);
    fields.push({
      field,
      label: MERGEABLE_FIELD_LABELS[field],
      value: mine,
      gained: false,
      ...(same ? {} : { discarded: theirs }),
    });
  }

  return {
    fields,
    conflicts: fields.filter((outcome) => outcome.discarded !== undefined),
    gains: fields.filter((outcome) => outcome.gained),
  };
}

export interface MergeEligibility {
  ok: boolean;
  reason: string | null;
}

/**
 * Whether these two can be merged at all.
 *
 * The converted case is the one that matters. A converted lead has a Customer
 * hanging off it, and that customer may already be in the back office with a
 * client code. Folding it into another lead would orphan the account, so a
 * converted record can only ever be the survivor.
 */
export function canMergeLeads(
  survivor: MergeableRecord,
  duplicate: MergeableRecord,
): MergeEligibility {
  if (survivor.id === duplicate.id) {
    return { ok: false, reason: 'A lead cannot be merged into itself.' };
  }
  if (survivor.mergedIntoId) {
    return { ok: false, reason: `${survivor.reference} has already been merged into another lead.` };
  }
  if (duplicate.mergedIntoId) {
    return { ok: false, reason: `${duplicate.reference} has already been merged into another lead.` };
  }
  if (duplicate.status === 'CONVERTED' || duplicate.customerId) {
    return {
      ok: false,
      reason: `${duplicate.reference} has already been converted to a customer, so it cannot be merged away. Merge the other record into this one instead.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Which of the two should survive, when the reviewer has no preference.
 *
 * The converted record if there is one, then the one with a customer, then the
 * one with more history, then the older. History first because that is what a
 * merge is protecting: the record somebody has actually worked is the one whose
 * timeline should stay intact and whose owner has the relationship.
 */
export function suggestSurvivor(
  a: MergeableRecord,
  b: MergeableRecord,
): { survivor: MergeableRecord; duplicate: MergeableRecord; because: string } {
  const pick = (
    survivor: MergeableRecord,
    duplicate: MergeableRecord,
    because: string,
  ) => ({ survivor, duplicate, because });

  if (a.status === 'CONVERTED' && b.status !== 'CONVERTED') {
    return pick(a, b, 'It has already been converted to a customer.');
  }
  if (b.status === 'CONVERTED' && a.status !== 'CONVERTED') {
    return pick(b, a, 'It has already been converted to a customer.');
  }

  const aActivity = a.activityCount ?? 0;
  const bActivity = b.activityCount ?? 0;
  if (aActivity !== bActivity) {
    return aActivity > bActivity
      ? pick(a, b, `It has more recorded history (${aActivity} interactions).`)
      : pick(b, a, `It has more recorded history (${bActivity} interactions).`);
  }

  return a.createdAt <= b.createdAt
    ? pick(a, b, 'It is the older record.')
    : pick(b, a, 'It is the older record.');
}

export const mergeLeadsSchema = z.object({
  /** The record that survives and keeps its owner. */
  survivorId: idSchema,
  duplicateId: idSchema,
  /**
   * Mandatory and audited. A merge changes who owns a relationship and closes a
   * record somebody may have been working, so it should be a decision that can
   * be accounted for rather than a button that looks harmless.
   */
  reason: z.string().trim().min(5, 'Record why these are the same person').max(300),
});
export type MergeLeadsInput = z.infer<typeof mergeLeadsSchema>;

export const duplicateQuerySchema = z.object({
  /** Which identity key produced the group. */
  key: z.enum(['MOBILE', 'EMAIL', 'PAN', 'ANY']).default('ANY'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type DuplicateQuery = z.infer<typeof duplicateQuerySchema>;

export interface DuplicateGroup {
  /** Masked for display — the raw key is never returned to the browser. */
  keyLabel: string;
  key: 'MOBILE' | 'EMAIL' | 'PAN';
  leads: Array<{
    id: string;
    reference: string;
    fullName: string;
    mobileMasked: string;
    email: string | null;
    status: string;
    score: number;
    owner: { id: string; fullName: string } | null;
    createdAt: string;
    activityCount: number;
    customerId: string | null;
  }>;
  /** Why these were grouped, in the reviewer's language. */
  signals: MatchSignal[];
  suggestedSurvivorId: string;
  suggestedBecause: string;
}
