'use server';

import { rethrowControlFlow } from '@/lib/rethrow';

import { ApiError, apiFetch } from '@/lib/api';

export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

/** Splits a typed list into addresses, dropping blanks and stray separators. */
function addresses(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function sendPerformanceReport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const to = addresses(formData.get('to'));
  if (to.length === 0) {
    return { status: 'error', message: 'Add at least one recipient.' };
  }

  // Checked here as well as on the server, because the message a sender needs
  // is "this address is wrong", not "validation failed".
  const invalid = [...to, ...addresses(formData.get('cc'))].filter(
    (address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
  );
  if (invalid.length > 0) {
    return { status: 'error', message: `Not a valid address: ${invalid.join(', ')}` };
  }

  let result: { sent: boolean; recipients: number; failureReason: string | null };
  try {
    result = await apiFetch('/performance/report/send', {
      method: 'POST',
      body: {
        to,
        cc: addresses(formData.get('cc')),
        subject: String(formData.get('subject') ?? '').trim(),
        body: String(formData.get('body') ?? ''),
      },
    });
  } catch (error) {
    rethrowControlFlow(error);
    if (error instanceof ApiError) {
      return { status: 'error', message: error.problem.detail ?? error.problem.title };
    }
    return { status: 'error', message: 'The report could not be sent.' };
  }

  /*
    A refusal by the mail provider is an error here, not a success.

    The API returns it as data so the reason survives, but to the person who
    just pressed Send, "sent" and "the provider refused it" are opposite
    outcomes and must not look alike.
  */
  if (!result.sent) {
    return {
      status: 'error',
      message: result.failureReason ?? 'The email was not accepted by the mail provider.',
    };
  }

  return {
    status: 'success',
    message: `Sent to ${result.recipients} ${result.recipients === 1 ? 'recipient' : 'recipients'}.`,
  };
}
