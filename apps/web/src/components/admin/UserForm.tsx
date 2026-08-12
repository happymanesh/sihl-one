'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ROLES, type DesignationSummary } from '@sihl-one/contracts';

import { createUser, updateUser, type UserFormState } from '@/app/actions/users';
import { humanise } from '@/lib/format';

const INITIAL: UserFormState = { status: 'idle' };

interface Option {
  id: string;
  label: string;
}

export interface UserFormValues {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string | null;
  employeeCode?: string | null;
  designationId?: string | null;
  orgUnitId?: string | null;
  managerId?: string | null;
  roleCodes?: string[];
  status?: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p className="mt-1 text-xs font-medium text-danger-500" role="alert">
      {errors[0]}
    </p>
  );
}

/**
 * Create and edit share one form.
 *
 * The manager list is refetched whenever the designation changes, because who
 * may manage someone depends entirely on where they sit — and the API only
 * offers people who are strictly more senior, which is what keeps skipped
 * levels valid without the UI having to know the rules.
 */
export function UserForm({
  mode,
  values,
  designations,
  orgUnits,
  grantableRoles,
}: {
  mode: 'create' | 'edit';
  values?: UserFormValues;
  designations: DesignationSummary[];
  orgUnits: Option[];
  grantableRoles: string[];
}) {
  const [state, action] = useActionState(mode === 'create' ? createUser : updateUser, INITIAL);
  const [designationId, setDesignationId] = useState(values?.designationId ?? '');
  const [managers, setManagers] = useState<Array<{ id: string; fullName: string; designation: string | null }>>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  useEffect(() => {
    if (!designationId) {
      setManagers([]);
      return;
    }

    let cancelled = false;
    setLoadingManagers(true);

    fetch(`/api/admin/manager-options?designationId=${designationId}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!cancelled) setManagers(data);
      })
      .catch(() => {
        if (!cancelled) setManagers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingManagers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [designationId]);

  const selected = designations.find((d) => d.id === designationId);

  return (
    <form action={action} className="space-y-5" noValidate>
      {values?.id ? <input type="hidden" name="userId" value={values.id} /> : null}

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}
      {state.status === 'success' && state.message ? (
        <div
          role="status"
          className="rounded-lg border border-teal-500/40 bg-teal-50 px-3 py-2.5 text-sm text-teal-700 dark:bg-teal-900/30 dark:text-teal-200"
        >
          {state.message}
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Person</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="firstName">
              First name <span className="text-danger-500">*</span>
            </label>
            <input
              id="firstName"
              name="firstName"
              className="input"
              required
              defaultValue={values?.firstName ?? ''}
            />
            <FieldError errors={state.errors?.firstName} />
          </div>
          <div>
            <label className="label" htmlFor="lastName">
              Last name <span className="text-danger-500">*</span>
            </label>
            <input
              id="lastName"
              name="lastName"
              className="input"
              required
              defaultValue={values?.lastName ?? ''}
            />
            <FieldError errors={state.errors?.lastName} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="email">
              Email <span className="text-danger-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              defaultValue={values?.email ?? ''}
              // Changing the sign-in identity of an existing account is an
              // identity operation, not a profile edit — it belongs with a
              // verification step rather than in this form.
              readOnly={mode === 'edit'}
              disabled={mode === 'edit'}
            />
            <FieldError errors={state.errors?.email} />
          </div>
          <div>
            <label className="label" htmlFor="mobile">
              Mobile
            </label>
            <input
              id="mobile"
              name="mobile"
              className="input"
              inputMode="numeric"
              defaultValue={values?.mobile ?? ''}
            />
            <FieldError errors={state.errors?.mobile} />
          </div>
          <div>
            <label className="label" htmlFor="employeeCode">
              Employee code
            </label>
            <input
              id="employeeCode"
              name="employeeCode"
              className="input font-mono uppercase"
              placeholder="SIHL-0421"
              defaultValue={values?.employeeCode ?? ''}
            />
            <FieldError errors={state.errors?.employeeCode} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Place in the hierarchy</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="designationId">
              Designation <span className="text-danger-500">*</span>
            </label>
            <select
              id="designationId"
              name="designationId"
              className="input"
              required
              value={designationId}
              onChange={(event) => setDesignationId(event.target.value)}
            >
              <option value="" disabled>
                Choose a level
              </option>
              {designations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.name}
                </option>
              ))}
            </select>
            {selected ? (
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Sees: {humanise(selected.defaultScope)} — derived from this level.
              </p>
            ) : null}
            <FieldError errors={state.errors?.designationId} />
          </div>

          <div>
            <label className="label" htmlFor="orgUnitId">
              Branch <span className="text-danger-500">*</span>
            </label>
            <select
              id="orgUnitId"
              name="orgUnitId"
              className="input"
              required
              defaultValue={values?.orgUnitId ?? ''}
            >
              <option value="" disabled>
                Choose a branch
              </option>
              {orgUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
            <FieldError errors={state.errors?.orgUnitId} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="managerId">
            Reports to
          </label>
          <select
            id="managerId"
            name="managerId"
            className="input"
            defaultValue={values?.managerId ?? ''}
            disabled={!designationId || loadingManagers}
          >
            <option value="">No manager</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.fullName}
                {manager.designation ? ` — ${manager.designation}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            {!designationId
              ? 'Choose a designation first.'
              : loadingManagers
                ? 'Loading…'
                : managers.length === 0
                  ? 'Nobody more senior is available to you — leave blank.'
                  : 'Anyone more senior. Levels can be skipped, so a Sales Manager may report straight to a Zonal Head.'}
          </p>
          <FieldError errors={state.errors?.managerId} />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-bold">Access</legend>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Only roles you hold yourself are offered — you cannot grant authority you do not have.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ROLES.filter((role) => grantableRoles.includes(role)).map((role) => (
            <label
              key={role}
              className="cursor-pointer rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold transition-colors has-[:checked]:border-navy-500 has-[:checked]:bg-navy-500 has-[:checked]:text-white"
            >
              <input
                type="checkbox"
                name="roleCodes"
                value={role}
                defaultChecked={values?.roleCodes?.includes(role)}
                className="sr-only"
              />
              {humanise(role)}
            </label>
          ))}
        </div>
        <FieldError errors={state.errors?.roleCodes} />
      </fieldset>

      {mode === 'edit' ? (
        <div>
          <label className="label" htmlFor="status">
            Account status
          </label>
          <select
            id="status"
            name="status"
            className="input w-auto"
            defaultValue={values?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'}
          >
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Suspending blocks sign-in but keeps their leads. To hand work over, use Offboard.
          </p>
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
        <Submit label={mode === 'create' ? 'Create user' : 'Save changes'} />
        <a href="/admin/users" className="btn btn-outline">
          Cancel
        </a>
      </div>

      {mode === 'create' ? (
        <p className="text-xs text-[var(--color-text-subtle)]">
          The account is created as <strong>Invited</strong> with no password. Issue credentials
          from their profile once created — creating a user never mints a working login on its own.
        </p>
      ) : null}
    </form>
  );
}
