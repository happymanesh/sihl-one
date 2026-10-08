'use client';

import { useRouter } from 'next/navigation';
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
  /** Shown while the option list is loading, so the field is never blank. */
  managerName?: string | null;
  roleCodes?: string[];
  /** Product group codes this person sells. */
  productGroups?: string[];
  /** False when this person may not hand leads to anybody. */
  canAssignLeads?: boolean;
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
  productGroups = [],
}: {
  mode: 'create' | 'edit';
  values?: UserFormValues;
  designations: DesignationSummary[];
  orgUnits: Option[];
  grantableRoles: string[];
  /** Product groups this person can be marked as selling. */
  productGroups?: Option[];
}) {
  const [state, action] = useActionState(mode === 'create' ? createUser : updateUser, INITIAL);
  const router = useRouter();

  /*
    Pull the saved record back after a successful edit.

    `revalidatePath` in the action clears the server cache, but nothing on this
    page re-reads it: the administrator stays put, and the heading, the badges
    and the Users list they go back to all keep showing what was there before.
    That is the "changes are not reflected until I go back to Users and open the
    person again" complaint.

    Keyed on `state`, not `state.status`. The status is the string "success"
    both times, so two saves in a row look identical to the effect and the
    second one would not refresh. `useActionState` hands back a new object per
    dispatch, which does not.
  */
  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);
  /*
    Which action result the dialog has already been dismissed for.

    Compared by identity, not by status: `useActionState` returns a new object
    per dispatch, so two failed saves in a row are two different objects and the
    second re-opens the dialog. Comparing the status string would have shown it
    once and then stayed quiet.
  */
  const [dismissed, setDismissed] = useState<unknown>(null);
  const outcome =
    state.status !== 'idle' && state !== dismissed
      ? {
          status: state.status,
          message: state.message ?? (state.status === 'success' ? 'Saved.' : 'That did not save.'),
          // Every field error, spelled out. The banner used to show only the
          // headline, so "Please correct the highlighted fields" was the whole
          // explanation for a save that failed on something off-screen.
          details: Object.entries(state.errors ?? {}).flatMap(([field, messages]) =>
            (messages ?? []).map((message) => `${humaniseField(field)}: ${message}`),
          ),
        }
      : null;

  const [expertise, setExpertise] = useState<string[]>(values?.productGroups ?? []);
  const [designationId, setDesignationId] = useState(values?.designationId ?? '');
  /*
    Controlled, not `defaultValue`.

    The options are fetched after mount, so on first render this select holds
    only "No manager". `defaultValue` is applied once, at that moment, and React
    never re-applies it when the real options arrive — which is why a user with
    a manager on record read "No manager" on every edit, and why saving the form
    unchanged would then quietly clear the manager.
  */
  const [managerId, setManagerId] = useState(values?.managerId ?? '');
  /*
    Status and branch are controlled for the same reason as the manager, and
    re-synced below when the record changes.

    `defaultValue` is applied once, at mount. After a save the page refreshes
    and hands this component the stored record, but an uncontrolled select keeps
    whatever it had — so suspending somebody left the badge reading Suspended
    and the dropdown beneath it reading Active. Two parts of one screen
    disagreeing about the same field is what makes an administrator doubt the
    save rather than the screen.
  */
  const [status, setStatus] = useState(values?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
  const [orgUnitId, setOrgUnitId] = useState(values?.orgUnitId ?? '');

  /*
    Follow the record, not the last thing typed.

    Adjusted during render rather than in an effect — the pattern React
    documents for "reset state when a prop changes". An effect would work but
    renders once with the stale value first, and the linter is right to object.

    Compared on a signature of the three fields rather than on `values`, which
    is a fresh object on every server render and would loop.

    Remounting the whole form would achieve the same and would take the "Saved."
    confirmation with it — the one thing the reader is actually looking for.
  */
  const recordSignature = `${values?.status ?? ''}|${values?.orgUnitId ?? ''}|${values?.managerId ?? ''}`;
  const [seenSignature, setSeenSignature] = useState(recordSignature);
  if (seenSignature !== recordSignature) {
    setSeenSignature(recordSignature);
    setStatus(values?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
    setOrgUnitId(values?.orgUnitId ?? '');
    setManagerId(values?.managerId ?? '');
  }
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
  const [managers, setManagers] = useState<
    Array<{ id: string; fullName: string; designation: string | null }>
  >([]);
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

      {/*
        The outcome of a save, as a dialog rather than a strip at the top.

        The strip appeared above a long form, so on anything below the fold a
        save looked like it had done nothing at all — the page simply sat there.
        A dialog is in front of the person wherever they were, and it has to be
        dismissed, so a failure cannot be scrolled past unnoticed.

        Field-level errors stay where they are, under their fields. This says
        what happened; those say where.
      */}
      {outcome ? (
        <SaveOutcome
          status={outcome.status}
          message={outcome.message}
          details={outcome.details}
          onClose={() => setDismissed(state)}
        />
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
            {/*
              Staff type the number; the prefix is shown, not typed.

              A fixed SIHL- in front of the box is the whole instruction, which
              is why the grey line underneath has gone — it was explaining a
              format the field now simply has. Partners keep a plain box,
              because their code is whatever the back office issued and is not
              ours to shape.
            */}
            {userType === 'PARTNER' ? (
              <input
                id="employeeCode"
                name="employeeCode"
                className="input font-mono uppercase"
                placeholder="R0018"
                required
                defaultValue={values?.employeeCode ?? ''}
              />
            ) : (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-3 font-mono text-sm text-[var(--color-text-muted)]">
                  SIHL-
                </span>
                <input
                  id="employeeCode"
                  name="employeeCode"
                  className="input rounded-l-none font-mono"
                  inputMode="numeric"
                  placeholder="Generated"
                  defaultValue={(values?.employeeCode ?? '').replace(/^SIHL-/i, '')}
                />
              </div>
            )}
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
              onChange={(event) => {
                setDesignationId(event.target.value);
                // Who may manage whom depends on the level, so a manager
                // chosen under the old one may no longer be eligible. Clearing
                // is the honest default: better an empty field the
                // administrator must fill than a stale name that silently
                // fails validation on save.
                setManagerId('');
              }}
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
              value={orgUnitId}
              onChange={(event) => setOrgUnitId(event.target.value)}
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
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            disabled={!designationId || loadingManagers}
          >
            <option value="">No manager</option>
            {/*
              The person on record is listed even when the options have not
              arrived, or no longer include them — somebody may report to a
              manager the current rules would not offer. Without this the select
              has no option matching its value and silently renders blank.
            */}
            {values?.managerId && !managers.some((m) => m.id === values.managerId) ? (
              <option value={values.managerId}>{values.managerName ?? 'Current manager'}</option>
            ) : null}
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

      {/*
        What this person sells.

        Offered only when there are groups to offer, so the section does not
        appear as an empty box on an environment where the product master has
        not been grouped yet. Unticked across the board means "no stated
        expertise", which the assignment engine reads as eligible for anything
        — the opposite would quietly make a new joiner ineligible for every
        lead until somebody remembered this screen.
      */}
      {productGroups.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-bold">Expertise</legend>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            The product groups this person sells. Leads for a matching group are offered to them
            first; leaving it blank keeps them eligible for everything.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {productGroups.map((group) => {
              const on = expertise.includes(group.id);
              return (
                <label
                  key={group.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    on
                      ? 'border-teal-500 bg-teal-50 font-semibold dark:bg-teal-900/30'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="productGroups"
                    value={group.id}
                    checked={on}
                    onChange={() =>
                      setExpertise((current) =>
                        current.includes(group.id)
                          ? current.filter((code) => code !== group.id)
                          : [...current, group.id],
                      )
                    }
                    className="h-4 w-4 accent-[var(--color-teal-500)]"
                  />
                  {group.label}
                </label>
              );
            })}
          </div>
          <FieldError errors={state.errors?.productGroups} />
        </fieldset>
      ) : null}

      {/*
        Whether this person may hand a lead to somebody else.

        Sits with Access because it qualifies the roles directly above it: a
        role may grant `lead:assign` and this takes it back for one person. It
        only ever subtracts — switching it on does not give the permission to
        somebody whose role never had it.

        Deliberately absent from the user list. It is a setting rather than an
        attribute people scan a directory for, and the list is already seven
        columns wide; it appears in the download, where somebody auditing who
        can move leads will actually look.
      */}
      <fieldset>
        <legend className="text-sm font-bold">Lead assignment</legend>
        <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="canAssignLeads"
            defaultChecked={values?.canAssignLeads ?? true}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-teal-500)]"
          />
          <span>
            May assign leads to other people
            <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">
              On by default. Switching it off removes the ability for this person only — their role
              is unchanged, and everyone else who holds it keeps it.
            </span>
          </span>
        </label>
        <FieldError errors={state.errors?.canAssignLeads} />
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
            value={status}
            onChange={(event) => setStatus(event.target.value)}
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

/** "orgUnitId" reads as a database column; "Branch" reads as the thing it is. */
const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  mobile: 'Mobile',
  employeeCode: 'Employee code',
  designationId: 'Designation',
  orgUnitId: 'Branch',
  managerId: 'Reports to',
  roleCodes: 'Roles',
  dataScope: 'Data scope',
  productGroups: 'Expertise',
  userType: 'Login type',
  _: 'Problem',
};

function humaniseField(field: string): string {
  return FIELD_LABELS[field] ?? humanise(field);
}

/**
 * What happened to the save, in front of the person who asked.
 *
 * Carries an icon as well as a colour, because colour alone is not an answer
 * for anyone who cannot distinguish the two — and a tick and a cross read
 * faster than either.
 */
function SaveOutcome({
  status,
  message,
  details,
  onClose,
}: {
  status: 'success' | 'error';
  message: string;
  details: string[];
  onClose: () => void;
}) {
  const ok = status === 'success';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-navy-950/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="save-outcome-title"
    >
      <div className="card w-full max-w-md p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              ok ? 'bg-teal-500 text-white' : 'bg-danger-500 text-white'
            }`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              {ok ? (
                <path
                  d="m5 13 4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M18 6 6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </span>

          <div className="min-w-0">
            <h2 id="save-outcome-title" className="text-base font-bold">
              {ok ? 'Saved' : 'Not saved'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{message}</p>

            {details.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-danger-600 dark:text-danger-400">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            {ok ? 'Done' : 'Back to the form'}
          </button>
        </div>
      </div>
    </div>
  );
}
