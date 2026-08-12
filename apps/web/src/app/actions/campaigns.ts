'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import {
  changeCampaignStatusSchema,
  createCampaignSchema,
  updateCampaignSchema,
  type CampaignChannel,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface CampaignFormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

function toErrorState(error: unknown, fallback: string): CampaignFormState {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      // The API explains a taken code by naming the campaign that holds it.
      // That detail is far more useful than "conflict".
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

export async function createCampaign(
  _previous: CampaignFormState,
  formData: FormData,
): Promise<CampaignFormState> {
  const budget = formData.get('budget');

  const parsed = createCampaignSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code'),
    objective: formData.get('objective') || undefined,
    channels: formData.getAll('channels') as CampaignChannel[],
    budget: budget ? Number(budget) : undefined,
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
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
    created = await apiFetch<{ id: string }>('/campaigns', {
      method: 'POST',
      body: parsed.data,
    });
  } catch (error) {
    return toErrorState(error, 'The campaign could not be created.');
  }

  revalidatePath('/campaigns');
  redirect(`/campaigns/${created.id}` as Route);
}

export async function changeCampaignStatus(
  _previous: CampaignFormState,
  formData: FormData,
): Promise<CampaignFormState> {
  const campaignId = String(formData.get('campaignId'));

  const parsed = changeCampaignStatusSchema.safeParse({ status: formData.get('status') });
  if (!parsed.success) return { status: 'error', message: 'Unknown status.' };

  try {
    await apiFetch(`/campaigns/${campaignId}/status`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The status could not be changed.');
  }

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
  return { status: 'success', message: 'Status updated.' };
}

export async function recordSpend(
  _previous: CampaignFormState,
  formData: FormData,
): Promise<CampaignFormState> {
  const campaignId = String(formData.get('campaignId'));
  const actualSpend = formData.get('actualSpend');

  const parsed = updateCampaignSchema.safeParse({
    // An empty box means "I do not know what this cost", which must clear the
    // figure rather than record zero — the two read very differently on the
    // return-on-spend panel.
    actualSpend: actualSpend === '' || actualSpend === null ? null : Number(actualSpend),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter a valid amount.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/campaigns/${campaignId}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The spend could not be recorded.');
  }

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
  return { status: 'success', message: 'Saved.' };
}
