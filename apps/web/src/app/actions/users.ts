'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import {
  createDesignationSchema,
  createUserSchema,
  updateDesignationSchema,
  resetMfaSchema,
  updateUserSchema,
  type Role,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface UserFormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
  credentials?: { email: string; temporaryPassword: string };
}

function toErrorState(error: unknown, fallback: string): UserFormState {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      // The escalation guards return a plain-language reason ("you can only
      // manage people below your own designation"). Surfacing it verbatim is
      // far more useful than a generic "forbidden".
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

export async function createUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const parsed = createUserSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    // Blank means "generate one", which the schema allows and the server does.
    email: formData.get('email') || undefined,
    userType: formData.get('userType') || undefined,
    mobile: formData.get('mobile') || undefined,
    employeeCode: formData.get('employeeCode') || undefined,
    designationId: formData.get('designationId'),
    roleCodes: formData.getAll('roleCodes') as Role[],
    orgUnitId: formData.get('orgUnitId'),
    managerId: formData.get('managerId') || undefined,
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
    created = await apiFetch<{ id: string }>('/admin/users', {
      method: 'POST',
      body: parsed.data,
    });
  } catch (error) {
    return toErrorState(error, 'The user could not be created.');
  }

  revalidatePath('/admin/users');
  // Computed URL with a query string: typedRoutes cannot check it.
  redirect(`/admin/users/${created.id}?created=1` as Route);
}

export async function updateUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = String(formData.get('userId'));
  const managerId = formData.get('managerId');

  const parsed = updateUserSchema.safeParse({
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
    mobile: formData.get('mobile') || undefined,
    employeeCode: formData.get('employeeCode') || undefined,
    designationId: formData.get('designationId') || undefined,
    roleCodes: formData.getAll('roleCodes').length
      ? (formData.getAll('roleCodes') as Role[])
      : undefined,
    orgUnitId: formData.get('orgUnitId') || undefined,
    // An empty select means "no manager", which is a real state for whoever
    // sits at the top — so it must send null rather than be omitted.
    managerId: managerId === '' ? null : (managerId ?? undefined),
    status: formData.get('status') || undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/admin/users/${userId}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The user could not be updated.');
  }

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { status: 'success', message: 'Saved.' };
}

export async function issueCredentials(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = String(formData.get('userId'));

  try {
    const result = await apiFetch<{ email: string; temporaryPassword: string }>(
      `/admin/users/${userId}/credentials`,
      { method: 'POST', body: {} },
    );

    revalidatePath(`/admin/users/${userId}`);
    return {
      status: 'success',
      message: 'Credentials issued. This password is shown once.',
      credentials: result,
    };
  } catch (error) {
    return toErrorState(error, 'Credentials could not be issued.');
  }
}

/**
 * Clears a user's two-step verification.
 *
 * The way back from a lost phone with no recovery codes left. The API refuses
 * this on your own account — see the note on `adminReset`.
 */
export async function resetUserMfa(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = String(formData.get('userId'));

  const parsed = resetMfaSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Give a reason.' };
  }

  try {
    const result = await apiFetch<{ sessionsRevoked: number }>(
      `/admin/users/${userId}/mfa-reset`,
      { method: 'POST', body: parsed.data },
    );

    revalidatePath(`/admin/users/${userId}`);
    return {
      status: 'success',
      message:
        `Two-step verification cleared. They can sign in with their password alone and set it ` +
        `up again. ${result.sessionsRevoked} ${result.sessionsRevoked === 1 ? 'session was' : 'sessions were'} signed out.`,
    };
  } catch (error) {
    return toErrorState(error, 'It could not be reset.');
  }
}

export async function createDesignation(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const parsed = createDesignationSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    level: Number(formData.get('level')),
    defaultScope: formData.get('defaultScope'),
    isActive: formData.get('isActive') === 'on',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the level details.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch('/admin/designations', { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The level could not be added.');
  }

  revalidatePath('/admin/designations');
  return { status: 'success', message: `Added "${parsed.data.name}".` };
}

export async function toggleDesignation(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const id = String(formData.get('designationId'));
  const isActive = formData.get('isActive') === 'true';

  const parsed = updateDesignationSchema.safeParse({ isActive });
  if (!parsed.success) return { status: 'error', message: 'Invalid change.' };

  try {
    await apiFetch(`/admin/designations/${id}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The level could not be changed.');
  }

  revalidatePath('/admin/designations');
  return { status: 'success', message: isActive ? 'Level activated.' : 'Level deactivated.' };
}
