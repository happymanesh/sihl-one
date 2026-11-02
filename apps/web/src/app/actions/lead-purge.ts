'use server';

import {
  leadReferenceSchema,
  purgeLeadSchema,
  type LeadPurgePreview,
  type LeadPurgeResult,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { rethrowControlFlow } from '@/lib/rethrow';

/**
 * The two halves of a purge, as server actions.
 *
 * Kept out of `actions/leads.ts` for the same reason the service is kept out
 * of `LeadsService`: everything in that file is reversible and this is not,
 * and the two should not sit next to each other where a copy-paste can move
 * between them.
 *
 * Neither action re-checks the permission. The API does, on both calls, and a
 * check here would be a second answer to the same question that can disagree
 * with the first. What the page does with `can(user, 'lead:purge')` is hide a
 * control, which is a different job.
 */

export interface PurgeState {
  status: 'idle' | 'preview' | 'purged' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
  preview?: LeadPurgePreview;
  result?: LeadPurgeResult;
}

export const PURGE_INITIAL: PurgeState = { status: 'idle' };

function toError(error: unknown, fallback: string): PurgeState {
  rethrowControlFlow(error);
  if (error instanceof ApiError) {
    return {
      status: 'error',
      message: error.problem.detail ?? error.problem.title,
      errors: error.fieldErrors,
    };
  }
  return { status: 'error', message: fallback };
}

/** Look the number up and show what destroying it would take. Changes nothing. */
export async function previewPurge(_state: PurgeState, formData: FormData): Promise<PurgeState> {
  const parsed = leadReferenceSchema.safeParse(formData.get('reference') ?? '');
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'That is not a lead number.',
      errors: { reference: parsed.error.issues.map((issue) => issue.message) },
    };
  }

  try {
    const preview = await apiFetch<LeadPurgePreview>(
      `/leads/by-reference/${encodeURIComponent(parsed.data)}/purge-preview`,
    );
    return { status: 'preview', preview };
  } catch (error) {
    return toError(error, 'Could not look that lead up.');
  }
}

/**
 * Destroys it.
 *
 * The reference travels twice — once in the path, from the preview the user is
 * looking at, and once in the body, from what they typed. The API refuses
 * unless they agree, so this action does not compare them itself: one place
 * deciding is the point, and it is the place that does the deleting.
 */
export async function purgeLead(_state: PurgeState, formData: FormData): Promise<PurgeState> {
  const reference = leadReferenceSchema.safeParse(formData.get('reference') ?? '');
  if (!reference.success) {
    return { status: 'error', message: 'The lead number was lost between steps. Start again.' };
  }

  const body = purgeLeadSchema.safeParse({
    confirmReference: formData.get('confirmReference') ?? '',
    reason: formData.get('reason') ?? '',
  });

  if (!body.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of body.error.issues) {
      (errors[issue.path.join('.') || '_'] ??= []).push(issue.message);
    }
    return { status: 'error', message: 'Check the confirmation and the reason.', errors };
  }

  try {
    const result = await apiFetch<LeadPurgeResult>(
      `/leads/by-reference/${encodeURIComponent(reference.data)}`,
      { method: 'DELETE', body: body.data },
    );
    return { status: 'purged', result };
  } catch (error) {
    return toError(error, 'The purge did not run. Nothing was deleted.');
  }
}
