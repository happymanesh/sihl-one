'use server';

import { revalidatePath } from 'next/cache';
import { mergeLeadsSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface MergeState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export async function mergeLeads(
  _previous: MergeState,
  formData: FormData,
): Promise<MergeState> {
  const parsed = mergeLeadsSchema.safeParse({
    survivorId: formData.get('survivorId'),
    duplicateId: formData.get('duplicateId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }

  try {
    const result = await apiFetch<{ gains: number }>('/duplicates/merge', {
      method: 'POST',
      body: parsed.data,
    });

    revalidatePath('/leads/duplicates');
    revalidatePath('/leads');
    return {
      status: 'success',
      message:
        result.gains > 0
          ? `Merged. The surviving lead picked up ${result.gains} ${result.gains === 1 ? 'detail' : 'details'}.`
          : 'Merged.',
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // The API explains *why* — a converted lead cannot be merged away, for
      // instance — and that reason is the whole value of the message.
      return { status: 'error', message: error.problem.detail ?? error.problem.title };
    }
    return { status: 'error', message: 'The merge could not be completed.' };
  }
}
