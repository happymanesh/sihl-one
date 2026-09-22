import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';

/**
 * Events and coded public capture.
 *
 * Two things share one mechanism here, because they are the same thing wearing
 * different hats: a **code in a URL that says where a lead came from and who it
 * belongs to**. A partner hands their link to a prospective client; a branch
 * prints an event's QR on a banner. Both produce a public capture with
 * provenance attached, and neither should need the person filling the form to
 * be logged in.
 *
 * Codes are resolved **server-side, from the code alone**. The browser never
 * sends a partnerId or an eventId — it sends the code it was given, and the API
 * looks it up. A client-supplied owner id on an unauthenticated endpoint is an
 * open invitation to attribute someone else's business to yourself.
 */

export const EVENT_STATUSES = ['PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * A cancelled or completed event stops accepting captures. The QR on the banner
 * outlives the event by months — someone scanning a poster nobody took down
 * should get a clear "this has ended", not a lead nobody is expecting.
 */
export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  PLANNED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  return EVENT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Whether a scan of this event's QR should be attributed to it.
 *
 * `RUNNING` always counts — somebody opened the event by hand and that is an
 * explicit statement of intent.
 *
 * A `PLANNED` event also counts **while it is actually happening**. This is the
 * difference between a feature that works and one that needs a person to
 * remember something at 9am on a Saturday. The status is flipped manually and
 * nothing flips it back; before this, a two-day event whose organiser forgot
 * would show every visitor "this event has not started yet" and collect
 * nothing, and a team that did remember to open it but not to close it would
 * keep attributing walk-ups to it for months. The dates were already on the
 * record and were being ignored.
 *
 * `COMPLETED` and `CANCELLED` never count, even inside the window: those are
 * deliberate acts by somebody who knows something the calendar does not.
 *
 * The window ends at `endsAt`, or 24 hours after the start when no end was
 * given — a single-day event with no end time should not become a permanent
 * capture channel.
 */
export function eventAcceptsCaptures(
  status: EventStatus,
  schedule?: { startsAt: Date; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (status === 'COMPLETED' || status === 'CANCELLED') return false;
  if (status === 'RUNNING') return true;
  if (!schedule) return false;

  const end = schedule.endsAt ?? new Date(schedule.startsAt.getTime() + 86_400_000);
  return now >= schedule.startsAt && now <= end;
}

/**
 * The code printed on the banner.
 *
 * Lowercase and URL-safe, because it ends up in a path segment and under a QR
 * that nobody can proofread once it is on a two-metre pull-up stand.
 */
export const eventCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens');

export const createEventSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    code: eventCodeSchema,
    venue: z.string().trim().max(200).optional(),
    city: z.string().trim().max(80).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
    expectedFootfall: z.number().int().min(0).max(1_000_000).optional(),
    ownerId: idSchema.optional(),
    orgUnitId: idSchema.optional(),
    campaignId: idSchema.optional(),
  })
  .refine((input) => !input.endsAt || input.endsAt >= input.startsAt, {
    message: 'The end time cannot be before the start time',
    path: ['endsAt'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    name: z.string().trim().min(3).max(160).optional(),
    venue: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    expectedFootfall: z.number().int().min(0).max(1_000_000).nullable().optional(),
    ownerId: idSchema.nullable().optional(),
    campaignId: idSchema.nullable().optional(),
  })
  // The code is not updatable. By the time anyone wants to change it, it is
  // printed on a banner and taped to a table.
  .refine((input) => !input.startsAt || !input.endsAt || input.endsAt >= input.startsAt, {
    message: 'The end time cannot be before the start time',
    path: ['endsAt'],
  });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const changeEventStatusSchema = z.object({ status: z.enum(EVENT_STATUSES) });
export type ChangeEventStatusInput = z.infer<typeof changeEventStatusSchema>;

export const eventQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  city: z.string().trim().max(80).optional(),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;

export interface EventListItem {
  id: string;
  reference: string;
  name: string;
  code: string;
  status: EventStatus;
  venue: string | null;
  city: string | null;
  startsAt: string;
  endsAt: string | null;
  expectedFootfall: number | null;
  owner: { id: string; fullName: string } | null;
  campaign: { id: string; name: string } | null;
  leads: number;
  converted: number;
  createdAt: string;
}

export interface EventDetail extends EventListItem {
  captureUrl: string;
  allowedTransitions: EventStatus[];
  /** Counts by lead status, for the "what happened after" question. */
  pipeline: Array<{ status: string; count: number }>;
  /** How many captured leads nobody has contacted yet. */
  uncontacted: number;

  /** Captured through a rep's personal QR, so somebody is credited. */
  assignedLeads: number;
  /** Captured through the plain banner QR, credited to nobody. */
  unassignedLeads: number;

  /**
   * True when the numbers above are this viewer's own rather than the event's.
   *
   * A rep sees only what their QR brought in; management sees the whole stall.
   * The page has to say which of the two it is showing, or a rep reads four
   * leads and concludes the event was a failure.
   */
  scopedToViewer: boolean;

  /** This viewer's personal capture link, when they have an employee code. */
  myCaptureUrl: string | null;
  myEmployeeCode: string | null;

  /**
   * Everyone who registered at the stall, including clients we already had.
   *
   * Always at least `leads`, and larger whenever an existing client turned up.
   * Kept apart from `leads` because they answer different questions: how many
   * leads the event generated, and how many people we actually met. Counting a
   * client of ten years as a lead this event won would flatter its conversion
   * rate with business it had nothing to do with.
   */
  attended: number;
  /** Of those, the ones already on the book before they arrived. */
  returningAttendees: number;

  conversionRate: number;
}

// ---------------------------------------------------------------------------
// Referral and capture codes
// ---------------------------------------------------------------------------

/**
 * Alphabet for generated partner referral codes.
 *
 * No 0/O, 1/I/L. These codes get read down a phone line and copied off a
 * printout, and a partner losing a referral to a misread character is a
 * commercial dispute, not a typo.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Generates an opaque partner referral code.
 *
 * Random rather than derived from the partner's name or reference: `reference`
 * is sequential (PT-2026-000001), so publishing it would let anyone walk the
 * partner book by incrementing a number.
 *
 * `randomInt` is injected so the caller supplies a cryptographic source — this
 * package must not reach for `node:crypto`, since it also runs in the browser.
 */
export function generateReferralCode(
  randomInt: (maxExclusive: number) => number,
  length = REFERRAL_CODE_LENGTH,
): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${CODE_ALPHABET}]{4,24}$`), 'That referral code is not valid');

/** What a public capture page needs to render itself before anyone types. */
/**
 * A product as the public form needs it.
 *
 * Carries the parent link so the capture form can group sub-products under
 * their parent exactly as the internal forms do — Intraday and Delivery sit
 * under Equity rather than beside it. A flat list made the same fourteen
 * products read two different ways depending on which screen you were on.
 */
export interface CaptureProduct {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  summary: string | null;
}

export interface CaptureContext {
  kind: 'PARTNER' | 'EVENT';
  code: string;
  /** Shown to the person filling the form: "Referred by Trinetra Financial". */
  attributedTo: string;
  /** False when an event has ended or a partner is no longer active. */
  acceptingSubmissions: boolean;
  /** Why it is closed, in words a member of the public can act on. */
  closedReason: string | null;
  eventName?: string;
  venue?: string | null;
  startsAt?: string;
  /**
   * The products this form may offer, from the master list.
   *
   * Served with the context rather than hard-coded in the page. The master is
   * edited in the admin screen and drifts — production had no COMMODITY at all
   * and IPO, NRI and PMS switched off, while the form went on offering all
   * three. Every submission that ticked one was rejected as an unknown product,
   * at a stall, by somebody who had already given their name and number.
   */
  products: CaptureProduct[];
}

/**
 * Builds the public capture URL for a code.
 *
 * Partner and event codes live in separate path segments rather than one shared
 * namespace. A single namespace would need a cross-table uniqueness constraint
 * that no database can express, and the failure mode — an event code silently
 * shadowing a partner's referral code — would send that partner's business to
 * the wrong place with nothing in any log to explain it.
 */
export function captureUrl(baseUrl: string, kind: 'PARTNER' | 'EVENT', code: string): string {
  const segment = kind === 'PARTNER' ? 'p' : 'e';
  return new URL(`/join/${segment}/${encodeURIComponent(code)}`, baseUrl).toString();
}

/** The query parameter carrying the rep's employee code on a personal QR. */
export const REP_CAPTURE_PARAM = 'utm_content';

/**
 * An event's capture URL tagged with one rep's employee code.
 *
 * `utm_content` rather than a parameter of our own: it is already captured on
 * every lead, already carried through the public form, and already understood
 * by anything that reads campaign attribution. Inventing `?rep=` would have
 * meant a new column and a new field on the form for no gain.
 *
 * The code in the link is a claim, not proof — the URL is public and the codes
 * are short. The server resolves it and honours it only when it names somebody
 * who actually has event access, which is what stops a scan being attributed to
 * a colleague by anyone who can edit an address bar.
 */
export function repCaptureUrl(baseUrl: string, eventCode: string, employeeCode: string): string {
  const url = new URL(captureUrl(baseUrl, 'EVENT', eventCode));
  url.searchParams.set(REP_CAPTURE_PARAM, employeeCode);
  return url.toString();
}

/**
 * One rep's share of an event, for the breakdown under "what the leads became".
 *
 * Shaped like the daily activity report on purpose — a name, a total, and the
 * stage split — because the people reading it already know how to read that one.
 */
export interface EventRepBreakdown {
  /** Null for the row covering leads from the plain banner QR. */
  userId: string | null;
  fullName: string;
  employeeCode: string | null;
  /** Leads whose mobile number was proven by a one-time code. */
  verified: number;
  /** Captured, but the number was never confirmed. */
  unverified: number;
  total: number;
}
