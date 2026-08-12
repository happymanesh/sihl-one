'use server';

import { revalidatePath } from 'next/cache';
import { createTemplateSchema, sendMessageSchema, updateTemplateSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface MessagingState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set when the gate refused, so the screen can explain rather than just fail. */
  suppressedReason?: string;
}

function toState(error: unknown, fallback: string): MessagingState {
  if (error instanceof ApiError) {
    return { status: 'error', message: error.problem.detail ?? error.problem.title };
  }
  return { status: 'error', message: fallback };
}

export async function createTemplate(
  _p: MessagingState,
  formData: FormData,
): Promise<MessagingState> {
  const parsed = createTemplateSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    channel: formData.get('channel'),
    purpose: formData.get('purpose'),
    subject: formData.get('subject') || undefined,
    body: formData.get('body'),
    providerTemplateId: formData.get('providerTemplateId') || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch('/messaging/templates', { method: 'POST', body: parsed.data });
  } catch (error) {
    return toState(error, 'The template could not be created.');
  }
  revalidatePath('/messaging');
  return { status: 'success', message: `Added "${parsed.data.name}".` };
}

export async function updateTemplate(
  _p: MessagingState,
  formData: FormData,
): Promise<MessagingState> {
  const id = String(formData.get('id'));
  const raw: Record<string, unknown> = {};
  if (formData.get('body')) raw.body = formData.get('body');
  if (formData.has('isActive')) raw.isActive = formData.get('isActive') === 'true';

  const parsed = updateTemplateSchema.safeParse(raw);
  if (!parsed.success) return { status: 'error', message: 'Check the fields.' };

  try {
    await apiFetch(`/messaging/templates/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toState(error, 'The template could not be updated.');
  }
  revalidatePath('/messaging');
  return { status: 'success', message: 'Saved.' };
}

/**
 * Sends one templated message.
 *
 * A suppressed send is not an error — the gate did its job. It comes back as a
 * distinct state so the screen can say *why* rather than showing a red banner
 * that reads like a fault.
 */
export async function sendMessage(
  _p: MessagingState,
  formData: FormData,
): Promise<MessagingState> {
  const variables: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('var:') && typeof value === 'string') {
      variables[key.slice(4)] = value;
    }
  }

  const parsed = sendMessageSchema.safeParse({
    templateCode: formData.get('templateCode'),
    leadId: formData.get('leadId') || undefined,
    customerId: formData.get('customerId') || undefined,
    variables,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Choose a template.' };
  }

  try {
    const result = await apiFetch<{ status: string; reason: string | null }>('/messaging/send', {
      method: 'POST',
      body: parsed.data,
    });

    revalidatePath('/messaging');
    if (result.status === 'SUPPRESSED') {
      return {
        status: 'success',
        message: 'Not sent.',
        suppressedReason: result.reason ?? 'The compliance gate refused it.',
      };
    }
    return { status: 'success', message: 'Sent.' };
  } catch (error) {
    return toState(error, 'The message could not be sent.');
  }
}
