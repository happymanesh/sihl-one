import { z } from 'zod';

import { codeSchema, idSchema, paginationQuerySchema } from './common';

/**
 * Outbound messaging — templates, and the rules about who may be sent what.
 *
 * The sending itself is a provider's job. What lives here is the part that is
 * illegal to get wrong, and it is deliberately pure so it can be exhaustively
 * tested without a single API key.
 *
 * Two regimes apply to an Indian broker at once.
 *
 * **TRAI** governs commercial communication. Promotional messages may not go to
 * a number on the DND registry, and may not be sent outside 09:00–21:00.
 * *Transactional* messages — an order confirmation, a margin call — are exempt
 * from both, because a client needs them regardless. The distinction is
 * therefore not cosmetic: mislabelling a promotion as transactional to dodge
 * the rules is the specific abuse the regime exists to stop.
 *
 * **DPDP** governs personal data. Consent is per purpose, and a consent given
 * for account servicing is not consent to be marketed at.
 *
 * The gate below refuses by default and states its reason. Anything that cannot
 * be shown to be permitted is not sent.
 */

export const MESSAGE_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * Why a message is being sent. This is the field the whole gate turns on.
 *
 * TRANSACTIONAL — a consequence of something the client did or holds: an
 * account opened, a margin shortfall, a KYC document rejected. Exempt from DND
 * and from quiet hours, because withholding it would harm them.
 *
 * SERVICE — operational but not urgent: a statement is ready, a nominee is
 * missing. Sent only to clients, respects quiet hours, ignores DND.
 *
 * PROMOTIONAL — anything intended to sell. Requires marketing consent, respects
 * DND, respects quiet hours.
 */
export const MESSAGE_PURPOSES = ['TRANSACTIONAL', 'SERVICE', 'PROMOTIONAL'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const MESSAGE_STATUSES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SUPPRESSED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** TRAI's commercial-communication window, in local time. */
export const QUIET_HOURS_START = 21;
export const QUIET_HOURS_END = 9;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * `{{variable}}` only — no expressions, no logic, no loops.
 *
 * A template language rich enough to compute is a template language rich enough
 * to leak. These are authored by marketing and rendered against customer data;
 * substitution is the entire feature.
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VARIABLE_PATTERN)].map((match) => match[1]!))];
}

export interface RenderResult {
  text: string;
  /** Placeholders with no value supplied. */
  missing: string[];
}

/**
 * Substitutes values into a template.
 *
 * A missing value is reported, never silently blanked. "Dear ," reaching a
 * client is worse than the send failing, and the caller cannot notice a blank
 * it never hears about.
 */
export function renderTemplate(
  body: string,
  values: Readonly<Record<string, string | number | null | undefined>>,
): RenderResult {
  const missing: string[] = [];

  const text = body.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === null || value === undefined || value === '') {
      missing.push(name);
      return `{{${name}}}`;
    }
    return String(value);
  });

  return { text, missing: [...new Set(missing)] };
}

/** Single-segment GSM-7 SMS. Longer bodies are billed and split per segment. */
export const SMS_SEGMENT_LENGTH = 160;

export function smsSegments(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / SMS_SEGMENT_LENGTH);
}

export const createTemplateSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(3).max(120),
    channel: z.enum(MESSAGE_CHANNELS),
    purpose: z.enum(MESSAGE_PURPOSES),
    /** Email only. */
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(5).max(4000),
    /**
     * WhatsApp business-initiated messages must use a template Meta has
     * approved. Storing their id here is what lets the adapter send one at all;
     * without it the provider rejects the message, not us.
     */
    providerTemplateId: z.string().trim().max(120).optional(),
  })
  .refine((input) => input.channel !== 'EMAIL' || Boolean(input.subject), {
    message: 'An email template needs a subject',
    path: ['subject'],
  });
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(5).max(4000).optional(),
  providerTemplateId: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const templateQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  channel: z.enum(MESSAGE_CHANNELS).optional(),
  purpose: z.enum(MESSAGE_PURPOSES).optional(),
});
export type TemplateQuery = z.infer<typeof templateQuerySchema>;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface RecipientState {
  channel: MessageChannel;
  /** Absent means there is nothing to send to. */
  destination: string | null;
  /** On the TRAI Do Not Disturb registry. */
  isDndRegistered: boolean;
  /** Consent recorded for MARKETING_CONTACT under DPDP. */
  hasMarketingConsent: boolean;
  /** They have asked, on this channel, to stop. */
  hasOptedOut: boolean;
  /** A lead is not yet a client; SERVICE messages assume a relationship. */
  isCustomer: boolean;
}

export interface SendDecision {
  allowed: boolean;
  /** Set when refused — phrased for whoever has to explain it. */
  reason: string | null;
  /** Recorded against the message so a refusal is auditable. */
  code:
    | 'ALLOWED'
    | 'NO_DESTINATION'
    | 'OPTED_OUT'
    | 'NO_CONSENT'
    | 'DND_REGISTERED'
    | 'QUIET_HOURS'
    | 'NOT_A_CUSTOMER';
}

const ALLOW: SendDecision = { allowed: true, reason: null, code: 'ALLOWED' };

/** 21:00–08:59 inclusive. */
export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/**
 * Whether this message may be sent to this recipient, now.
 *
 * Refuses by default. Every branch returns a reason, because a message that
 * silently does not arrive is the hardest support call there is — the rep
 * swears they sent it and nothing anywhere disagrees.
 *
 * `hour` is passed in rather than read from the clock so the rule is testable
 * and so the caller is forced to decide which timezone applies. IST is not the
 * server's timezone in every deployment.
 */
export function canSend(
  purpose: MessagePurpose,
  recipient: RecipientState,
  hour: number,
): SendDecision {
  if (!recipient.destination) {
    return {
      allowed: false,
      code: 'NO_DESTINATION',
      reason: `No ${recipient.channel.toLowerCase()} address on record.`,
    };
  }

  // An explicit opt-out outranks everything, including a transactional purpose
  // — if somebody has said stop on this channel, "but this one is important"
  // is exactly the reasoning that gets a broker fined.
  if (recipient.hasOptedOut) {
    return {
      allowed: false,
      code: 'OPTED_OUT',
      reason: 'They have asked not to be contacted on this channel.',
    };
  }

  if (purpose === 'TRANSACTIONAL') {
    // Exempt from DND and quiet hours by design: a margin call at 22:00 is the
    // one message that must go out.
    return ALLOW;
  }

  if (purpose === 'SERVICE') {
    if (!recipient.isCustomer) {
      return {
        allowed: false,
        code: 'NOT_A_CUSTOMER',
        reason: 'Service messages go to clients, not to leads.',
      };
    }
    return isQuietHour(hour)
      ? {
          allowed: false,
          code: 'QUIET_HOURS',
          reason: `Commercial messages are not sent between ${QUIET_HOURS_START}:00 and 0${QUIET_HOURS_END}:00.`,
        }
      : ALLOW;
  }

  // PROMOTIONAL — every check applies.
  if (!recipient.hasMarketingConsent) {
    return {
      allowed: false,
      code: 'NO_CONSENT',
      reason: 'No marketing consent on record. Consent to be serviced is not consent to be sold to.',
    };
  }
  if (recipient.isDndRegistered) {
    return {
      allowed: false,
      code: 'DND_REGISTERED',
      reason: 'This number is on the Do Not Disturb registry.',
    };
  }
  if (isQuietHour(hour)) {
    return {
      allowed: false,
      code: 'QUIET_HOURS',
      reason: `Promotional messages are not sent between ${QUIET_HOURS_START}:00 and 0${QUIET_HOURS_END}:00.`,
    };
  }

  return ALLOW;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  templateCode: codeSchema,
  /** Exactly one of these. */
  leadId: idSchema.optional(),
  customerId: idSchema.optional(),
  /** Values for the template's `{{variables}}`. */
  variables: z.record(z.string(), z.string().max(500)).default({}),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export interface MessageLogItem {
  id: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  templateCode: string;
  /** Masked. A message log is read by more people than the customer record is. */
  destinationMasked: string;
  subject: string | null;
  body: string;
  status: MessageStatus;
  decisionCode: string;
  failureReason: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
}
