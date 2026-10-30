'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { TrainingView } from '@sihl-one/contracts';

import { createTraining, updateTraining, type TrainingState } from '@/app/actions/training';
import { useSelectResync } from '@/lib/use-select-resync';
import { BranchPicker, type BranchOption } from './BranchPicker';

const INITIAL: TrainingState = { status: 'idle' };

/**
 * A `datetime-local` value for an instant, in IST.
 *
 * The input has no zone and the browser reads it as local time, so the instant
 * has to be shifted into IST before being sliced — otherwise a session at 11am
 * IST opens for editing showing 05:30, which looks like data corruption.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const ist = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(ist.getHours())}:${pad(ist.getMinutes())}`;
}

/**
 * Schedule or edit a training session.
 *
 * One form for both, because the fields are identical and a second copy is a
 * second place for them to drift apart. `training` present means edit.
 *
 * Every field is controlled. A form action resets uncontrolled inputs once it
 * returns, so a refused save handed back an empty form — the same fault the
 * lead and user forms had, and the same fix.
 */
export function TrainingForm({
  branches,
  presenters,
  training,
}: {
  branches: BranchOption[];
  /** Staff who could be named as presenter. Optional — a guest has no login. */
  presenters: Array<{ id: string; fullName: string; employeeCode?: string | null }>;
  training?: TrainingView;
}) {
  const [state, action] = useActionState(training ? updateTraining : createTraining, INITIAL);

  const [values, setValues] = useState({
    topic: training?.topic ?? '',
    startsAt: training ? toLocalInput(training.startsAt) : '',
    durationMinutes: String(training?.durationMinutes ?? 60),
    presenterId: training?.presenterId ?? '',
    presenterName: training?.presenterId ? '' : (training?.presenterName ?? ''),
    remarks: training?.remarks ?? '',
  });
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
  });

  // The presenter select does not survive the form reset React performs once
  // the action returns — see the hook for why a select differs from an input.
  const form = useRef<HTMLFormElement>(null);
  useSelectResync(form, { presenterId: values.presenterId });

  return (
    <form ref={form} action={action} className="card space-y-4 p-5" noValidate>
      {training ? <input type="hidden" name="id" value={training.id} /> : null}

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="rounded-lg border border-teal-500/40 bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-500/15 dark:text-teal-200"
        >
          {state.message}
        </p>
      ) : null}

      <Field label="Topic" name="topic" errors={state.errors?.topic} required>
        <input
          id="topic"
          name="topic"
          maxLength={160}
          placeholder="Mutual fund suitability — what we may and may not say"
          className="input"
          aria-invalid={Boolean(state.errors?.topic)}
          {...bind('topic')}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" name="startsAt" errors={state.errors?.startsAt} required>
          <input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            className="input"
            aria-invalid={Boolean(state.errors?.startsAt)}
            {...bind('startsAt')}
          />
        </Field>
        <Field
          label="Duration"
          name="durationMinutes"
          errors={state.errors?.durationMinutes}
          required
          hint="Minutes. The session becomes read-only once it has run."
        >
          <input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min="5"
            max="600"
            step="5"
            className="input"
            aria-invalid={Boolean(state.errors?.durationMinutes)}
            {...bind('durationMinutes')}
          />
        </Field>
      </div>

      <Field
        label="Branches"
        name="branchIds"
        errors={state.errors?.branchIds}
        required
        hint="Who this session is announced to."
      >
        <BranchPicker
          branches={branches}
          defaultSelected={training?.branches.map((branch) => branch.id) ?? []}
        />
      </Field>

      {/*
        A colleague or a name, not both.

        Picking from the directory keeps the name correct if that person is
        later renamed; a guest trainer has no login, so the typed name has to
        stand on its own. Offering both at once produced sessions with two
        presenters and no way to tell which one turned up.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Presenter (from SIHL)" name="presenterId" errors={state.errors?.presenterId}>
          <select
            id="presenterId"
            name="presenterId"
            className="input"
            aria-invalid={Boolean(state.errors?.presenterId)}
            {...bind('presenterId')}
          >
            <option value="">Not a colleague</option>
            {presenters.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
                {person.employeeCode ? ` [${person.employeeCode}]` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Presenter (guest)"
          name="presenterName"
          errors={state.errors?.presenterName}
          hint="For an external trainer, who has no login here."
        >
          <input
            id="presenterName"
            name="presenterName"
            maxLength={120}
            className="input"
            disabled={values.presenterId !== ''}
            aria-invalid={Boolean(state.errors?.presenterName)}
            {...bind('presenterName')}
          />
        </Field>
      </div>

      <Field
        label="Remarks"
        name="remarks"
        errors={state.errors?.remarks}
        hint="Joining link, what to bring, anything the branches need to know."
      >
        <textarea
          id="remarks"
          name="remarks"
          rows={3}
          maxLength={2000}
          className="input"
          aria-invalid={Boolean(state.errors?.remarks)}
          {...bind('remarks')}
        />
      </Field>

      <Submit editing={Boolean(training)} />
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

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Schedule session'}
    </button>
  );
}
