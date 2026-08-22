'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ROLES, suggestWorkEmail, type DesignationSummary } from '@sihl-one/contracts';

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
  userType?: string;
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
  const [userType, setUserType] = useState(values?.userType ?? 'INTERNAL');
  const [firstName, setFirstName] = useState(values?.firstName ?? '');
  const [lastName, setLastName] = useState(values?.lastName ?? '');
  const [email, setEmail] = useState(values?.email ?? '');
  const [emailEdited, setEmailEdited] = useState(mode === 'edit');

  // Staff get an address built from their name; partners keep their own, so
  // there is nothing to suggest for them.
  const suggestsEmail = mode === 'create' && userType === 'INTERNAL';

  useEffect(() => {
    if (!suggestsEmail || emailEdited) return;
    // Uniqueness is settled by the server, which can see every address already
    // issued. This is the shape, shown early so the administrator can object to
    // it before the account exists.
    setEmail(suggestWorkEmail(firstName, lastName) ?? '');
  }, [firstName, lastName, suggestsEmail, emailEdited]);
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

      {mode === 'create' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Who is this login for?</legend>
          <input type="hidden" name="userType" value={userType} />
          <div className="flex gap-2">
            {(
              [
                ['INTERNAL', 'SIHL employee'],
                ['PARTNER', 'Associate partner'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex-1 cursor-pointer rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-center text-sm font-semibold transition-colors has-[:checked]:border-navy-500 has-[:checked]:bg-navy-500 has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="userTypeChoice"
                  value={value}
                  checked={userType === value}
                  onChange={() => setUserType(value)}
                  aria-label={label}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-subtle)]">
            {userType === 'INTERNAL'
              ? 'Gets an @sihl.in address and an employee code, both generated below.'
              : 'Signs in with their own email and the partner code from the back office.'}
          </p>
        </fieldset>
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
              onChange={(event) => setFirstName(event.target.value)}
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
              onChange={(event) => setLastName(event.target.value)}
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
              required={!suggestsEmail}
              value={mode === 'edit' ? undefined : email}
              defaultValue={mode === 'edit' ? (values?.email ?? '') : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                // Once an administrator types their own address, stop
                // overwriting it from the name. Silently correcting somebody's
                // deliberate edit is worse than not suggesting at all.
                setEmailEdited(true);
              }}
              // Changing the sign-in identity of an existing account is an
              // identity operation, not a profile edit — it belongs with a
              // verification step rather than in this form.
              readOnly={mode === 'edit'}
              disabled={mode === 'edit'}
            />
            {suggestsEmail && !emailEdited && email ? (
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Generated from the name. Type over it if this person needs a different address.
              </p>
            ) : null}
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
              {userType === 'PARTNER' ? (
                <>
                  Partner code <span className="text-danger-500">*</span>
                </>
              ) : (
                'Employee code'
              )}
            </label>
            <input
              id="employeeCode"
              name="employeeCode"
              className="input font-mono uppercase"
              placeholder={userType === 'PARTNER' ? 'R0018' : 'Generated'}
              required={userType === 'PARTNER'}
              defaultValue={values?.employeeCode ?? ''}
            />
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              {userType === 'PARTNER'
                ? 'The code the back office already issued this partner.'
                : 'Leave blank to generate the next one, SIHL-0001 onwards.'}
            </p>
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
