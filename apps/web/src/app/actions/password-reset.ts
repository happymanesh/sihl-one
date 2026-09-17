'use server';

import { forgotPasswordSchema, resetPasswordSchema } from '@sihl-one/contracts';

/**
 * The two halves of a self-service password reset.
 *
 * Both use a bare fetch rather than the authenticated `apiFetch` helper: they
 * run for somebody who by definition cannot sign in, and a client that
 * redirects to /login on a 401 would be exactly wrong here.
 */

export interface ResetState {
  status: 'idle' | 'sent' | 'done' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

function fieldErrors(issues: { path: (string | number)[]; message: string }[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

export async function requestPasswordReset(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = forgotPasswordSchema.safeParse({
    identifier: formData.get('identifier'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter your email, mobile or employee code.',
      errors: fieldErrors(parsed.error.issues),
    };
  }

  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    /*
      Anything short of a network failure is reported as sent.

      The API answers 202 whether or not the account exists, and this must not
      undo that by treating some other status as "no such user". A rate limit
      is the one case worth distinguishing, because the person can act on it.
    */
    if (response.status === 429) {
      return {
        status: 'error',
        message: 'Too many attempts. Wait a minute and try again.',
      };
    }
  } catch {
    return {
      status: 'error',
      message: 'We could not reach the server. Check your connection and try again.',
    };
  }

  return {
    status: 'sent',
    message:
      'If that account exists, a reset link is on its way. It is valid for 30 minutes — check your inbox, including spam.',
  };
}

export async function completePasswordReset(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: fieldErrors(parsed.error.issues),
    };
  }

  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as
        | { title?: string; detail?: string }
        | null;
      return {
        status: 'error',
        message:
          problem?.detail ??
          problem?.title ??
          'That reset link is no longer valid. Ask for a new one.',
      };
    }
  } catch {
    return {
      status: 'error',
      message: 'We could not reach the server. Check your connection and try again.',
    };
  }

  return { status: 'done' };
}
