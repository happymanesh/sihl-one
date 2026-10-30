'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type { TrainingView } from '@sihl-one/contracts';

import { rethrowControlFlow } from '@/lib/rethrow';
import { ApiError, apiFetch } from '@/lib/api';

export interface TrainingState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

function toErrorState(error: unknown, fallback: string): TrainingState {
  rethrowControlFlow(error);
  if (error instanceof ApiError) {
    // The API explains *why* — "this session has finished", with the time it
    // ended — and that reason is the whole value of the message.
    return {
      status: 'error',
      message: error.problem.detail ?? error.problem.title,
      errors: error.fieldErrors,
    };
  }
  return { status: 'error', message: fallback };
}

/**
 * A local datetime from the form, as an instant.
 *
 * `datetime-local` has no zone, and the browser reads it as local time — which
 * for everyone using this is IST. Converted here so the API is handed an
 * unambiguous instant rather than a string whose meaning depends on where the
 * server happens to be.
 */
function toInstant(raw: FormDataEntryValue | null): string | undefined {
  const value = String(raw ?? '').trim();
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function body(formData: FormData) {
  return {
    topic: String(formData.get('topic') ?? '').trim(),
    startsAt: toInstant(formData.get('startsAt')),
    durationMinutes: Number(formData.get('durationMinutes') || 30),
    presenterName: String(formData.get('presenterName') ?? '').trim() || undefined,
    remarks: String(formData.get('remarks') ?? '').trim() || undefined,
    branchIds: formData.getAll('branchIds').map(String).filter(Boolean),
  };
}

export async function createTraining(
  _previous: TrainingState,
  formData: FormData,
): Promise<TrainingState> {
  const input = body(formData);

  if (!input.startsAt) {
    return { status: 'error', message: 'Choose when the session starts.' };
  }
  if (input.branchIds.length === 0) {
    return { status: 'error', message: 'Choose at least one branch.' };
  }

  let created: TrainingView;
  try {
    created = await apiFetch<TrainingView>('/training', { method: 'POST', body: input });
  } catch (error) {
    return toErrorState(error, 'The session could not be scheduled.');
  }

  revalidatePath('/training');
  redirect(`/training/${created.id}` as Route);
}

export async function updateTraining(
  _previous: TrainingState,
  formData: FormData,
): Promise<TrainingState> {
  const id = String(formData.get('id') ?? '');
  const input = body(formData);

  if (!input.startsAt) {
    return { status: 'error', message: 'Choose when the session starts.' };
  }
  if (input.branchIds.length === 0) {
    return { status: 'error', message: 'Choose at least one branch.' };
  }

  try {
    await apiFetch(`/training/${id}`, { method: 'PATCH', body: input });
  } catch (error) {
    return toErrorState(error, 'The session could not be updated.');
  }

  revalidatePath('/training');
  revalidatePath(`/training/${id}`);
  return { status: 'success', message: 'Saved.' };
}

/**
 * Cancel rather than delete, once anybody might be expecting it.
 *
 * A cancelled session keeps its row: "why did nobody attend" is a question
 * about a training that existed, and deleting it makes that unanswerable.
 */
export async function cancelTraining(
  _previous: TrainingState,
  formData: FormData,
): Promise<TrainingState> {
  const id = String(formData.get('id') ?? '');
  try {
    await apiFetch(`/training/${id}`, { method: 'PATCH', body: { status: 'CANCELLED' } });
  } catch (error) {
    return toErrorState(error, 'The session could not be cancelled.');
  }
  revalidatePath('/training');
  revalidatePath(`/training/${id}`);
  return { status: 'success', message: 'Cancelled.' };
}

export async function deleteTraining(
  _previous: TrainingState,
  formData: FormData,
): Promise<TrainingState> {
  const id = String(formData.get('id') ?? '');
  try {
    await apiFetch(`/training/${id}`, { method: 'DELETE' });
  } catch (error) {
    return toErrorState(error, 'The session could not be removed.');
  }
  revalidatePath('/training');
  redirect('/training');
}
