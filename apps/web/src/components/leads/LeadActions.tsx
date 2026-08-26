'use client';

import { useActionState, useState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { ProductPicker } from '@/components/leads/ProductPicker';
import {
  guessIdentifierKind,
  type LeadProductView,
  type MeetingModeItem,
  type ProductItem,
} from '@sihl-one/contracts';

import {
  assignLead,
  transferLead,
  convertLead,
  logActivity,
  type ActionState,
} from '@/app/actions/leads';
import { VoiceInputButton } from '@/components/leads/VoiceInputButton';
import { humanise } from '@/lib/format';
import { OwnerSuggestions } from './OwnerSuggestions';
import { SendMessagePanel } from '@/components/messaging/SendMessagePanel';

const INITIAL: ActionState = { status: 'idle' };

type Tab = 'log' | 'assign' | 'transfer' | 'message' | 'convert';

interface Props {
  leadId: string;
  status: string;
  allowedTransitions: string[];
  currentOwnerId: string | null;
  assignableUsers: Array<{ id: string; fullName: string; orgUnit: string | null }>;
  /** Everyone the caller may transfer to — wider than assignableUsers, and empty for a rep who may not transfer. */
  transferTargets: Array<{ id: string; fullName: string; orgUnit: string | null }>;
  email: string | null;
  /** Active templates this lead could be sent. Empty hides the tab entirely. */
  templates: Array<{ code: string; name: string; channel: string; purpose: string; body: string }>;
  canUpdate: boolean;
  /** Server-driven, so switching dictation on is a config change not a release. */
  voiceInputEnabled: boolean;
  meetingModes: MeetingModeItem[];
  products: ProductItem[];
  canAssign: boolean;
  canTransfer: boolean;
  /** The lead's products with their outcomes — conversion is per product now. */
  leadProducts: LeadProductView[];
  canConvert: boolean;
}

/**
 * The four things an RM does on this screen, in one place.
 *
 * Tabs rather than four separate cards: the actions are mutually exclusive in
 * practice and stacking them all expanded pushes the timeline — the thing being
 * read most — below the fold.
 */
/**
 * Which products were discussed, and what the rep expects the client to invest.
 *
 * The amount only appears once a product is ticked, so the form stays short for
 * the majority of interactions that are not a pitch. Leaving an amount blank is
 * allowed and means exactly that — no figure — rather than zero, because
 * "I expect nothing" and "I did not estimate" are different claims and only one
 * of them belongs in a forecast.
 */
function ProductValueFields({ products }: { products: ProductItem[] }) {
  const [picked, setPicked] = useState<string[]>([]);

  if (products.length === 0) return null;

  const toggle = (code: string) =>
    setPicked((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );


  return (
    <div>
      <span className="label">Products discussed</span>

      {/* Chips flow and wrap as they always did; what changed is that a parent
          and its sub-products form one unit, so a line break can never separate
          "Equity" from "Equity intraday". A first attempt gave every product its
          own row, which turned twelve chips into twelve lines — the grouping was
          right and the layout was wrong.

          Dashed outline marks a sub-product as the narrower choice. Either can
          be picked, and picking both is legitimate: a conversation can cover the
          product in general and one variant in particular. */}
      <ProductPicker products={products} selected={picked} onToggle={toggle} />

      {picked.length > 0 ? (
        <div className="mt-2.5 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <p className="text-xs font-semibold">Expected investment</p>

          {picked.map((code) => {
            const product = products.find((item) => item.code === code);
            return (
              <div key={code} className="flex items-center gap-2">
                <label className="flex-1 text-xs" htmlFor={`productValue.${code}`}>
                  {product?.parentName ? `${product.parentName} › ${product.name}` : (product?.name ?? code)}
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[var(--color-text-subtle)]">₹</span>
                  <input
                    id={`productValue.${code}`}
                    name={`productValue.${code}`}
                    inputMode="decimal"
                    placeholder="Optional"
                    className="input h-8 w-32 text-right text-xs tnum"
                  />
                </div>
              </div>
            );
          })}

          <p className="text-xs text-[var(--color-text-subtle)]">
            Your estimate of what they will invest. Actual figures come from the back office.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function LeadActions(props: Props) {
  const isClosed = ['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(props.status);
  const canConvertNow = props.canConvert && props.allowedTransitions.includes('CONVERTED');

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'log', label: 'Log interaction', show: !isClosed },
    { id: 'assign', label: 'Assign', show: props.canAssign && !isClosed },
    { id: 'transfer', label: 'Transfer', show: props.canTransfer && !isClosed },
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
        {active === 'log' ? (
          <LogInteractionForm
            leadId={props.leadId}
            allowedTransitions={props.allowedTransitions}
            canUpdate={props.canUpdate}
            voiceInputEnabled={props.voiceInputEnabled}
            leadProducts={props.leadProducts}
            meetingModes={props.meetingModes}
            products={props.products}
          />
        ) : null}
        {active === 'transfer' ? (
          <TransferForm
            leadId={props.leadId}
            currentOwnerId={props.currentOwnerId}
            users={props.transferTargets}
          />
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

/**
 * Logging an interaction, with the status change folded in.
 *
 * The submit button is never disabled. A disabled button gives no reason, is
 * not focusable, and on a form this long usually sits nowhere near the field
 * that is missing — the rep clicks, nothing happens, and they hunt. Validation
 * runs on submit instead, marks the offending field and moves focus to it.
 */
function LogInteractionForm({
  leadId,
  allowedTransitions,
  canUpdate,
  voiceInputEnabled,
  leadProducts,
  meetingModes,
  products,
}: {
  leadId: string;
  allowedTransitions: string[];
  canUpdate: boolean;
  voiceInputEnabled: boolean;
  leadProducts: LeadProductView[];
  meetingModes: MeetingModeItem[];
  products: ProductItem[];
}) {
  const [state, action] = useActionState(logActivity, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [nextStatus, setNextStatus] = useState('');
  const [mode, setMode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [kindOverride, setKindOverride] = useState<'PAN' | 'CLIENT_CODE' | null>(null);

  // The guess follows what is typed until the rep overrides it, and the
  // override then sticks — retyping a character should not undo their choice.
  const identifierKind = kindOverride ?? guessIdentifierKind(identifier);

  const selectedMode = meetingModes.find((item) => item.code === mode);

  const openProducts = leadProducts.filter((row) => row.isOpen);

  // CONVERTED used to be stripped out here, on the grounds that conversion
  // needs a PAN and its own confirmation. That sent a rep who had just closed
  // a deal off to a different tab to re-enter what they were already typing,
  // so it is offered inline — asking for the product, the reference and the
  // amount rather than for a PAN specifically.
  //
  // Still hidden when the lead has no open product, because there would be
  // nothing to convert.
  const transitions = allowedTransitions.filter(
    (value) => value !== 'CONVERTED' || openProducts.length > 0,
  );

  const validate = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const required = ['subject'];
    const empty = required.filter((name) => {
      const field = form.elements.namedItem(name) as HTMLInputElement | null;
      return !field?.value.trim();
    });

    setMissing(empty);
    if (empty.length > 0) {
      event.preventDefault();
      const first = form.elements.namedItem(empty[0]!) as HTMLInputElement | null;
      first?.focus();
    }
  };

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={validate}
      noValidate
      className="space-y-3"
      key={state.status === 'success' ? 'reset' : 'form'}
    >
      <input type="hidden" name="entityType" value="LEAD" />
      <input type="hidden" name="entityId" value={leadId} />
      <Feedback state={state} />

      {meetingModes.length > 0 ? (
        <div>
          <label className="label" htmlFor="meetingMode">How did it happen?</label>
          <select
            id="meetingMode"
            name="meetingMode"
            className="input"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            aria-describedby="mode-meaning"
          >
            <option value="">Not recorded</option>
            {meetingModes.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
          {/* The meaning, from the master. A mode name alone means different
              things in different teams; writing it down settles it. */}
          <p id="mode-meaning" className="mt-1 text-xs text-[var(--color-text-muted)]">
            {selectedMode?.meaning ?? 'Optional — records whether this was a visit, a call or a message.'}
          </p>
        </div>
      ) : null}

      {selectedMode?.requiresLink ? (
        <div>
          <label className="label" htmlFor="meetingLink">Meeting link</label>
          <input
            id="meetingLink"
            name="meetingLink"
            type="url"
            className="input"
            placeholder="https://meet.google.com/…"
            aria-invalid={Boolean(state.errors?.meetingLink)}
            aria-describedby="meeting-link-help"
          />
          <p id="meeting-link-help" className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Approved providers only. Sending the link to the client is not switched on yet.
          </p>
          {state.errors?.meetingLink ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.meetingLink[0]}</p>
          ) : null}
        </div>
      ) : null}

      {selectedMode?.requiresPhoto ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/10">
          This mode expects a photograph taken in the app at the client&rsquo;s premises. Capture is
          part of the visits screen and is not built yet.
        </p>
      ) : null}

      {selectedMode?.allowsScreenshot ? (
        <p className="text-xs text-[var(--color-text-subtle)]">
          You can attach a screenshot as evidence after saving. Capture the full window, not a crop —
          your manager sees what you attach.
        </p>
      ) : null}

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
          placeholder="Enter discussion topic or agenda"
          aria-invalid={missing.includes('subject') || Boolean(state.errors?.subject)}
          aria-describedby={missing.includes('subject') ? 'subject-error' : undefined}
        />
        {missing.includes('subject') ? (
          <p id="subject-error" role="alert" className="mt-1 text-xs font-medium text-danger-500">
            A one-line summary is needed — it is what the next person reads.
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="label" htmlFor="body">Remarks</label>
          <VoiceInputButton enabled={voiceInputEnabled} targetId="body" />
        </div>
        <textarea
          id="body"
          name="body"
          rows={3}
          className="input resize-none"
          placeholder="Anything the next person needs to know."
        />
      </div>

      <ProductValueFields products={products} />

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

      {canUpdate && transitions.length > 0 ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <label className="label" htmlFor="nextStatus">Move the lead to</label>
          <select
            id="nextStatus"
            name="nextStatus"
            className="input"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
          >
            <option value="">Leave the status unchanged</option>
            {transitions.map((value) => (
              <option key={value} value={value}>{humanise(value)}</option>
            ))}
          </select>

          {nextStatus === 'LOST' ? (
            <div className="mt-2">
              <label className="label" htmlFor="lostReason">Why was it lost?</label>
              <input id="lostReason" name="lostReason" className="input" />
            </div>
          ) : null}

          {nextStatus === 'CONVERTED' ? (
            <div className="mt-3 space-y-2 rounded-lg border border-teal-500/40 bg-teal-50/60 p-3 dark:bg-teal-500/10">
              <p className="text-xs text-[var(--color-text-muted)]">
                Each product closes on its own. Only the one you pick is converted — anything
                else stays open.
              </p>

              <div>
                <label className="label" htmlFor="convertProductCode">Which product?</label>
                <select
                  id="convertProductCode"
                  name="convertProductCode"
                  className="input"
                  defaultValue={openProducts[0]?.productCode ?? ''}
                  required
                >
                  {openProducts.map((row) => (
                    <option key={row.productCode} value={row.productCode}>
                      {row.productName ?? row.productCode}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="identifier">PAN or client code</label>
                  <input
                    id="identifier"
                    name="identifier"
                    className="input"
                    required
                    autoCapitalize="characters"
                    placeholder="ABCDE1234F or R0018"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                  {/* Guessed from what was typed, and overridable. A client code
                      that happens to be PAN-shaped is still a client code if the
                      rep says so. */}
                  <input type="hidden" name="identifierKind" value={identifierKind} />
                  <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                    Recorded as {identifierKind === 'PAN' ? 'a PAN' : 'a client code'}.{' '}
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2"
                      onClick={() => setKindOverride(identifierKind === 'PAN' ? 'CLIENT_CODE' : 'PAN')}
                    >
                      Use {identifierKind === 'PAN' ? 'client code' : 'PAN'} instead
                    </button>
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="finalAmount">Final amount</label>
                  <input
                    id="finalAmount"
                    name="finalAmount"
                    className="input"
                    inputMode="decimal"
                    placeholder="250000"
                  />
                  <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                    What the client actually put in. Optional, and recorded as your figure —
                    the back office owns the ledger.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Submit label="Save interaction" pendingLabel="Saving…" variant="accent" />
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

/**
 * Moving a lead out of this team altogether.
 *
 * Deliberately a separate tab from Assign rather than a checkbox inside it.
 * The two actions have different consequences — one shuffles work inside a
 * team, the other takes a lead off somebody's numbers — and a checkbox is the
 * kind of thing people tick without reading.
 */
function TransferForm({
  leadId,
  currentOwnerId,
  users,
}: {
  leadId: string;
  currentOwnerId: string | null;
  users: Array<{ id: string; fullName: string; orgUnit: string | null }>;
}) {
  const [state, action] = useActionState(transferLead, INITIAL);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <Feedback state={state} />

      <p className="text-xs text-[var(--color-text-muted)]">
        Use this to hand a lead to another branch or another manager&rsquo;s team. The reason is
        recorded on the lead and in the audit trail.
      </p>

      <div>
        <label className="label" htmlFor="transfer-owner">Transfer to</label>
        <select id="transfer-owner" name="ownerId" className="input" defaultValue="" required>
          <option value="" disabled>Choose who takes it on</option>
          {users
            .filter((person) => person.id !== currentOwnerId)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
                {person.orgUnit ? ` — ${person.orgUnit}` : ''}
              </option>
            ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="transfer-reason">
          Why is it moving? <span className="text-danger-500">*</span>
        </label>
        <textarea
          id="transfer-reason"
          name="reason"
          rows={2}
          required
          minLength={10}
          className="input resize-none"
          placeholder="Client has moved to Surat and is now handled by that branch"
          aria-invalid={Boolean(state.errors?.reason)}
        />
        {state.errors?.reason ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.reason[0]}</p>
        ) : null}
      </div>

      <Submit label="Transfer lead" pendingLabel="Transferring…" />
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
