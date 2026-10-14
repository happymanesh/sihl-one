'use server';

import { revalidatePath } from 'next/cache';
import { rethrowControlFlow } from '@/lib/rethrow';
import {
  createLeadSourceSchema,
  createProductGroupSchema,
  createProductSchema,
  updateLeadSourceSchema,
  updateProductGroupSchema,
  updateProductSchema,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface MasterState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

function toState(error: unknown, fallback: string): MasterState {
  if (error instanceof ApiError) {
    // The API explains why a system row cannot be deleted, or which record
    // still uses it. That reason is the entire value of the message.
    return { status: 'error', message: error.problem.detail ?? error.problem.title };
  }
  return { status: 'error', message: fallback };
}

function refresh() {
  revalidatePath('/admin/masters');
  // The dropdowns read the same master, so they go stale the moment it changes.
  revalidatePath('/leads/new');
  revalidatePath('/leads');
  // Groups are the expertise checkboxes on the user form too, so a new desk has
  // to appear there without anyone redeploying.
  revalidatePath('/admin/users/new');
}

export async function createSource(_p: MasterState, formData: FormData): Promise<MasterState> {
  const parsed = createLeadSourceSchema.safeParse({
    code: formData.get('code'),
    label: formData.get('label'),
    description: formData.get('description') || undefined,
    scoringWeight: Number(formData.get('scoringWeight')),
    sortOrder: Number(formData.get('sortOrder') || 100),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch('/masters/lead-sources', { method: 'POST', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The source could not be added.');
  }
  refresh();
  return { status: 'success', message: `Added "${parsed.data.label}".` };
}

export async function updateSource(_p: MasterState, formData: FormData): Promise<MasterState> {
  const id = String(formData.get('id'));
  const raw: Record<string, unknown> = {};
  if (formData.get('label')) raw.label = formData.get('label');
  if (formData.get('scoringWeight')) raw.scoringWeight = Number(formData.get('scoringWeight'));
  if (formData.has('isActive')) raw.isActive = formData.get('isActive') === 'true';
  // A checkbox posts nothing when cleared, so the edit form carries a marker
  // alongside it — without that, unticking "recurring" would read as "the form
  // said nothing about it" and silently keep the old value.
  if (formData.has('recurringTouched')) raw.isRecurring = formData.get('isRecurring') === 'on';

  const parsed = updateLeadSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch(`/masters/lead-sources/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The source could not be updated.');
  }
  refresh();
  return { status: 'success', message: 'Saved.' };
}

export async function createProductGroup(
  _p: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const parsed = createProductGroupSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    sortOrder: Number(formData.get('sortOrder') || 100),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch('/masters/product-groups', { method: 'POST', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The group could not be added.');
  }
  refresh();
  return { status: 'success', message: `Added "${parsed.data.name}".` };
}

export async function updateProductGroup(
  _p: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const id = String(formData.get('id'));
  const raw: Record<string, unknown> = {};
  if (formData.has('name')) raw.name = formData.get('name');
  if (formData.has('sortOrder')) raw.sortOrder = Number(formData.get('sortOrder'));
  if (formData.has('isActive')) raw.isActive = formData.get('isActive') === 'true';

  const parsed = updateProductGroupSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch(`/masters/product-groups/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The group could not be updated.');
  }
  refresh();
  return { status: 'success', message: 'Saved.' };
}

export async function createProduct(_p: MasterState, formData: FormData): Promise<MasterState> {
  const parsed = createProductSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    // Blank means a top-level product. Only products that are not already
    // sub-products can be chosen as a parent; the API enforces that.
    parentId: formData.get('parentId') || undefined,
    groupId: formData.get('groupId') || undefined,
    isRecurring: formData.get('isRecurring') === 'on',
    summary: formData.get('summary') || undefined,
    description: formData.get('description') || undefined,
    keyBenefits: String(formData.get('keyBenefits') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    chargesSummary: formData.get('chargesSummary') || undefined,
    eligibility: formData.get('eligibility') || undefined,
    riskNote: formData.get('riskNote') || undefined,
    sortOrder: Number(formData.get('sortOrder') || 100),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch('/masters/products', { method: 'POST', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The product could not be added.');
  }
  refresh();
  return { status: 'success', message: `Added "${parsed.data.name}".` };
}

export async function updateProduct(_p: MasterState, formData: FormData): Promise<MasterState> {
  const id = String(formData.get('id'));
  const raw: Record<string, unknown> = {};
  /*
    Only fields the submitted form actually carried.

    The switch-off button posts nothing but `id` and `isActive`, and the edit
    form posts nothing but what it shows. Reading a field that was not sent
    would write null over it — which for `groupId` would mean every toggle
    quietly unfiled the product from its desk.
  */
  for (const field of [
    'name',
    'groupId',
    'summary',
    'description',
    'chargesSummary',
    'eligibility',
    'riskNote',
  ] as const) {
    // `|| null` is right for all of these: an empty box means "clear it", and
    // for the group that is the "No group" option.
    if (formData.has(field)) raw[field] = formData.get(field) || null;
  }
  if (formData.has('keyBenefits')) {
    raw.keyBenefits = String(formData.get('keyBenefits') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (formData.has('isActive')) raw.isActive = formData.get('isActive') === 'true';

  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  }
  try {
    await apiFetch(`/masters/products/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    rethrowControlFlow(error);
    return toState(error, 'The product could not be updated.');
  }
  refresh();
  return { status: 'success', message: 'Saved.' };
}
