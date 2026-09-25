'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { changeEventStatusSchema, createEventSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

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

/**
 * The business timezone, written into the value rather than assumed.
 *
 * A `datetime-local` field yields `2026-09-26T09:00` with no offset, so
 * whoever parses it applies their own clock. On Railway that is UTC, so an
 * event opening at nine in the morning was stored as 09:00Z and read back —
 * correctly, in IST — as half past two in the afternoon.
 *
 * Stating the offset makes the value mean the same thing on every machine that
 * reads it. Events created before this carry the raw figure somebody typed;
 * see the note in the presentation slot window check, which compares calendar
 * days precisely so it holds true under either reading.
 */
const IST_OFFSET = '+05:30';

/** Seconds included: an offset without them is not valid ISO to every parser. */
function withTimezone(value: FormDataEntryValue | null): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  // Already carries an offset, or is not the shape we expect: leave it alone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  return `${raw}:00${IST_OFFSET}`;
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
    startsAt: withTimezone(formData.get('startsAt')),
    endsAt: withTimezone(formData.get('endsAt')),
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
