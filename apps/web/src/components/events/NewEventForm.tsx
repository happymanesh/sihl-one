'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createEvent, type EventFormState } from '@/app/actions/events';

const INITIAL: EventFormState = { status: 'idle' };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function NewEventForm({
  owners = [],
  branches = [],
  defaultOwnerId,
}: {
  /** Who this event may be assigned to. */
  owners?: Array<{ id: string; fullName: string }>;
  /** The org tree, so an event can be pinned below the company root. */
  branches?: Array<{ id: string; name: string; depth: number }>;
  /** The person creating it, pre-selected because they usually are the owner. */
  defaultOwnerId?: string;
}) {
  const [state, action] = useActionState(createEvent, INITIAL);
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);

  return (
    <form action={action} className="card space-y-4 p-5">
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <Field label="Event name" name="name" errors={state.errors?.name} required>
        <input
          id="name"
          name="name"
          required
          maxLength={160}
          placeholder="Ahmedabad Investor Expo 2026"
          className="input"
          onChange={(event) => {
            if (!codeTouched) setCode(slugify(event.target.value));
          }}
        />
      </Field>

      <Field
        label="Event code"
        name="code"
        errors={state.errors?.code}
        required
        hint="Appears in the QR link. It cannot be changed once the QR is printed."
      >
        <input
          id="code"
          name="code"
          required
          value={code}
          onChange={(event) => {
            setCodeTouched(true);
            setCode(event.target.value);
          }}
          maxLength={60}
          pattern="[a-z0-9][a-z0-9\-]*"
          placeholder="ahmedabad-expo-2026"
          className="input font-mono"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Venue" name="venue" errors={state.errors?.venue}>
          <input id="venue" name="venue" maxLength={200} className="input" />
        </Field>
        <Field label="City" name="city" errors={state.errors?.city}>
          <input id="city" name="city" maxLength={80} className="input" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Starts" name="startsAt" errors={state.errors?.startsAt} required>
          <input id="startsAt" name="startsAt" type="datetime-local" required className="input" />
        </Field>
        <Field label="Ends" name="endsAt" errors={state.errors?.endsAt}>
          <input id="endsAt" name="endsAt" type="datetime-local" className="input" />
        </Field>
        <Field
          label="Expected footfall"
          name="expectedFootfall"
          errors={state.errors?.expectedFootfall}
        >
          <input
            id="expectedFootfall"
            name="expectedFootfall"
            type="number"
            min="0"
            className="input"
          />
        </Field>
      </div>

      {/*
        Owner and branch, together, because they answer the same question:
        who is this event's, and where does it sit.

        Both were previously implicit — owner defaulted to whoever clicked
        create, branch to that person's own unit. For an administrator working
        at the company root that put every event and every unclaimed lead it
        produced above the whole org tree, where scope matches downward and so
        nobody at branch level could see any of it.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        {owners.length > 0 ? (
          <Field label="Owner" name="ownerId" errors={state.errors?.ownerId} required>
            <select
              id="ownerId"
              name="ownerId"
              className="input"
              required
              defaultValue={defaultOwnerId ?? ''}
            >
              <option value="" disabled>
                Choose an owner
              </option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.fullName}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          // No list to choose from — the API still defaults the owner to the
          // creator, so the event is never left without one.
          <input type="hidden" name="ownerId" value={defaultOwnerId ?? ''} />
        )}

        {branches.length > 0 ? (
          <Field label="Branch" name="orgUnitId" errors={state.errors?.orgUnitId}>
            <select id="orgUnitId" name="orgUnitId" className="input" defaultValue="">
              <option value="">Same as mine</option>
              {branches.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {' '.repeat(unit.depth * 2)}
                  {unit.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <Submit />
    </form>
  );
}

function Field({
  label,
  name,
  errors,
  required,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors?: string[];
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label} {required ? <span className="text-danger-500">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
      {errors ? <p className="mt-1 text-xs text-danger-500">{errors[0]}</p> : null}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Creating…' : 'Create event and get the QR'}
    </button>
  );
}
