'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  cancelVisitSchema,
  checkInSchema,
  checkOutSchema,
  planVisitSchema,
  rescheduleVisitSchema,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { istInstant } from '@/lib/time';

export interface VisitActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

/** A form field that may legitimately be blank. Blank means absent, never zero. */
function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toErrorState(error: unknown, fallback: string): VisitActionState {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      message: error.problem.detail ?? error.problem.title,
      errors: error.fieldErrors,
    };
  }
  return { status: 'error', message: fallback };
}

function zodErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    (errors[issue.path.join('.') || '_'] ??= []).push(issue.message);
  }
  return errors;
}

export async function planVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const plannedAt = formData.get('plannedAt');

  const parsed = planVisitSchema.safeParse({
    entityType: formData.get('entityType'),
    entityId: formData.get('entityId'),
    purpose: formData.get('purpose'),
    // Absent means "not sent by this caller", which the schema defaults to a
    // client-site visit. Sending an empty string instead would fail validation
    // and take the default away from callers that never had the field.
    mode: formData.get('mode') || undefined,
    plannedAt: istInstant(plannedAt),
    // Repeated fields from the multi-select. Role is not asked for at plan time:
    // one decision on a form a rep fills in between meetings is enough, and it
    // can be corrected on the visit itself.
    attendees: formData
      .getAll('attendees')
      .map((id) => ({ userId: String(id), role: 'SUPPORT' as const })),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  let visit: { id: string };
  try {
    visit = await apiFetch<{ id: string }>('/visits', {
      method: 'POST',
      body: { ...parsed.data, plannedAt: parsed.data.plannedAt?.toISOString() },
    });
  } catch (error) {
    return toErrorState(error, 'The visit could not be planned.');
  }

  revalidatePath('/visits');
  redirect(`/visits/${visit.id}`);
}

/**
 * Check-in.
 *
 * Takes an already-uploaded photo key rather than the image itself: the browser
 * uploads to `/api/files` directly so a 3 MB photo does not have to travel
 * through a server action's form encoding, which is both slower and subject to
 * the body-size limit.
 */
export async function checkInVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));

  const parsed = checkInSchema.safeParse({
    // Not `Number(...)`: an absent fix arrives as an empty string, and
    // `Number('')` is 0 — a perfectly valid latitude and longitude off the
    // coast of Africa. A check-in with no location would have been stored as a
    // pinpoint-accurate visit to Null Island.
    latitude: optionalNumber(formData.get('latitude')),
    longitude: optionalNumber(formData.get('longitude')),
    accuracy: optionalNumber(formData.get('accuracy')),
    locationFailureReason: formData.get('locationFailureReason') || undefined,
    // Empty means the mode did not ask for a photo, so the field must arrive as
    // absent. Passing '' through fails the schema's minimum length and reports
    // "the check-in could not be recorded" with nothing the rep can act on.
    photoKey: formData.get('photoKey') || undefined,
    address: formData.get('address') || undefined,
    deviceId: formData.get('deviceId') || undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'The check-in could not be recorded.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/visits/${visitId}/check-in`, { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The check-in could not be recorded.');
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath('/visits');
  return { status: 'success', message: 'Checked in.' };
}

export async function checkOutVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const followUp = formData.get('nextFollowUpAt');

  const parsed = checkOutSchema.safeParse({
    // Optional at both ends now. A blank must reach the schema as `undefined`,
    // never as 0 — see the note in checkInVisit.
    latitude: optionalNumber(formData.get('latitude')),
    longitude: optionalNumber(formData.get('longitude')),
    accuracy: optionalNumber(formData.get('accuracy')),
    locationFailureReason: formData.get('locationFailureReason') || undefined,
    meetingNotes: formData.get('meetingNotes'),
    outcome: formData.get('outcome') || undefined,
    nextFollowUpAt: istInstant(followUp),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'The check-out could not be recorded.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/visits/${visitId}/check-out`, {
      method: 'POST',
      body: { ...parsed.data, nextFollowUpAt: parsed.data.nextFollowUpAt?.toISOString() },
    });
  } catch (error) {
    return toErrorState(error, 'The check-out could not be recorded.');
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath('/visits');
  return { status: 'success', message: 'Visit completed.' };
}

export async function cancelVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const parsed = cancelVisitSchema.safeParse({ reason: formData.get('reason') });

  if (!parsed.success) {
    return { status: 'error', message: 'A reason is required to cancel a visit.' };
  }

  try {
    await apiFetch(`/visits/${visitId}/cancel`, { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The visit could not be cancelled.');
  }

  revalidatePath('/visits');
  return { status: 'success', message: 'Visit cancelled.' };
}

/**
 * Move a planned visit to a different time.
 *
 * A mistyped date used to mean cancelling and planning again, which loses the
 * reference and everything hanging off it. This corrects the time and nothing
 * else.
 */
export async function rescheduleVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const parsed = rescheduleVisitSchema.safeParse({
    plannedAt: istInstant(formData.get('plannedAt')),
    reason: formData.get('reason') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Pick the date and time the visit should move to.' };
  }

  try {
    await apiFetch(`/visits/${visitId}/reschedule`, { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The visit could not be moved.');
  }

  revalidatePath('/visits');
  revalidatePath(`/visits/${visitId}`);
  return { status: 'success', message: 'Visit moved.' };
}

/**
 * Add a colleague to a visit.
 *
 * No manager approval: a rep arranging a meeting for tomorrow morning decides
 * who to bring. Credit for the visit stays with its owner — this records who
 * supported, which is a different question and deliberately not a divisible one.
 */
export async function addVisitAttendee(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { status: 'error', message: 'Pick a colleague first.' };

  try {
    await apiFetch(`/visits/${visitId}/attendees`, {
      method: 'POST',
      body: { userId, role: String(formData.get('role') || 'SUPPORT') },
    });
  } catch (error) {
    return toErrorState(error, 'They could not be added to this visit.');
  }

  revalidatePath(`/visits/${visitId}`);
  return { status: 'success', message: 'Added.' };
}

export async function removeVisitAttendee(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const attendeeId = String(formData.get('attendeeId'));

  try {
    await apiFetch(`/visits/${visitId}/attendees/${attendeeId}`, { method: 'DELETE' });
  } catch (error) {
    return toErrorState(error, 'They could not be removed.');
  }

  revalidatePath(`/visits/${visitId}`);
  return { status: 'success', message: 'Removed.' };
}

/**
 * Record who actually came, at check-out.
 *
 * Anyone expected but not ticked stays on the record as unconfirmed rather than
 * being deleted: "we meant to bring a product expert and nobody came" is the
 * signal that tells a manager the experts are spread too thin.
 */
export async function confirmVisitAttendance(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const visitId = String(formData.get('visitId'));
  const presentUserIds = formData.getAll('presentUserIds').map(String).filter(Boolean);

  try {
    await apiFetch(`/visits/${visitId}/attendees/confirm`, {
      method: 'POST',
      body: { presentUserIds },
    });
  } catch (error) {
    return toErrorState(error, 'Attendance could not be recorded.');
  }

  revalidatePath(`/visits/${visitId}`);
  return { status: 'success', message: 'Attendance recorded.' };
}
