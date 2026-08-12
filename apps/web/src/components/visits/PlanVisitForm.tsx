'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { planVisit, type VisitActionState } from '@/app/actions/visits';

const INITIAL: VisitActionState = { status: 'idle' };

interface Option {
  id: string;
  label: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Planning…' : 'Plan visit'}
    </button>
  );
}

export function PlanVisitForm({
  leads,
  customers,
  presetEntityType,
  presetEntityId,
}: {
  leads: Option[];
  customers: Option[];
  presetEntityType?: string;
  presetEntityId?: string;
}) {
  const [state, action] = useActionState(planVisit, INITIAL);
  const [entityType, setEntityType] = useState(presetEntityType ?? 'LEAD');

  const options = entityType === 'LEAD' ? leads : customers;

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}

      <div>
        <span className="label">Who are you visiting?</span>
        <div className="flex gap-2">
          {(['LEAD', 'CUSTOMER'] as const).map((type) => (
            <label
              key={type}
              className="flex-1 cursor-pointer rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-center text-sm font-semibold transition-colors has-[:checked]:border-navy-500 has-[:checked]:bg-navy-500 has-[:checked]:text-white"
            >
              <input
                type="radio"
                name="entityType"
                value={type}
                checked={entityType === type}
                onChange={() => setEntityType(type)}
                className="sr-only"
              />
              {type === 'LEAD' ? 'Lead' : 'Customer'}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="entityId">
          {entityType === 'LEAD' ? 'Lead' : 'Customer'} <span className="text-danger-500">*</span>
        </label>
        <select
          id="entityId"
          name="entityId"
          className="input"
          required
          defaultValue={presetEntityId ?? ''}
        >
          <option value="" disabled>
            Choose a record
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {options.length === 0 ? (
          <p className="mt-1.5 text-xs text-warn-600">
            Nothing to visit here yet. Only records in your data scope are listed.
          </p>
        ) : null}
        {state.errors?.entityId ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.entityId[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="purpose">
          Purpose <span className="text-danger-500">*</span>
        </label>
        <input
          id="purpose"
          name="purpose"
          className="input"
          required
          placeholder="Collect documents and close the account opening"
          aria-invalid={Boolean(state.errors?.purpose)}
        />
        {state.errors?.purpose ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.purpose[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="plannedAt">
          When (optional)
        </label>
        <input id="plannedAt" name="plannedAt" type="datetime-local" className="input" />
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          Leave blank for an unscheduled visit — it still shows on today’s plan.
        </p>
      </div>

      <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
        <SubmitButton />
        <a href="/visits" className="btn btn-outline">
          Cancel
        </a>
      </div>
    </form>
  );
}
