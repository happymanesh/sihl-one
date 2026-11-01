import { z } from 'zod';

/**
 * Permanently destroying a lead.
 *
 * Kept apart from `lead.ts` on purpose. Everything in that file describes a
 * lead moving through the pipeline; this describes taking one out of the
 * system altogether, which is a different kind of act with a different
 * permission behind it, and a reader looking for "what can happen to a lead"
 * should not have to read past it.
 *
 * The shape of the request is the control. A lead id would be the obvious
 * parameter and is the wrong one — an id is copied from a URL and means
 * nothing to the person doing the copying, whereas `LD-2026-000123` is the
 * number on the screen they are looking at. Typing it back is a deliberate act
 * that an id cannot be.
 */

/** `LD-2026-000123` — the prefix, the year the lead was captured, the counter. */
export const LEAD_REFERENCE_PATTERN = /^LD-\d{4}-\d{6}$/;

export const leadReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(24)
  .regex(LEAD_REFERENCE_PATTERN, 'Expected a lead number in the form LD-2026-000123.');

/**
 * Both confirmations, posted with the purge.
 *
 * `confirmReference` repeats the number already in the path. That looks
 * redundant and is the point: the path is filled in by whatever the user
 * clicked, the body is filled in by what they typed, and the server refusing
 * unless the two agree is what makes "are you sure" mean something.
 */
export const purgeLeadSchema = z.object({
  confirmReference: leadReferenceSchema,
  /**
   * Why. Not optional, and not a dropdown — the audit row has to be readable
   * years later by somebody who was not there, and "Other" never is.
   */
  reason: z
    .string()
    .trim()
    .min(20, 'Say why in a sentence — this is the only explanation that survives.')
    .max(300),
});

export type PurgeLeadInput = z.infer<typeof purgeLeadSchema>;

/**
 * What a purge would destroy, counted per table.
 *
 * Returned by the preview before anything happens and recorded in the audit
 * row after, from the same count, so "what did we delete?" is answerable from
 * the trail alone once the rows are gone.
 */
export interface LeadPurgeCounts {
  activities: number;
  activityProductValues: number;
  tasks: number;
  visits: number;
  visitExpenses: number;
  attendees: number;
  documents: number;
  leadProducts: number;
  productApprovals: number;
  statusHistory: number;
  familyMembers: number;
  profile: number;
  consentRecords: number;
  eventAttendances: number;
  presentationBookings: number;
  messageLogs: number;
  mobileOtps: number;
  notifications: number;
  importRows: number;
  outboxEvents: number;
}

/** Rows that point at this lead and are deliberately left standing. */
export interface LeadPurgeRetained {
  /** Other leads merged into this one. Separate records, not this one's to destroy. */
  mergedLeads: number;
  /** The customer this lead converted into, if any. A client with an account. */
  customer: boolean;
  /** Standing refusals to be contacted. Destroying one can only ever harm the person. */
  messageOptOuts: number;
  /** Import rows belonging to other people that merely cite this lead as a duplicate. */
  duplicateCitations: number;
}

export interface LeadPurgePreview {
  leadId: string;
  reference: string;
  /** Masked — the preview is read on a screen, and the purge does not need the real one. */
  name: string;
  mobile: string;
  status: string;
  owner: string | null;
  createdAt: string;
  /** Set when the lead is already soft-deleted. A purge may still be run on it. */
  deletedAt: string | null;
  counts: LeadPurgeCounts;
  retained: LeadPurgeRetained;
  /** Objects in the file store that go with it: documents, selfies, voice notes, receipts. */
  storedFiles: number;
  /** Expense claims are money a rep says they are owed. Shown separately because of it. */
  expenseClaimTotal: string;
}

/** The receipt. The same counts, after the fact, plus what the file store did. */
export interface LeadPurgeResult extends LeadPurgePreview {
  purgedAt: string;
  /** Files the store confirmed gone. A shortfall is named rather than hidden. */
  filesRemoved: number;
  filesFailed: number;
}
