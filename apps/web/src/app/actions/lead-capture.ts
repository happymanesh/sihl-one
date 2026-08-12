'use server';

import { leadCaptureSchema, type LeadSource, type ProductInterest } from '@sihl-one/contracts';

import { ApiError } from '@/lib/api';

export interface CaptureState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  reference?: string;
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

    const data = (await response.json()) as { reference: string; duplicate: boolean };

    // The same confirmation either way. Telling an anonymous visitor "we already
    // have you on file" would confirm to anybody with a phone number whether
    // that person is a SIHL prospect.
    return {
      status: 'success',
      reference: data.reference,
      message: 'Thank you. A relationship manager will call you shortly.',
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
