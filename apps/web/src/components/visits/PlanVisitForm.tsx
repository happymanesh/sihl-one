'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DEFAULT_VISIT_MODE, visitEvidenceRules, type MeetingModeItem } from '@sihl-one/contracts';

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
  meetingModes,
  presetEntityType,
  presetEntityId,
  colleagues = [],
}: {
  leads: Option[];
  customers: Option[];
  meetingModes: MeetingModeItem[];
  presetEntityType?: string;
  presetEntityId?: string;
  /** People the rep may bring, from `/users/assignable`. */
  colleagues?: Array<{ id: string; fullName: string; employeeCode?: string | null }>;
}) {
  const [state, action] = useActionState(planVisit, INITIAL);
  const [bringing, setBringing] = useState<string[]>([]);
  const [entityType, setEntityType] = useState(presetEntityType ?? 'LEAD');
  const [mode, setMode] = useState(DEFAULT_VISIT_MODE);

  const options = entityType === 'LEAD' ? leads : customers;
  const selectedMode = meetingModes.find((item) => item.code === mode);
  const evidence = visitEvidenceRules(selectedMode);

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

      {meetingModes.length > 0 ? (
        <div>
          <label className="label" htmlFor="mode">
            How will this happen? <span className="text-danger-500">*</span>
          </label>
          <select
            id="mode"
            name="mode"
            className="input"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            aria-describedby="mode-note"
          >
            {meetingModes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>

          {/* Say now what check-in will ask for. A rep who discovers at the
              client's door that a photo is required has been ambushed by the
              software; one who read it while planning has not. */}
          <p id="mode-note" className="mt-1 text-xs text-[var(--color-text-muted)]">
            {selectedMode?.meaning ? `${selectedMode.meaning} ` : ''}
            {evidence.photo
              ? 'Check-in will ask for a photo taken in the app.'
              : 'No check-in photo is needed for this mode.'}
          </p>

          {state.errors?.mode ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.mode[0]}</p>
          ) : null}
        </div>
      ) : null}

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

      {colleagues.length > 0 ? (
        <div>
          <label className="label" htmlFor="attendees">
            Bringing anyone?{' '}
            <span className="font-normal text-[var(--color-text-subtle)]">Optional</span>
          </label>
          <select
            id="attendees"
            multiple
            value={bringing}
            onChange={(event) =>
              setBringing(Array.from(event.target.selectedOptions, (option) => option.value))
            }
            className="input min-h-[5.5rem]"
          >
            {/*
              The employee code in brackets is not decoration. Two people called
              Priya Shah is ordinary at this size, and picking the wrong one puts
              a colleague's name against a client meeting they never attended.
            */}
            {colleagues.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
                {person.employeeCode ? ` [${person.employeeCode}]` : ''}
              </option>
            ))}
          </select>
          {/*
            Posted as repeated hidden fields, which the action reads with
            getAll. A multiple <select> does not post reliably across mobile
            browsers, and this form is filled in between meetings.
          */}
          {bringing.map((id) => (
            <input key={id} type="hidden" name="attendees" value={id} />
          ))}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {bringing.length === 0
              ? 'The visit stays yours either way — this only records who supported it.'
              : `${bringing.length} colleague${bringing.length === 1 ? '' : 's'} joining. You can change this later.`}
          </p>
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
        <SubmitButton />
        <a href="/visits" className="btn btn-outline">
          Cancel
        </a>
      </div>
    </form>
  );
}
