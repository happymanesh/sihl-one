'use server';

import { revalidatePath } from 'next/cache';
import { createPresentationSlotSchema, updatePresentationSlotSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import type { ActionState } from '@/app/actions/leads';

function toErrorState(error: unknown, fallback: string): ActionState {
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

/**
 * The form asks for a date and a time; the API wants one instant.
 *
 * Joined here rather than in the component so there is one place that decides
 * what "26 September, 2pm" means. Two fields that travel separately are two
 * fields that can disagree, and the result is a talk at midnight on the wrong
 * day.
 */
function instantFrom(formData: FormData): string | undefined {
  const date = String(formData.get('date') ?? '').trim();
  const time = String(formData.get('time') ?? '').trim();
  if (!date || !time) return undefined;
  return `${date}T${time}`;
}

export async function addPresentationSlot(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const eventId = String(formData.get('eventId') ?? '');

  const parsed = createPresentationSlotSchema.safeParse({
    startsAt: instantFrom(formData),
    durationMinutes: formData.get('durationMinutes'),
    topic: formData.get('topic'),
    presenterName: formData.get('presenterName') || undefined,
    capacity: formData.get('capacity') || undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/presentations/events/${eventId}/slots`, {
      method: 'POST',
      body: { ...parsed.data, startsAt: parsed.data.startsAt.toISOString() },
    });
  } catch (error) {
    return toErrorState(error, 'The talk could not be added.');
  }

  revalidatePath(`/events/${eventId}`);
  return { status: 'success', message: 'Talk added.' };
}

export async function updatePresentationSlot(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const eventId = String(formData.get('eventId') ?? '');
  const slotId = String(formData.get('slotId') ?? '');

  const parsed = updatePresentationSlotSchema.safeParse({
    startsAt: instantFrom(formData),
    durationMinutes: formData.get('durationMinutes') || undefined,
    topic: formData.get('topic') || undefined,
    presenterName: formData.get('presenterName') ?? undefined,
    capacity: formData.get('capacity') || undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/presentations/slots/${slotId}`, {
      method: 'PATCH',
      body: {
        ...parsed.data,
        startsAt: parsed.data.startsAt ? parsed.data.startsAt.toISOString() : undefined,
      },
    });
  } catch (error) {
    return toErrorState(error, 'The talk could not be updated.');
  }

  revalidatePath(`/events/${eventId}`);
  return { status: 'success', message: 'Talk updated.' };
}

/**
 * Cancel a talk, or bring it back.
 *
 * Its own action rather than part of the edit form, because it is one click
 * from a list rather than a form somebody fills in — and because at a stall it
 * is the thing done in a hurry.
 */
export async function setPresentationSlotActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const eventId = String(formData.get('eventId') ?? '');
  const slotId = String(formData.get('slotId') ?? '');
  const isActive = formData.get('isActive') === 'true';

  try {
    await apiFetch(`/presentations/slots/${slotId}`, {
      method: 'PATCH',
      body: { isActive },
    });
  } catch (error) {
    return toErrorState(error, 'The talk could not be changed.');
  }

  revalidatePath(`/events/${eventId}`);
  return {
    status: 'success',
    message: isActive ? 'Talk is back on.' : 'Talk cancelled. Seats already taken are kept.',
  };
}

/** Open or close the whole schedule to visitors. */
export async function setPresentationBooking(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const eventId = String(formData.get('eventId') ?? '');
  const enabled = formData.get('enabled') === 'true';

  try {
    await apiFetch(`/presentations/events/${eventId}/booking`, {
      method: 'PATCH',
      body: { enabled },
    });
  } catch (error) {
    return toErrorState(error, 'That could not be changed.');
  }

  revalidatePath(`/events/${eventId}`);
  return {
    status: 'success',
    message: enabled
      ? 'Visitors can book seats.'
      : 'Booking closed. The talks and the seats already taken are kept.',
  };
}

/**
 * A visitor's booking, from the acknowledgement screen.
 *
 * Public: there is no session here, only the short-lived pass minted when the
 * visitor's number was proven. The API decides what that pass entitles them
 * to; nothing is trusted from the page.
 */
export interface BookingState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  booked?: Array<{
    startsAt: string;
    topic: string;
    presenterName: string | null;
    durationMinutes: number;
  }>;
  skipped?: number;
}

const BOOKING_API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

export async function bookPresentationSlots(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const bookingToken = String(formData.get('bookingToken') ?? '');
  const slotIds = formData.getAll('slotIds').map(String).filter(Boolean);
  const email = String(formData.get('email') ?? '').trim();

  if (slotIds.length === 0) {
    return { status: 'error', message: 'Choose at least one talk.' };
  }

  try {
    const response = await fetch(`${BOOKING_API_BASE}/presentations/public/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingToken, slotIds, email: email || undefined }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        detail?: string;
        title?: string;
      } | null;
      return {
        status: 'error',
        message:
          problem?.detail ??
          problem?.title ??
          'Your seat could not be held. Please ask at the desk.',
      };
    }

    const data = (await response.json()) as {
      booked: Array<{
        startsAt: string;
        topic: string;
        presenterName: string | null;
        durationMinutes: number;
      }>;
      skipped: number;
    };

    return {
      status: 'success',
      booked: data.booked,
      skipped: data.skipped,
      // Reported honestly rather than rounded up. A talk that started or was
      // cancelled between the list being drawn and the tap is the ordinary
      // case at a stall, not an error worth alarming anybody with.
      message:
        data.skipped > 0
          ? `${data.booked.length} booked. ${data.skipped} were no longer available.`
          : undefined,
    };
  } catch {
    return { status: 'error', message: 'Your seat could not be held. Please ask at the desk.' };
  }
}
