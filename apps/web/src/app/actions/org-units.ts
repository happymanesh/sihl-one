'use server';

import { revalidatePath } from 'next/cache';
import { createOrgUnitSchema, moveOrgUnitSchema, updateOrgUnitSchema } from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface OrgState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

function toState(error: unknown, fallback: string): OrgState {
  if (error instanceof ApiError) {
    // The API explains the placement rule, the loop, or who is still assigned
    // here. That sentence is the whole value of the message.
    return { status: 'error', message: error.problem.detail ?? error.problem.title };
  }
  return { status: 'error', message: fallback };
}

function refresh() {
  revalidatePath('/admin/org-units');
  // The user form offers these as places to put people.
  revalidatePath('/admin/users');
}

export async function createOrgUnit(_p: OrgState, formData: FormData): Promise<OrgState> {
  const parsed = createOrgUnitSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    type: formData.get('type'),
    parentId: formData.get('parentId') || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch('/org-units', { method: 'POST', body: parsed.data });
  } catch (error) {
    return toState(error, 'The unit could not be created.');
  }
  refresh();
  return { status: 'success', message: `Added ${parsed.data.name}.` };
}

export async function updateOrgUnit(_p: OrgState, formData: FormData): Promise<OrgState> {
  const id = String(formData.get('id'));
  const raw: Record<string, unknown> = {};
  if (formData.get('name')) raw.name = formData.get('name');
  if (formData.has('isActive')) raw.isActive = formData.get('isActive') === 'true';

  const parsed = updateOrgUnitSchema.safeParse(raw);
  if (!parsed.success) return { status: 'error', message: 'Check the fields.' };

  try {
    await apiFetch(`/org-units/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toState(error, 'The unit could not be updated.');
  }
  refresh();
  return { status: 'success', message: 'Saved.' };
}

export async function moveOrgUnit(_p: OrgState, formData: FormData): Promise<OrgState> {
  const id = String(formData.get('id'));
  const parsed = moveOrgUnitSchema.safeParse({
    parentId: formData.get('parentId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Choose a parent and give a reason.',
    };
  }
  try {
    await apiFetch(`/org-units/${id}/move`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toState(error, 'The unit could not be moved.');
  }
  refresh();
  return { status: 'success', message: 'Moved. Everything under it moved with it.' };
}

/**
 * Switch event access on or off for a branch or region.
 *
 * Applies to everything beneath the unit as well, which is why this is its own
 * action and not a checkbox folded into the rename panel: it changes what a
 * whole subtree can see, and a change with that reach should be one deliberate
 * click rather than a field somebody saves by accident while fixing a typo.
 *
 * Shaped to the same `UserFormState` the switch component expects, so one
 * control serves both this screen and the hierarchy-level one.
 */
export async function toggleOrgUnitEvents(
  _p: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const id = String(formData.get('id'));
  const canAccessEvents = formData.get('canAccessEvents') === 'true';

  const parsed = updateOrgUnitSchema.safeParse({ canAccessEvents });
  if (!parsed.success) return { status: 'error', message: 'Invalid change.' };

  try {
    await apiFetch(`/org-units/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toState(error, 'Event access could not be changed.');
  }
  refresh();
  return {
    status: 'success',
    message: canAccessEvents ? 'Events switched on here.' : 'Events switched off here.',
  };
}
