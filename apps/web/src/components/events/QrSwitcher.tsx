'use client';

import { useState, type ReactNode } from 'react';

/**
 * One QR at a time, chosen by a switch.
 *
 * There are two codes for the same event and they are not alternatives in the
 * usual sense — they are alternatives *per person*. Somebody running the event
 * prints the common code for the banner; a rep working the floor uses their own,
 * because that is the one that puts leads in their name. Showing both stacked
 * meant everyone scrolled past a code they would never use, and — worse at a
 * stall — made it possible to print the wrong one without noticing.
 *
 * So: a switch, defaulted to the code the viewer's job calls for, with the other
 * one always a tap away. When there is only a common code (no personal one, or
 * the event is not accepting scans) the switch is not drawn at all — a control
 * with one position is furniture.
 */
export function QrSwitcher({
  common,
  mine,
  /** Which code this viewer's job calls for. */
  defaultTab,
}: {
  common: ReactNode;
  mine: ReactNode | null;
  defaultTab: 'common' | 'mine';
}) {
  // A personal code that does not exist cannot be the starting position.
  const [tab, setTab] = useState<'common' | 'mine'>(mine ? defaultTab : 'common');
  const active = mine && tab === 'mine' ? 'mine' : 'common';

  const option = (value: 'common' | 'mine', label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      aria-pressed={active === value}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
        active === value
          ? // Brand green, filled: which code is on screen has to be readable
            // across a stall in daylight, and a white-on-grey chip is not.
            'bg-brand-green-700 text-white shadow-sm dark:bg-brand-green-600'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">{active === 'mine' ? 'Your QR' : 'Common QR'}</h2>

        {mine ? (
          <div
            role="group"
            aria-label="Which QR code to show"
            className="inline-flex gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1"
          >
            {option('common', 'Common QR')}
            {option('mine', 'Your QR')}
          </div>
        ) : null}
      </div>

      <div className="mt-4">{active === 'mine' ? mine : common}</div>
    </section>
  );
}
