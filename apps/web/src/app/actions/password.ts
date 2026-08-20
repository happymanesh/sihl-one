'use server';

import { redirect } from 'next/navigation';
import { changePasswordSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { clearSessionCookies } from '@/lib/session';

export interface ChangePasswordState {
  status: 'idle' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

/**
 * Change the signed-in user's password.
 *
 * The API revokes every other session on success, so the user is signed out
 * everywhere else. This clears the local cookies too and sends them back to
 * sign in with the new password — carrying on with tokens minted under the old
 * one would leave the browser in a state the server no longer recognises.
 */
export async function changePassword(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the fields below.',
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await apiFetch<void>('/auth/change-password', { method: 'POST', body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        status: 'error',
        message: error.problem.detail ?? error.problem.title,
        errors: error.fieldErrors,
      };
    }
    return { status: 'error', message: 'Could not change the password. Try again.' };
  }

  await clearSessionCookies();
  redirect('/login?reason=password-changed');
}
