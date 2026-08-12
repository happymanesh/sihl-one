'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import {
  isMfaChallenge,
  loginSchema,
  mfaAnswerSchema,
  type LoginResponse,
  type MfaChallengeResponse,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { clearSessionCookies, getAccessToken, setSessionCookies } from '@/lib/session';

export interface LoginState {
  status: 'idle' | 'error' | 'mfa';
  message?: string;
  errors?: Record<string, string[]>;
  /** Present when the password was right and a second factor is needed. */
  challengeToken?: string;
  /** Carried through the challenge step so the redirect still honours it. */
  next?: string;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (errors[issue.path.join('.') || '_'] ??= []).push(issue.message);
    }
    return { status: 'error', message: 'Enter your email or mobile and your password.', errors };
  }

  let response: LoginResponse | MfaChallengeResponse;
  try {
    response = await apiFetch<LoginResponse | MfaChallengeResponse>('/auth/login', {
      method: 'POST',
      body: parsed.data,
      allowUnauthenticated: true,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        status: 'error',
        // The API returns one message for every kind of failure so the form
        // cannot be used to discover which accounts exist. It is passed through
        // unchanged rather than being "improved" here.
        message: error.problem.detail ?? error.problem.title,
        errors: error.fieldErrors,
      };
    }
    return {
      status: 'error',
      message: 'We could not reach the SIHL ONE service. Check your connection and try again.',
    };
  }

  // Password accepted but a second factor is enrolled. No cookies are set —
  // the challenge token is not a session and must never be treated as one.
  if (isMfaChallenge(response)) {
    return {
      status: 'mfa',
      challengeToken: response.challengeToken,
      next: readNext(formData) ?? undefined,
    };
  }

  await setSessionCookies(response.tokens);

  const home =
    response.user.roles.includes('PARTNER')
      ? '/partner'
      : response.user.roles.includes('CUSTOMER')
        ? '/portal'
        : '/dashboard';

  const destination = (readNext(formData) ?? home) as Route;

  // redirect() throws, so it must sit outside the try/catch above — inside, the
  // control-flow exception would be swallowed as a login failure.
  redirect(destination);
}

/**
 * Only same-site paths are accepted: an unvalidated `next` is an open redirect,
 * and this one fires immediately after a successful sign-in.
 */
function readNext(formData: FormData): string | null {
  const requested = formData.get('next');
  return typeof requested === 'string' &&
    requested.startsWith('/') &&
    !requested.startsWith('//')
    ? requested
    : null;
}

/**
 * Second step of a sign-in that needed two factors.
 *
 * The challenge token round-trips through a hidden field rather than a cookie.
 * It is not a session — giving it a cookie would make it look like one to every
 * future reader of this code.
 */
export async function answerMfa(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const challengeToken = String(formData.get('challengeToken') ?? '');
  const next = readNext(formData);

  const parsed = mfaAnswerSchema.safeParse({
    challengeToken,
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return {
      status: 'mfa',
      challengeToken,
      next: next ?? undefined,
      message: 'Enter the six-digit code from your authenticator app, or a recovery code.',
    };
  }

  let response: LoginResponse;
  try {
    response = await apiFetch<LoginResponse>('/auth/mfa/challenge', {
      method: 'POST',
      body: parsed.data,
      allowUnauthenticated: true,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // An expired challenge sends them back to the password step; a wrong code
      // keeps them here, because retyping the password would be pointless.
      const expired = /expired/i.test(error.problem.title ?? '');
      return expired
        ? { status: 'error', message: error.problem.detail ?? error.problem.title }
        : {
            status: 'mfa',
            challengeToken,
            next: next ?? undefined,
            message: error.problem.detail ?? error.problem.title,
          };
    }
    return { status: 'error', message: 'We could not reach the SIHL ONE service.' };
  }

  await setSessionCookies(response.tokens);

  const home = response.user.roles.includes('PARTNER')
    ? '/partner'
    : response.user.roles.includes('CUSTOMER')
      ? '/portal'
      : '/dashboard';

  redirect((next ?? home) as Route);
}

export async function logout(): Promise<void> {
  const token = await getAccessToken();

  if (token) {
    // Revoke server-side first. Clearing the cookie alone leaves a valid
    // refresh token alive in the session table for up to thirty days.
    await apiFetch<void>('/auth/logout', { method: 'POST', allowUnauthenticated: true }).catch(
      () => undefined,
    );
  }

  await clearSessionCookies();
  redirect('/login');
}
