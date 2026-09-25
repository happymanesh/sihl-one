'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { changeEventStatusSchema, createEventSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { istInstant } from '@/lib/time';

export interface EventFormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

function toErrorState(error: unknown, fallback: string): EventFormState {
  if (error instanceof ApiError) {
    // A taken code names the event that holds it, which matters because the
    // code cannot be changed after the QR is printed.
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

export async function createEvent(
  _previous: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const footfall = formData.get('expectedFootfall');

  const parsed = createEventSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code'),
    venue: formData.get('venue') || undefined,
    city: formData.get('city') || undefined,
    startsAt: istInstant(formData.get('startsAt')),
    endsAt: istInstant(formData.get('endsAt')),
    expectedFootfall: footfall ? Number(footfall) : undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/events', { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The event could not be created.');
  }

  revalidatePath('/events');
  redirect(`/events/${created.id}` as Route);
}

export async function changeEventStatus(
  _previous: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const eventId = String(formData.get('eventId'));

  const parsed = changeEventStatusSchema.safeParse({ status: formData.get('status') });
  if (!parsed.success) return { status: 'error', message: 'Unknown status.' };

  try {
    await apiFetch(`/events/${eventId}/status`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The status could not be changed.');
  }

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  return { status: 'success', message: 'Updated.' };
}
