'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { submitInstaLead, type InstaState } from '@/app/actions/insta-lead';

const INITIAL: InstaState = { status: 'idle' };

interface Colleague {
  id: string;
  fullName: string;
  employeeCode?: string | null;
}

function SubmitButton({ atClient }: { atClient: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary h-12 w-full text-base disabled:opacity-60"
    >
      {pending
        ? 'Saving…'
        : atClient
          ? 'Save & take check-in photo'
          : 'Save & start meeting'}
    </button>
  );
}

/**
 * Two fields, a choice of where, and one tap.
 *
 * Everything the ordinary lead form asks for is missing on purpose. At the door
 * a rep would be guessing at products and value; a minute after the
 * conversation they will know, and the lead's own page is where that belongs.
 */
export function InstaLeadForm({
  colleagues,
  clientSiteMode,
  officeMode,
}: {
  colleagues: Colleague[];
  /** Master code for a visit at the client's premises — demands a photo. */
  clientSiteMode: string;
  /** Master code for a visit at our own office — no photo needed. */
  officeMode: string;
}) {
  const [state, action] = useActionState(submitInstaLead, INITIAL);
  const [atClient, setAtClient] = useState(true);
  const [withColleague, setWithColleague] = useState(false);
  /*
    State, not a ref.

    The fix is rendered into hidden inputs, so it has to be something React
    re-renders on. Held in a ref it arrives after first paint, nothing
    re-renders, and the position silently never reaches the form — which is the
    worst kind of bug here, because the visit would just quietly be unverified.
  */
  const [fix, setFix] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);

  /*
    Ask for the fix while the rep types, not when they submit.

    Getting a position can take several seconds, and a rep mid-handshake will
    not wait for it. Requested once on mount and used only if it has arrived by
    the time the form is sent — a missing fix marks the visit unverified, which
    is a far better outcome than a spinner between a rep and a client.
  */
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="mode" value={atClient ? clientSiteMode : officeMode} />
      {fix ? (
        <>
          <input type="hidden" name="latitude" value={fix.latitude} />
          <input type="hidden" name="longitude" value={fix.longitude} />
          <input type="hidden" name="accuracy" value={fix.accuracy} />
        </>
      ) : null}

      <div>
        <label className="label" htmlFor="firstName">
          Name <span className="text-danger-500">*</span>
        </label>
        <input
          id="firstName"
          name="firstName"
          className="input h-12 text-base"
          autoComplete="off"
          autoFocus
          required
          placeholder="Who are you meeting?"
          aria-invalid={Boolean(state.errors?.firstName)}
        />
        {state.errors?.firstName ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.firstName[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="mobile">
          Mobile <span className="text-danger-500">*</span>
        </label>
        {/* `inputMode` and `type=tel` put the numeric keypad up on a phone,
            which is the difference between two taps and four. */}
        <input
          id="mobile"
          name="mobile"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          className="input h-12 text-base tnum"
          required
          placeholder="10-digit mobile"
          aria-invalid={Boolean(state.errors?.mobile)}
        />
        {state.errors?.mobile ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.mobile[0]}</p>
        ) : null}
      </div>

      <div>
        <span className="label">Where</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: true, label: 'At their place' },
            { value: false, label: 'At our office' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setAtClient(option.value)}
              aria-pressed={atClient === option.value}
              className={`h-12 rounded-lg border text-sm font-semibold transition-colors ${
                atClient === option.value
                  ? 'border-teal-500 bg-teal-500 text-white'
                  : 'border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          {atClient
            ? `A photo is taken at check-in.${fix ? ' Location ready.' : ''}`
            : 'Checked in straight away — no photo needed.'}
        </p>
      </div>

      {/* Collapsed by default: most meetings are one to one, and a picker open
          on arrival is a field to scroll past for everyone who does not need it. */}
      {colleagues.length > 0 ? (
        <div>
          {withColleague ? (
            <>
              <label className="label" htmlFor="attendeeUserId">
                Someone with me
              </label>
              <select
                id="attendeeUserId"
                name="attendeeUserId"
                className="input h-12 text-base"
                defaultValue=""
              >
                <option value="">Nobody</option>
                {colleagues.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                    {person.employeeCode ? ` [${person.employeeCode}]` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Confirmed as attending when you check out.
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setWithColleague(true)}
              className="text-sm font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
            >
              + Someone with me
            </button>
          )}
        </div>
      ) : null}

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton atClient={atClient} />

      <p className="text-center text-xs text-[var(--color-text-subtle)]">
        Products, email and follow-up are added afterwards — the lead is saved the moment you
        tap.
      </p>
    </form>
  );
}
