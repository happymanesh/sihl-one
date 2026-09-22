'use server';

import {
  leadCaptureSchema,
  resendOtpSchema,
  verifyOtpSchema,
  type LeadSource,
  type ProductInterest,
} from '@sihl-one/contracts';

import { ApiError } from '@/lib/api';

export interface CaptureState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  reference?: string;
  /**
   * We already hold an open lead for this mobile.
   *
   * Set **only** for a capture made against an event or partner code, never for
   * the open website form. See the note on the response handling below — this
   * flag is the difference between telling somebody standing in front of a rep
   * something useful, and answering "is this person a SIHL client" for anyone
   * on the internet with a phone number.
   */
  alreadyKnown?: boolean;

  /**
   * What was captured, read back on the acknowledgement.
   *
   * Set under exactly the same condition as `alreadyKnown` and for the same
   * reason: at a stall it confirms to the rep and the visitor that the right
   * details went in, while on the open website it would hand anybody a way to
   * probe. The values are the ones just submitted, never the ones on file.
   */
  captured?: {
    name: string;
    mobile: string;
    productInterest: string[];
    assignedToName: string | null;
  };

  /**
   * A code is waiting to be typed.
   *
   * Present only when one was actually sent. The lead is saved either way, so
   * its absence means the registration succeeded and verification is simply
   * unavailable — never that anything was lost.
   */
  verification?: {
    verificationId: string;
    expiresInSeconds: number;
    maskedMobile: string;
  };
  errors?: Record<string, string[]>;
}

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Public lead capture.
 *
 * Uses a bare fetch rather than the authenticated `apiFetch` helper: this runs
 * for anonymous visitors, and routing it through a client that redirects to
 * /login on 401 would be wrong here.
 *
 * Validation runs server-side with the same Zod schema the API uses. The
 * browser-side check is a convenience; this one is the one that counts, because
 * anyone can post to the endpoint directly.
 */
export async function submitLeadCapture(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const parsed = leadCaptureSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName') || undefined,
    mobile: formData.get('mobile'),
    email: formData.get('email') || undefined,
    city: formData.get('city') || undefined,
    productInterest: formData.getAll('productInterest') as ProductInterest[],
    message: formData.get('message') || undefined,
    source: 'WEBSITE' as LeadSource,
    // The code, not a resolved id — the API looks it up. See the note on
    // `leadCaptureSchema`.
    partnerCode: (formData.get('partnerCode') as string) || undefined,
    eventCode: (formData.get('eventCode') as string) || undefined,
    consentToContact: formData.get('consentToContact') === 'on',
    attribution: {
      utmSource: (formData.get('utmSource') as string) || undefined,
      utmMedium: (formData.get('utmMedium') as string) || undefined,
      utmCampaign: (formData.get('utmCampaign') as string) || undefined,
      // Carries the rep's employee code from their personal QR. The API
      // resolves it and decides whether to honour it; the browser only relays.
      utmContent: (formData.get('utmContent') as string) || undefined,
      landingPath: (formData.get('landingPath') as string) || undefined,
    },
  });

  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (errors[key] ??= []).push(issue.message);
    }
    return { status: 'error', message: 'Please correct the highlighted fields.', errors };
  }

  try {
    const response = await fetch(`${API_BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      if (response.status === 429) {
        return {
          status: 'error',
          message: 'Too many submissions from this connection. Please try again in a minute.',
        };
      }
      return {
        status: 'error',
        message: problem?.detail ?? 'We could not submit your enquiry. Please try again.',
        errors: problem?.errors,
      };
    }

    const data = (await response.json()) as {
      reference: string;
      duplicate: boolean;
      existingClient?: boolean;
      firstName?: string;
      lastName?: string | null;
      mobile?: string;
      productInterest?: string[] | null;
      assignedToName?: string | null;
      verification?: {
        verificationId: string | null;
        expiresInSeconds: number;
        maskedMobile: string;
        sent: boolean;
      } | null;
    };

    /*
      Whether we say "we already have you" depends on who is asking.

      On the open website the answer must never vary: a differing response
      confirms to anybody holding a phone number whether that person is a SIHL
      prospect, which is a disclosure we do not get to make. That is finding 1
      of docs/pii-egress-review.md and it stands.

      A capture made against an event or partner code is a different setting.
      The person is at a stall, in front of the rep whose code it is, filling
      the form on their own phone — so "we already have your details" tells
      them nothing they did not just tell us, and saves the rep taking the same
      details twice.
    */
    const attended = Boolean(parsed.data.partnerCode || parsed.data.eventCode);
    /*
      Two different ways of already being known, and they need different words.

      `duplicate` means there is an open enquiry from this number here.
      `existingClient` means the back office holds an account for it — someone
      who may never have enquired in their life. Telling that person their
      details were "added to your existing enquiry" describes something that
      does not exist, and they are the one visitor on the floor most likely to
      notice.
    */
    const repeatEnquiry = attended && data.duplicate;
    const knownClient = attended && Boolean(data.existingClient);
    const alreadyKnown = repeatEnquiry || knownClient;

    return {
      status: 'success',
      reference: data.reference,
      alreadyKnown,
      verification:
        data.verification?.sent && data.verification.verificationId
          ? {
              verificationId: data.verification.verificationId,
              expiresInSeconds: data.verification.expiresInSeconds,
              maskedMobile: data.verification.maskedMobile,
            }
          : undefined,
      captured: attended
        ? {
            name: [data.firstName, data.lastName].filter(Boolean).join(' ').trim(),
            mobile: data.mobile ?? parsed.data.mobile,
            productInterest: data.productInterest ?? [],
            assignedToName: data.assignedToName ?? null,
          }
        : undefined,
      // Warm on purpose. This is read by an existing client who has just
      // queued at a stall to tell us something — "you are already registered"
      // lands as a correction, and nobody enjoys being told they did a
      // redundant thing. Lead with what we did with what they said.
      message: repeatEnquiry
        ? 'We already have your details, so nothing you have told us today is lost — it has been added to your existing enquiry, and your relationship manager will call you shortly.'
        : knownClient
          ? 'Good to see you again. We have your details on file, and your relationship manager will call you shortly.'
          : 'Thank you. A relationship manager will call you shortly.',
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'error', message: error.message, errors: error.fieldErrors };
    }
    return {
      status: 'error',
      message: 'We could not reach our servers. Please try again in a moment.',
    };
  }
}

export interface VerifyState {
  status: 'idle' | 'verified' | 'error';
  message?: string;
  attemptsRemaining?: number;
}

/**
 * Check the code the visitor was texted.
 *
 * Bare fetch, like the capture above: the person doing this has no account, so
 * routing it through the authenticated client would be wrong.
 */
export async function verifyCaptureMobile(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = verifyOtpSchema.safeParse({
    verificationId: formData.get('verificationId'),
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the code.' };
  }

  try {
    const response = await fetch(`${API_BASE}/leads/capture/verify-mobile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    if (response.status === 429) {
      return { status: 'error', message: 'Too many attempts. Wait a minute and try again.' };
    }
    if (!response.ok) {
      return { status: 'error', message: 'We could not check that code. Please try again.' };
    }

    const result = (await response.json()) as {
      verified: boolean;
      reason: string | null;
      attemptsRemaining: number;
    };

    return result.verified
      ? { status: 'verified' }
      : {
          status: 'error',
          message: result.reason ?? 'That code is not right.',
          attemptsRemaining: result.attemptsRemaining,
        };
  } catch {
    return { status: 'error', message: 'We could not reach our servers. Please try again.' };
  }
}

/** Send the code again. Capped per number by the API, not here. */
export async function resendCaptureCode(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = resendOtpSchema.safeParse({ verificationId: formData.get('verificationId') });
  if (!parsed.success) return { status: 'error', message: 'Could not resend.' };

  try {
    const response = await fetch(`${API_BASE}/leads/capture/resend-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { status: 'error', message: 'We could not send another code just now.' };
    }

    const result = (await response.json()) as { sent: boolean };
    return result.sent
      ? { status: 'idle', message: 'A new code is on its way.' }
      : {
          status: 'error',
          // The per-number cap is the likeliest reason, and saying so is more
          // useful than a generic failure to somebody pressing it repeatedly.
          message: 'No more codes can be sent to this number for now. Ask the desk for help.',
        };
  } catch {
    return { status: 'error', message: 'We could not reach our servers. Please try again.' };
  }
}
