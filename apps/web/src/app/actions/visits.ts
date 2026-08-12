'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelVisitSchema, checkInSchema, checkOutSchema, planVisitSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface VisitActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
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
    plannedAt: plannedAt ? new Date(String(plannedAt)) : undefined,
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
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
    accuracy: Number(formData.get('accuracy')),
    photoKey: formData.get('photoKey'),
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
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
    accuracy: Number(formData.get('accuracy')),
    meetingNotes: formData.get('meetingNotes'),
    outcome: formData.get('outcome') || undefined,
    nextFollowUpAt: followUp ? new Date(String(followUp)) : undefined,
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
