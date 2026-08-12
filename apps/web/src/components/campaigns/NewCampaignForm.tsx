'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CAMPAIGN_CHANNELS } from '@sihl-one/contracts';

import { createCampaign, type CampaignFormState } from '@/app/actions/campaigns';
import { humanise } from '@/lib/format';

const INITIAL: CampaignFormState = { status: 'idle' };

/** Name → code, the way the person would have typed it themselves. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function NewCampaignForm() {
  const [state, action] = useActionState(createCampaign, INITIAL);
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

      <Field label="Campaign name" name="name" errors={state.errors?.name} required>
        <input
          id="name"
          name="name"
          required
          maxLength={160}
          placeholder="Diwali account opening drive"
          className="input"
          onChange={(event) => {
            // Derived until the user edits the code themselves, then left
            // alone — silently overwriting something someone typed is worse
            // than making them type it.
            if (!codeTouched) setCode(slugify(event.target.value));
          }}
        />
      </Field>

      <Field
        label="Campaign code"
        name="code"
        errors={state.errors?.code}
        required
        hint="Appears in the tracking link as utm_campaign. It cannot be changed later, because published links and every attributed lead depend on it."
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
          pattern="[a-z0-9][a-z0-9._\-]*"
          placeholder="diwali-2026"
          className="input font-mono"
        />
      </Field>

      <Field label="Objective" name="objective" errors={state.errors?.objective}>
        <input
          id="objective"
          name="objective"
          maxLength={200}
          placeholder="Open 500 new demat accounts in Gujarat"
          className="input"
        />
      </Field>

      <fieldset>
        <legend className="label">
          Channels <span className="text-danger-500">*</span>
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {CAMPAIGN_CHANNELS.map((channel) => (
            <label
              key={channel}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-semibold has-[:checked]:border-teal-500 has-[:checked]:bg-teal-50 dark:has-[:checked]:bg-teal-900/30"
            >
              <input type="checkbox" name="channels" value={channel} className="accent-teal-500" />
              {humanise(channel)}
            </label>
          ))}
        </div>
        {state.errors?.channels ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.channels[0]}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Budget (₹)" name="budget" errors={state.errors?.budget}>
          <input id="budget" name="budget" type="number" min="0" step="1" className="input" />
        </Field>
        <Field label="Starts" name="startsAt" errors={state.errors?.startsAt}>
          <input id="startsAt" name="startsAt" type="date" className="input" />
        </Field>
        <Field label="Ends" name="endsAt" errors={state.errors?.endsAt}>
          <input id="endsAt" name="endsAt" type="date" className="input" />
        </Field>
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
      {pending ? 'Creating…' : 'Create campaign'}
    </button>
  );
}
