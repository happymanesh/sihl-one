'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { LEAD_LOST_REASONS } from '@sihl-one/contracts';

import {
  assignLead,
  changeLeadStatus,
  convertLead,
  logActivity,
  type ActionState,
} from '@/app/actions/leads';
import { humanise } from '@/lib/format';
import { OwnerSuggestions } from './OwnerSuggestions';
import { SendMessagePanel } from '@/components/messaging/SendMessagePanel';

const INITIAL: ActionState = { status: 'idle' };

type Tab = 'log' | 'status' | 'assign' | 'message' | 'convert';

interface Props {
  leadId: string;
  status: string;
  allowedTransitions: string[];
  currentOwnerId: string | null;
  assignableUsers: Array<{ id: string; fullName: string; orgUnit: string | null }>;
  email: string | null;
  /** Active templates this lead could be sent. Empty hides the tab entirely. */
  templates: Array<{ code: string; name: string; channel: string; purpose: string; body: string }>;
  canUpdate: boolean;
  canAssign: boolean;
  canConvert: boolean;
}

/**
 * The four things an RM does on this screen, in one place.
 *
 * Tabs rather than four separate cards: the actions are mutually exclusive in
 * practice and stacking them all expanded pushes the timeline — the thing being
 * read most — below the fold.
 */
export function LeadActions(props: Props) {
  const isClosed = ['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(props.status);
  const canConvertNow = props.canConvert && props.allowedTransitions.includes('CONVERTED');

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'log', label: 'Log interaction', show: !isClosed },
    { id: 'status', label: 'Change status', show: props.canUpdate && props.allowedTransitions.length > 0 },
    { id: 'assign', label: 'Assign', show: props.canAssign && !isClosed },
    { id: 'message', label: 'Send message', show: props.templates.length > 0 && !isClosed },
    { id: 'convert', label: 'Convert', show: canConvertNow },
  ];

  const available = tabs.filter((tab) => tab.show);
  const [active, setActive] = useState<Tab>(available[0]?.id ?? 'log');

  if (available.length === 0) {
    return (
      <div className="card p-5 text-sm text-[var(--color-text-muted)]">
        This lead is {humanise(props.status).toLowerCase()} and read-only.
      </div>
    );
  }

  return (
    <section className="card overflow-hidden p-0">
      <div
        className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 pt-2"
        role="tablist"
      >
        {available.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`whitespace-nowrap rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              active === tab.id
                ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {active === 'log' ? <LogInteractionForm leadId={props.leadId} /> : null}
        {active === 'status' ? (
          <StatusForm leadId={props.leadId} allowed={props.allowedTransitions} />
        ) : null}
        {active === 'assign' ? (
          <AssignForm
            leadId={props.leadId}
            currentOwnerId={props.currentOwnerId}
            users={props.assignableUsers}
          />
        ) : null}
        {active === 'message' ? (
          <SendMessagePanel leadId={props.leadId} templates={props.templates} />
        ) : null}
        {active === 'convert' ? <ConvertForm leadId={props.leadId} email={props.email} /> : null}
      </div>
    </section>
  );
}

function Submit({ label, pendingLabel, variant = 'primary' }: { label: string; pendingLabel: string; variant?: 'primary' | 'accent' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <div
      role="alert"
      className={`rounded-lg px-3 py-2 text-sm ${
        isError
          ? 'border border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
          : 'border border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
      }`}
    >
      {state.message}
    </div>
  );
}

function LogInteractionForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState(logActivity, INITIAL);

  return (
    <form action={action} className="space-y-3" key={state.status === 'success' ? 'reset' : 'form'}>
      <input type="hidden" name="entityType" value="LEAD" />
      <input type="hidden" name="entityId" value={leadId} />
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" name="type" className="input" defaultValue="CALL">
            {['CALL', 'WHATSAPP', 'EMAIL', 'SMS', 'MEETING', 'NOTE'].map((type) => (
              <option key={type} value={type}>{humanise(type)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="direction">Direction</label>
          <select id="direction" name="direction" className="input" defaultValue="OUTBOUND">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="durationMinutes">Duration (min)</label>
          <input id="durationMinutes" name="durationMinutes" type="number" min={0} max={600} className="input" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="subject">Summary</label>
        <input
          id="subject"
          name="subject"
          className="input"
          required
          placeholder="Discussed brokerage plan and margin funding"
          aria-invalid={Boolean(state.errors?.subject)}
        />
      </div>

      <div>
        <label className="label" htmlFor="body">Notes</label>
        <textarea id="body" name="body" rows={3} className="input resize-none" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="outcome">Outcome</label>
          <input id="outcome" name="outcome" className="input" placeholder="Interested, call back Friday" />
        </div>
        <div>
          {/* Scheduling the next follow-up from the same form is what keeps the
              overdue count meaningful — a separate step gets skipped. */}
          <label className="label" htmlFor="nextFollowUpAt">Next follow-up</label>
          <input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" className="input" />
        </div>
      </div>

      <Submit label="Log interaction" pendingLabel="Saving…" variant="accent" />
    </form>
  );
}

function StatusForm({ leadId, allowed }: { leadId: string; allowed: string[] }) {
  const [state, action] = useActionState(changeLeadStatus, INITIAL);
  const [status, setStatus] = useState(allowed.find((value) => value !== 'CONVERTED') ?? '');

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <Feedback state={state} />

      <div>
        <label className="label" htmlFor="status">Move to</label>
        <select
          id="status"
          name="status"
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {/* Only transitions the API will accept are offered. The same table
              drives both, so the UI can never present an impossible move. */}
          {allowed
            .filter((value) => value !== 'CONVERTED')
            .map((value) => (
              <option key={value} value={value}>{humanise(value)}</option>
            ))}
        </select>
        {allowed.includes('CONVERTED') ? (
          <p className="mt-1.5 text-xs text-[var(--color-text-subtle)]">
            To convert this lead, use the Convert tab — it needs a PAN and email.
          </p>
        ) : null}
      </div>

      {status === 'LOST' ? (
        <div>
          <label className="label" htmlFor="lostReason">
            Reason <span className="text-danger-500">*</span>
          </label>
          <select id="lostReason" name="lostReason" className="input" required>
            {LEAD_LOST_REASONS.map((reason) => (
              <option key={reason} value={reason}>{humanise(reason)}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-[var(--color-text-subtle)]">
            Required — lost reasons are what make the drop-off report useful.
          </p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="note">Note</label>
        <textarea id="note" name="note" rows={2} className="input resize-none" />
      </div>

      <Submit label="Update status" pendingLabel="Updating…" />
    </form>
  );
}

function AssignForm({
  leadId,
  currentOwnerId,
  users,
}: {
  leadId: string;
  currentOwnerId: string | null;
  users: Array<{ id: string; fullName: string; orgUnit: string | null }>;
}) {
  const [state, action] = useActionState(assignLead, INITIAL);
  const [ownerId, setOwnerId] = useState(currentOwnerId ?? '');

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <Feedback state={state} />

      <OwnerSuggestions leadId={leadId} onPick={setOwnerId} />

      <div>
        <label className="label" htmlFor="ownerId">Assign to</label>
        <select
          id="ownerId"
          name="ownerId"
          className="input"
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          required
        >
          <option value="" disabled>Choose a relationship manager</option>
          {users.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
              {person.orgUnit ? ` — ${person.orgUnit}` : ''}
            </option>
          ))}
        </select>
        {users.length === 0 ? (
          <p className="mt-1.5 text-xs text-warn-600">
            No assignable users are visible in your data scope.
          </p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="assign-note">Handover note</label>
        <textarea id="assign-note" name="note" rows={2} className="input resize-none" />
      </div>

      <Submit label="Assign lead" pendingLabel="Assigning…" />
    </form>
  );
}

function ConvertForm({ leadId, email }: { leadId: string; email: string | null }) {
  const [state, action] = useActionState(convertLead, INITIAL);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <Feedback state={state} />

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
        Converting creates the customer record and starts onboarding. SIHL ONE does not open the
        trading account itself — the back office does, and reports the client code back here.
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pan">
            PAN <span className="text-danger-500">*</span>
          </label>
          <input
            id="pan"
            name="pan"
            className="input font-mono uppercase"
            required
            maxLength={10}
            placeholder="ABCDE1234F"
            aria-invalid={Boolean(state.errors?.pan)}
          />
          {state.errors?.pan ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.pan[0]}</p>
          ) : null}
        </div>
        <div>
          <label className="label" htmlFor="convert-email">
            Email <span className="text-danger-500">*</span>
          </label>
          <input
            id="convert-email"
            name="email"
            type="email"
            className="input"
            required
            defaultValue={email ?? ''}
            aria-invalid={Boolean(state.errors?.email)}
          />
          {state.errors?.email ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.email[0]}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="convert-note">Note</label>
        <textarea id="convert-note" name="note" rows={2} className="input resize-none" />
      </div>

      <Submit label="Convert to customer" pendingLabel="Converting…" variant="accent" />
    </form>
  );
}
