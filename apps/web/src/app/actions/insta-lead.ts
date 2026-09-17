'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { instaLeadSchema, type InstaLeadResult } from '@sihl-one/contracts';

import { apiFetch, ApiError } from '@/lib/api';

export interface InstaState {
  status: 'idle' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

/**
 * Insta Lead.
 *
 * Ends in a redirect rather than a success state, because there is nothing to
 * show: the rep is mid-conversation and the next thing they need is either the
 * camera or the notes field, not a confirmation screen to dismiss.
 */
export async function submitInstaLead(
  _previous: InstaState,
  formData: FormData,
): Promise<InstaState> {
  const number = (value: FormDataEntryValue | null) =>
    value === null || value === '' ? undefined : Number(value);

  const parsed = instaLeadSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName') || undefined,
    mobile: formData.get('mobile'),
    mode: formData.get('mode'),
    attendeeUserId: formData.get('attendeeUserId') || undefined,
    latitude: number(formData.get('latitude')),
    longitude: number(formData.get('longitude')),
    accuracy: number(formData.get('accuracy')),
  });

  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (errors[key] ??= []).push(issue.message);
    }
    return { status: 'error', message: 'Check the name and mobile number.', errors };
  }

  let result: InstaLeadResult;
  try {
    result = await apiFetch<InstaLeadResult>('/leads/insta', {
      method: 'POST',
      body: parsed.data,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'error', message: error.message, errors: error.fieldErrors };
    }
    return {
      status: 'error',
      message: 'We could not reach the server. Check your connection and try again.',
    };
  }

  revalidatePath('/leads');
  revalidatePath('/visits');

  /*
    Straight in, as asked.

    An off-site visit still owes a photograph, so the rep lands on the visit
    where the camera is. Anything else is already checked in, so they land on
    the lead with the notes field — the only thing left to do is talk and then
    write it down.
  */
  redirect(result.awaitingCheckIn ? `/visits/${result.visitId}` : `/leads/${result.leadId}`);
}
