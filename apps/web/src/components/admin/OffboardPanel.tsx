'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { markNoticePeriod, offboardUser, type OffboardState } from '@/app/actions/offboarding';

const INITIAL: OffboardState = { status: 'idle' };

interface Holdings {
  openLeads: number;
  closedLeads: number;
  customers: number;
  openTasks: number;
  plannedVisits: number;
  activeSessions: number;
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function OffboardPanel({
  userId,
  fullName,
  holdings,
  recipients,
  inNotice,
}: {
  userId: string;
  fullName: string;
  holdings: Holdings;
  recipients: Array<{ id: string; fullName: string }>;
  inNotice: boolean;
}) {
  const [noticeState, noticeAction] = useActionState(markNoticePeriod, INITIAL);
  const [state, action] = useActionState(offboardUser, INITIAL);
  const [confirmed, setConfirmed] = useState(false);

  if (state.status === 'success' && state.result) {
    return (
      <section className="card p-5">
        <h2 className="font-bold">Handover complete</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{state.message}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ['Sessions revoked', state.result.sessionsRevoked],
            ['Leads moved', state.result.leadsMoved],
            ['Customers moved', state.result.customersMoved],
            ['Tasks moved', state.result.tasksMoved],
            ['Visits cancelled', state.result.visitsCancelled],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-[var(--color-text-muted)]">{label as string}</dt>
              <dd className="mt-0.5 text-lg font-bold tnum">{value as number}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
          {holdings.closedLeads} closed lead{holdings.closedLeads === 1 ? '' : 's'} stayed with{' '}
          {fullName} — moving them would rewrite the attribution and performance history.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {!inNotice ? (
        <form action={noticeAction} className="card p-5">
          <input type="hidden" name="userId" value={userId} />
          <h2 className="font-bold">Serving notice?</h2>
          {/*
            Detective rather than preventive, and deliberately so: they are still
            employed and exports are a legitimate part of the job. Blocking them
            stops them working; flagging them makes an unusual pull visible.
          */}
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Flagging this changes no permission — {fullName} keeps working normally. It raises
            the audit level on bulk exports, so an unusual data pull is visible while they are
            still here.
          </p>
          {noticeState.message ? (
            <p
              className={`mt-3 text-sm ${
                noticeState.status === 'error' ? 'text-danger-500' : 'text-teal-600'
              }`}
            >
              {noticeState.message}
            </p>
          ) : null}
          <div className="mt-4">
            <Submit label="Flag notice period" pendingLabel="Flagging…" />
          </div>
        </form>
      ) : (
        <div className="card border-l-[4px] border-l-warn-500 p-4 text-sm">
          <span className="font-semibold">In notice period.</span> Bulk exports by {fullName} are
          being audited at an elevated level.
        </div>
      )}

      <form action={action} className="card space-y-4 p-5">
        <input type="hidden" name="userId" value={userId} />

        <div>
          <h2 className="font-bold">Offboard and hand over</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Access is revoked first, then live work moves. Closed leads and completed visits
            stay with {fullName} so history and attribution remain intact.
          </p>
        </div>

        {state.status === 'error' && state.message ? (
          <p
            role="alert"
            className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
          >
            {state.message}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm sm:grid-cols-4">
          {[
            ['Open leads', holdings.openLeads, true],
            ['Customers', holdings.customers, true],
            ['Open tasks', holdings.openTasks, true],
            ['Closed leads', holdings.closedLeads, false],
          ].map(([label, value, moves]) => (
            <div key={label as string}>
              <dt className="text-xs text-[var(--color-text-muted)]">{label as string}</dt>
              <dd className="mt-0.5 font-bold tnum">
                {value as number}
                <span className="ml-1 text-xs font-normal text-[var(--color-text-subtle)]">
                  {(moves as boolean) ? 'moves' : 'stays'}
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <input type="hidden" name="strategy" value="SINGLE_OWNER" />

        <div>
          <label className="label" htmlFor="targetUserId">
            Hand everything to <span className="text-danger-500">*</span>
          </label>
          <select id="targetUserId" name="targetUserId" className="input" required defaultValue="">
            <option value="" disabled>
              Choose a colleague
            </option>
            {recipients.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="reason">
            Reason <span className="text-danger-500">*</span>
          </label>
          <input
            id="reason"
            name="reason"
            className="input"
            required
            placeholder="Resigned, last working day 31 August"
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeCustomers" defaultChecked className="h-4 w-4" />
            Move customers too
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeTasks" defaultChecked className="h-4 w-4" />
            Move open tasks too
          </label>
        </div>

        {/* A deliberate second gate: this revokes a colleague's access and moves
            their book, and it is not reversible with one click. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs dark:bg-danger-500/10">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            I understand this immediately signs {fullName} out of every device, disables their
            account, and reassigns {holdings.openLeads} open lead
            {holdings.openLeads === 1 ? '' : 's'}.
          </span>
        </label>

        <button type="submit" className="btn btn-primary" disabled={!confirmed}>
          Offboard {fullName}
        </button>
      </form>
    </div>
  );
}
