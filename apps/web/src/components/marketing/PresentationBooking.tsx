'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { PresentationDay } from '@sihl-one/contracts';

import { bookPresentationSlots, type BookingState } from '@/app/actions/presentations';

const IDLE: BookingState = { status: 'idle' };

function BookButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-12 w-full" disabled={pending || count === 0}>
      {pending ? 'Holding your seat…' : count === 1 ? 'Book this talk' : `Book ${count} talks`}
    </button>
  );
}

/**
 * 26 Sep, and 14:30, in the timezone the event is run in.
 *
 * Two day formatters, because there are two kinds of value here and reading one
 * with the other's rules is exactly the bug the timezone work went after.
 * `DAY_KEY` formats a plain `YYYY-MM-DD` the API has already grouped by, so it
 * must be read as UTC or the label slides a day. `DAY` formats a real instant,
 * so it must be read in IST — a talk at half past midnight would otherwise be
 * announced on the previous day.
 */
const DAY_KEY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
});

/**
 * Booking a seat at a talk, straight after registering.
 *
 * Offered only to somebody whose number has just been proven — the pass is
 * minted at that moment and carries nothing else. If no talks are on offer the
 * whole section renders nothing, so the visitor is never shown a button that
 * leads to an empty list.
 */
export function PresentationBooking({
  eventCode,
  bookingToken,
  needsEmail,
}: {
  eventCode: string;
  bookingToken: string;
  /** True when the visitor gave no email at registration. */
  needsEmail: boolean;
}) {
  const [days, setDays] = useState<PresentationDay[] | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action] = useActionState(bookPresentationSlots, IDLE);

  /*
    The schedule is fetched rather than passed in, because it changes while the
    stall is open: a talk can start, fill or be cancelled between the page
    being rendered and the visitor finishing the form.
  */
  useEffect(() => {
    let live = true;
    fetch(`/api/presentations/public/${encodeURIComponent(eventCode)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PresentationDay[]) => {
        if (live) setDays(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (live) setDays([]);
      });
    return () => {
      live = false;
    };
  }, [eventCode]);

  const slotCount = (days ?? []).reduce((sum, day) => sum + day.slots.length, 0);

  // Nothing on offer, or not loaded yet: show nothing at all rather than a
  // button that opens an empty list.
  if (days === null || slotCount === 0) return null;

  if (state.status === 'success') {
    return (
      /*
        The palette stops at brand-green-800.

        This box asked for `dark:bg-brand-green-900/20`, which does not exist,
        so the dark override never applied and the panel stayed at the near-white
        50 — light text on a light ground, unreadable on the phone it is read on.
        Every colour here is now a shade that exists, and the text sets its own
        rather than inheriting whatever the page had.
      */
      <div className="mt-4 rounded-lg border border-brand-green-600/50 bg-brand-green-50 px-4 py-4 dark:bg-brand-green-800/30">
        <p className="font-bold text-brand-green-800 dark:text-brand-green-200">
          Your seat is booked
        </p>
        {state.message ? (
          <p className="mt-0.5 text-sm text-brand-green-700 dark:text-brand-green-300">
            {state.message}
          </p>
        ) : null}

        {/*
          A table, not a list of run-together spans.

          This is read once, quickly, often while walking away from the desk, and
          it is the only record the visitor has of when to come back. Three
          columns that line up answer "when am I due" at a glance; a sentence
          does not. The presenter is deliberately absent — a name the visitor has
          never heard is noise beside the time they have to remember, and it is
          the one field on a talk that changes late.
        */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-brand-green-100 dark:bg-brand-green-800/60">
                <th
                  scope="col"
                  className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-green-800 dark:text-brand-green-100"
                >
                  When
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-green-800 dark:text-brand-green-100"
                >
                  Topic
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right text-xs font-bold uppercase tracking-wide text-brand-green-800 dark:text-brand-green-100"
                >
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {(state.booked ?? []).map((talk) => (
                <tr
                  key={`${talk.startsAt}-${talk.topic}`}
                  className="border-b border-brand-green-600/30 last:border-0"
                >
                  <td className="whitespace-nowrap px-2 py-2 align-top text-brand-green-800 dark:text-brand-green-100">
                    <span className="block text-xs text-brand-green-700 dark:text-brand-green-300">
                      {DAY.format(new Date(talk.startsAt))}
                    </span>
                    <span className="tnum block font-bold">
                      {CLOCK.format(new Date(talk.startsAt))}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top font-semibold text-brand-green-800 dark:text-brand-green-100">
                    {talk.topic}
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-2 align-top text-right text-brand-green-700 dark:text-brand-green-300">
                    {talk.durationMinutes} min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-brand-green-700 dark:text-brand-green-300">
          Please arrive a few minutes early and show this at the desk.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      /*
        The loudest thing on the screen after the confirmation itself.

        An outline button beside a filled one reads as the lesser option, and
        this is the only thing still being asked of the visitor — they are
        standing at the desk with the rep watching, and it has to be obvious.
      */
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary mt-4 h-14 w-full text-base font-bold"
      >
        Book a presentation slot
      </button>
    );
  }

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <form action={action} className="mt-4 rounded-lg border border-[var(--color-border)] px-4 py-4">
      <input type="hidden" name="bookingToken" value={bookingToken} />

      <p className="font-bold">Book a presentation slot</p>
      <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
        Pick the talks you would like to attend.
      </p>

      {/*
        A table rather than a stack of cards.

        Someone choosing between six talks is comparing times, and times only
        compare when they are in a column. The tick sits in its own first column
        so every box lines up down the page — in the card layout each one sat
        wherever its topic's line-wrapping put it.

        A `label` cannot wrap a `tr`, so each row's time and topic are labels
        pointing at the row's checkbox by id. The whole row stays tappable, which
        matters on a phone held one-handed at a stall.

        The presenter is gone by request: three columns fit a narrow screen
        without wrapping, a fourth did not, and the name was the one the visitor
        had least use for.
      */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th scope="col" className="w-9 px-2 py-1.5">
                <span className="sr-only">Choose</span>
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Time
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Topic
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Duration
              </th>
            </tr>
          </thead>
          {days.map((day) => (
            <tbody key={day.date}>
              {/* The date, once, above its talks — so the time column carries
                  only times and still reads as a full datetime. */}
              <tr>
                <th
                  scope="colgroup"
                  colSpan={4}
                  className="bg-[var(--color-surface-muted)] px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide"
                >
                  {DAY_KEY.format(new Date(`${day.date}T00:00:00Z`))}
                </th>
              </tr>
              {day.slots.map((slot) => (
                <tr key={slot.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-2 py-2.5 align-middle">
                    <input
                      id={`slot-${slot.id}`}
                      type="checkbox"
                      name="slotIds"
                      value={slot.id}
                      checked={selected.includes(slot.id)}
                      onChange={() => toggle(slot.id)}
                      className="block h-5 w-5 accent-teal-600"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 align-middle">
                    <label
                      htmlFor={`slot-${slot.id}`}
                      className="tnum block cursor-pointer font-semibold"
                    >
                      {CLOCK.format(new Date(slot.startsAt))}
                    </label>
                  </td>
                  <td className="px-2 py-2.5 align-middle">
                    <label htmlFor={`slot-${slot.id}`} className="block cursor-pointer">
                      {slot.topic}
                    </label>
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-2.5 align-middle text-right text-[var(--color-text-muted)]">
                    {slot.durationMinutes} min
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/*
        Asked for only when we do not already have one, and never required.
        This screen is the one moment a visitor who skipped it at registration
        will part with an address, and a booking that fails for want of one
        would be a worse outcome than not having it.
      */}
      {needsEmail ? (
        <label className="mt-4 flex flex-col gap-1">
          {/* The reason first, small, then the box. A field labelled "Email"
              asks for something; a line saying what it is for explains why
              anybody would give it. */}
          <span className="text-xs text-[var(--color-text-muted)]">
            To send the details to you — optional
          </span>
          <input
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Email"
            className="input h-12"
          />
        </label>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <BookButton count={selected.length} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
        >
          Not now
        </button>
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-sm text-danger-500">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
