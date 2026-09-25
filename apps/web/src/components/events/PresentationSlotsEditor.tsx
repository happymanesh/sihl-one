'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { PresentationDay, PresentationSlotSummary } from '@sihl-one/contracts';

import {
  addPresentationSlot,
  setPresentationBooking,
  setPresentationSlotActive,
  updatePresentationSlot,
} from '@/app/actions/presentations';
import type { ActionState } from '@/app/actions/leads';
import { formatTime } from '@/lib/format';

const IDLE: ActionState = { status: 'idle' };

/** "Fri 26 Sep" from the YYYY-MM-DD the API groups on. */
function formatDayHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

/** YYYY-MM-DD in the business timezone, which is what a date input wants. */
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
});

function Submit({
  children,
  variant = 'primary',
}: {
  children: string;
  variant?: 'primary' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant} h-9`} disabled={pending}>
      {pending ? 'Saving…' : children}
    </button>
  );
}

/** The date and time fields, shared by the add form and every edit form. */
function SlotFields({
  slot,
  dateMin,
  dateMax,
}: {
  slot?: PresentationSlotSummary;
  dateMin: string;
  dateMax: string;
}) {
  /*
    An existing slot's instant, split back into the two fields the form shows.

    Both halves are read in the business timezone — the date as well as the
    time. Taking the date from the raw instant and the time from the local
    clock puts them in different zones, and a talk near midnight then shows one
    day with the other day's time. Saving that form without touching anything
    would move the talk.
  */
  const startsAt = slot ? new Date(slot.startsAt) : null;
  const date = startsAt ? IST_DATE.format(startsAt) : '';
  const time = startsAt ? formatTime(startsAt) : '';

  return (
    <>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Date
        <input
          type="date"
          name="date"
          defaultValue={date}
          min={dateMin}
          max={dateMax}
          required
          className="input h-9"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Time
        <input type="time" name="time" defaultValue={time} required className="input h-9" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold sm:col-span-2">
        Topic
        <input
          type="text"
          name="topic"
          defaultValue={slot?.topic ?? ''}
          maxLength={160}
          required
          placeholder="What the talk is about"
          className="input h-9"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Presenter <span className="font-normal text-[var(--color-text-subtle)]">(optional)</span>
        <input
          type="text"
          name="presenterName"
          defaultValue={slot?.presenterName ?? ''}
          maxLength={120}
          className="input h-9"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Duration (minutes)
        <input
          type="number"
          name="durationMinutes"
          defaultValue={slot?.durationMinutes ?? 30}
          min={1}
          max={600}
          required
          className="input h-9"
        />
      </label>
    </>
  );
}

function AddSlot({
  eventId,
  dateMin,
  dateMax,
}: {
  eventId: string;
  dateMin: string;
  dateMax: string;
}) {
  const [state, action] = useActionState(addPresentationSlot, IDLE);
  const [open, setOpen] = useState(false);

  // Close the form once a talk lands, so the next one starts blank rather than
  // holding the last one's details. Adjusted on the result rather than in an
  // effect, which is this codebase's pattern for state derived from a change.
  const [seen, setSeen] = useState<ActionState>(IDLE);
  if (state !== seen) {
    setSeen(state);
    if (state.status === 'success') setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-outline h-9">
          Add a talk
        </button>
        {state.status === 'success' && state.message ? (
          <span className="text-sm font-semibold text-brand-green-700 dark:text-brand-green-400">
            {state.message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-[var(--color-border)] p-3">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SlotFields dateMin={dateMin} dateMax={dateMax} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Submit>Add talk</Submit>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost h-9 text-xs">
          Cancel
        </button>
        {state.status === 'error' && state.message ? (
          <span className="text-sm font-semibold text-danger-600 dark:text-danger-500">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function DayGroup({
  day,
  eventId,
  dateMin,
  dateMax,
  canManage,
}: {
  day: PresentationDay;
  eventId: string;
  dateMin: string;
  dateMax: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(true);

  const live = day.slots.filter((slot) => slot.isActive).length;
  const seats = day.slots.reduce((sum, slot) => sum + slot.registered, 0);

  return (
    <div className="rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          aria-hidden
          className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          ›
        </span>
        <span className="font-semibold">{formatDayHeading(day.date)}</span>
        {/* A folded day still has to answer "is anything on, and is anybody
            coming" — otherwise collapsing hides the only thing worth scanning. */}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {live} {live === 1 ? 'talk' : 'talks'} · {seats} registered
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] p-3">
          {day.slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              eventId={eventId}
              dateMin={dateMin}
              dateMax={dateMax}
              canManage={canManage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlotRow({
  slot,
  eventId,
  dateMin,
  dateMax,
  canManage,
}: {
  slot: PresentationSlotSummary;
  eventId: string;
  dateMin: string;
  dateMax: string;
  /** Whether this reader may change the schedule, or only read it. */
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction] = useActionState(updatePresentationSlot, IDLE);
  const [toggleState, toggleAction] = useActionState(setPresentationSlotActive, IDLE);

  const [seen, setSeen] = useState<ActionState>(IDLE);
  if (editState !== seen) {
    setSeen(editState);
    if (editState.status === 'success') setEditing(false);
  }

  if (editing) {
    return (
      <form action={editAction} className="rounded-lg border border-[var(--color-border)] p-3">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="slotId" value={slot.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SlotFields slot={slot} dateMin={dateMin} dateMax={dateMax} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Submit>Save</Submit>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn btn-ghost h-9 text-xs"
          >
            Cancel
          </button>
          {editState.status === 'error' && editState.message ? (
            <span className="text-sm font-semibold text-danger-600 dark:text-danger-500">
              {editState.message}
            </span>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--color-border)] px-3 py-2.5 ${
        slot.isActive ? '' : 'opacity-60'
      }`}
    >
      <span className="tnum font-semibold">{formatTime(slot.startsAt)}</span>
      <span className="min-w-0 flex-1">
        <span className={`font-semibold ${slot.isActive ? '' : 'line-through'}`}>{slot.topic}</span>
        <span className="ml-2 text-xs text-[var(--color-text-muted)]">
          {slot.durationMinutes} min
          {slot.presenterName ? ` · ${slot.presenterName}` : ''}
        </span>
      </span>

      {/*
        The count is the way in to the list behind it. A number nobody can open
        answers "how many" and never "who", which is the question somebody
        running the talk actually has.
      */}
      {slot.registered > 0 ? (
        <Link
          href={`/events/${eventId}/slots/${slot.id}` as Route}
          className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
        >
          {slot.registered} registered
        </Link>
      ) : (
        <span className="text-xs text-[var(--color-text-subtle)]">Nobody yet</span>
      )}

      {canManage ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn btn-ghost h-8 text-xs"
        >
          Edit
        </button>
      ) : null}

      {/*
        Cancelling keeps the seats. Said out loud on the button's own message
        rather than left for somebody to discover, because the fear that stops
        people cancelling a talk is losing the list of who was coming.
      */}
      {canManage ? (
        <form action={toggleAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="slotId" value={slot.id} />
          <input type="hidden" name="isActive" value={slot.isActive ? 'false' : 'true'} />
          <Submit variant="outline">{slot.isActive ? 'Cancel talk' : 'Reinstate'}</Submit>
        </form>
      ) : null}

      {toggleState.status === 'error' && toggleState.message ? (
        <span className="w-full text-sm font-semibold text-danger-600 dark:text-danger-500">
          {toggleState.message}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The schedule, as the desk manages it.
 *
 * Shows every talk including cancelled and finished ones — this is the planning
 * view, not the visitor's. What a visitor may still book is a narrower list the
 * API decides separately.
 */
export function PresentationSlotsEditor({
  eventId,
  enabled,
  days,
  eventStartsAt,
  eventEndsAt,
  canManage,
}: {
  eventId: string;
  enabled: boolean;
  days: PresentationDay[];
  eventStartsAt: string;
  eventEndsAt: string | null;
  /** Everyone who can see the event reads the schedule; fewer may change it. */
  canManage: boolean;
}) {
  const [bookingState, bookingAction] = useActionState(setPresentationBooking, IDLE);

  // A talk has to happen while the event is on, so the date picker will not
  // offer anything outside it. The API enforces the same rule — this only
  // saves somebody discovering it after typing.
  const dateMin = eventStartsAt.slice(0, 10);
  const dateMax = (eventEndsAt ?? eventStartsAt).slice(0, 10);

  const totalSlots = days.reduce((sum, day) => sum + day.slots.length, 0);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Presentation slots</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            Talks visitors can book a seat at when they register.
          </p>
        </div>

        {canManage ? (
          <form action={bookingAction} className="flex items-center gap-2">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
            <span
              className={`text-xs font-bold uppercase tracking-wide ${
                enabled
                  ? 'text-brand-green-700 dark:text-brand-green-400'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              {enabled ? 'Booking open' : 'Booking closed'}
            </span>
            <Submit variant="outline">{enabled ? 'Close booking' : 'Open booking'}</Submit>
          </form>
        ) : (
          <span
            className={`text-xs font-bold uppercase tracking-wide ${
              enabled
                ? 'text-brand-green-700 dark:text-brand-green-400'
                : 'text-[var(--color-text-muted)]'
            }`}
          >
            {enabled ? 'Booking open' : 'Booking closed'}
          </span>
        )}
      </div>

      {bookingState.message ? (
        <p
          className={`mt-2 text-sm font-semibold ${
            bookingState.status === 'error'
              ? 'text-danger-600 dark:text-danger-500'
              : 'text-brand-green-700 dark:text-brand-green-400'
          }`}
        >
          {bookingState.message}
        </p>
      ) : null}

      {enabled && totalSlots === 0 && canManage ? (
        <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/15">
          {/* Booking is on and there is nothing to book. Worth saying, because
              the visitor sees an empty list and assumes the system is broken. */}
          Booking is open but no talks have been added, so visitors are offered nothing.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-5">
        {days.map((day) => (
          <DayGroup
            key={day.date}
            day={day}
            eventId={eventId}
            dateMin={dateMin}
            dateMax={dateMax}
            canManage={canManage}
          />
        ))}

        {totalSlots === 0 && !canManage ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No talks have been scheduled for this event.
          </p>
        ) : null}

        {canManage ? <AddSlot eventId={eventId} dateMin={dateMin} dateMax={dateMax} /> : null}
      </div>
    </section>
  );
}
