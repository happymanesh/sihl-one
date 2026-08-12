'use server';

import { revalidatePath } from 'next/cache';
import {
  disableMfaSchema,
  enableMfaSchema,
  type MfaEnabledResponse,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface MfaState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Returned once, on enable, and never retrievable again. */
  recoveryCodes?: string[];
}

function toError(error: unknown, fallback: string): MfaState {
  if (error instanceof ApiError) {
    return { status: 'error', message: error.problem.detail ?? error.problem.title };
  }
  return { status: 'error', message: fallback };
}

export async function enableMfa(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const parsed = enableMfaSchema.safeParse({
    secret: formData.get('secret'),
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the code.' };
  }

  try {
    const result = await apiFetch<MfaEnabledResponse>('/auth/mfa/enable', {
      method: 'POST',
      body: parsed.data,
    });

    revalidatePath('/settings/security');
    return {
      status: 'success',
      message: 'Two-step verification is on.',
      recoveryCodes: result.recoveryCodes,
    };
  } catch (error) {
    return toError(error, 'Two-step verification could not be turned on.');
  }
}

export async function disableMfa(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const parsed = disableMfaSchema.safeParse({
    password: formData.get('password'),
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter your password and a current code.',
    };
  }

  try {
    await apiFetch('/auth/mfa/disable', { method: 'POST', body: parsed.data });
    revalidatePath('/settings/security');
    return { status: 'success', message: 'Two-step verification is off.' };
  } catch (error) {
    return toError(error, 'Two-step verification could not be turned off.');
  }
}
