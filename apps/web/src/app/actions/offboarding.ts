'use server';

import { revalidatePath } from 'next/cache';
import { offboardUserSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface OffboardState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  result?: {
    sessionsRevoked: number;
    leadsMoved: number;
    customersMoved: number;
    tasksMoved: number;
    visitsCancelled: number;
  };
}

export async function markNoticePeriod(
  _previous: OffboardState,
  formData: FormData,
): Promise<OffboardState> {
  const userId = String(formData.get('userId'));

  try {
    await apiFetch(`/users/${userId}/notice-period`, { method: 'POST', body: {} });
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title)
          : 'Could not flag the notice period.',
    };
  }

  revalidatePath(`/admin/users/${userId}`);
  return {
    status: 'success',
    message: 'Flagged. Exports by this user are now audited at an elevated level.',
  };
}

export async function offboardUser(
  _previous: OffboardState,
  formData: FormData,
): Promise<OffboardState> {
  const userId = String(formData.get('userId'));
  const targetUserId = formData.get('targetUserId');

  const parsed = offboardUserSchema.safeParse({
    strategy: formData.get('strategy'),
    targetUserIds: targetUserId ? [String(targetUserId)] : [],
    reason: formData.get('reason'),
    includeCustomers: formData.get('includeCustomers') === 'on',
    includeTasks: formData.get('includeTasks') === 'on',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the handover details.',
    };
  }

  try {
    const result = await apiFetch<OffboardState['result']>(`/users/${userId}/offboard`, {
      method: 'POST',
      body: parsed.data,
    });

    revalidatePath('/leads');
    revalidatePath(`/admin/users/${userId}`);

    return {
      status: 'success',
      message: 'Handover complete. Access has been revoked.',
      result,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title)
          : 'The handover could not be completed.',
    };
  }
}
