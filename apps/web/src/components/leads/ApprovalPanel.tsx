'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { canRemindApproval, type LeadProductApprovalView } from '@sihl-one/contracts';

import { decideApproval, remindApproval, type ActionState } from '@/app/actions/leads';
import { formatDateTime } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

/**
 * Where a commitment stands, under the product it was made for.
 *
 * Shown to everyone who can see the lead, because "waiting on sign-off" is
 * what the next person to pick this up needs to know before they promise
 * anything further. What each person can *do* differs: the approver decides,
 * the person working the product can chase, everybody else reads.
 *
 * Deliberately not a blocker. The product can be converted while this is
 * pending or after it was refused — the record says what was approved, it does
 * not gate the sale.
 */
export function ApprovalPanel({
  leadId,
  productCode,
  approval,
  canDecide,
  canRemind,
}: {
  leadId: string;
  productCode: string;
  approval: LeadProductApprovalView;
  /** The routed approver, or a super administrator. */
  canDecide: boolean;
  /** The person working this product. */
  canRemind: boolean;
}) {
  const router = useRouter();
  const [decideState, decideAction] = useActionState(decideApproval, INITIAL);
  const [remindState, remindAction] = useActionState(remindApproval, INITIAL);
  const [refusing, setRefusing] = useState(false);

  useEffect(() => {
    if (decideState.status === 'success' || remindState.status === 'success') router.refresh();
  }, [decideState, remindState, router]);

  /*
    Evaluated on the client, so the button reflects the clock the person is
    looking at. The API enforces the same rule with its own clock — this is the
    courtesy, not the control.
  */
  const [mayRemind, setMayRemind] = useState(false);
  useEffect(() => {
    setMayRemind(canRemindApproval(approval, new Date()));
  }, [approval]);

  const pending = approval.status === 'PENDING';
  const approved = approval.status === 'APPROVED';
  const message = decideState.message ?? remindState.message;
  const failed = decideState.status === 'error' || remindState.status === 'error';

  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
        pending
          ? 'border-warn-500/40 bg-warn-50 dark:bg-warn-500/15'
          : approved
            ? 'border-teal-500/40 bg-teal-50 dark:bg-teal-900/25'
            : 'border-danger-500/40 bg-danger-50 dark:bg-danger-500/15'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {pending
            ? `Pending approval — with ${approval.approver.fullName}`
            : approved
              ? 'Commitments approved'
              : 'Commitments not approved'}
        </span>

        {pending && canRemind ? (
          <form action={remindAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="productCode" value={productCode} />
            {/* One a day. Disabled rather than hidden, with the reason on the
                title, so the rule is visible instead of the button seeming to
                have vanished. */}
            <RemindButton
              disabled={!mayRemind}
              title={
                mayRemind
                  ? 'Send a reminder'
                  : 'A reminder has already gone today. You can send another tomorrow.'
              }
            />
          </form>
        ) : null}
      </div>

      <p className="mt-1 text-[var(--color-text-muted)]">
        Asked by {approval.requestedBy.fullName} · {formatDateTime(approval.requestedAt)}
        {approval.lastReminderAt ? (
          <span> · last reminded {formatDateTime(approval.lastReminderAt)}</span>
        ) : null}
      </p>

      {approval.requestNote ? (
        <p className="mt-1 whitespace-pre-wrap">
          <span className="text-[var(--color-text-subtle)]">Committed: </span>
          {approval.requestNote}
        </p>
      ) : null}

      {/* The decision, with its timestamp and reason — which is the whole
          point of recording it rather than just flipping a flag. */}
      {!pending ? (
        <p className="mt-1">
          <span className="text-[var(--color-text-subtle)]">
            {approved ? 'Approved' : 'Refused'} by {approval.approver.fullName} ·{' '}
            {approval.decidedAt ? formatDateTime(approval.decidedAt) : '—'}
          </span>
          {approval.decisionReason ? (
            <span className="block whitespace-pre-wrap">{approval.decisionReason}</span>
          ) : null}
        </p>
      ) : null}

      {/* Said plainly where it is read, not only in the mail that may not have
          gone. The request itself stands either way. */}
      {approval.emailNote ? (
        <p className="mt-1 text-[var(--color-text-subtle)]">
          The notification was raised, but the email did not go: {approval.emailNote}
        </p>
      ) : null}

      {message ? (
        <p
          role={failed ? 'alert' : 'status'}
          className={`mt-2 ${failed ? 'font-semibold text-danger-600' : 'text-teal-700 dark:text-teal-300'}`}
        >
          {message}
        </p>
      ) : null}

      {pending && canDecide ? (
        <form action={decideAction} className="mt-2 border-t border-[var(--color-border)] pt-2">
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="productCode" value={productCode} />

          {/* A reason is asked for only when refusing, because that is the
              answer that cannot be acted on without one. */}
          {refusing ? (
            <input
              name="reason"
              className="input h-9 text-xs"
              placeholder="Why are you not approving it?"
              maxLength={1000}
              required
              autoFocus
            />
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2">
            {refusing ? (
              <>
                <DecideButton value="REJECTED" label="Confirm refusal" tone="danger" />
                <button
                  type="button"
                  className="btn btn-outline h-8 text-xs"
                  onClick={() => setRefusing(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <DecideButton value="APPROVED" label="Approve" tone="primary" />
                <button
                  type="button"
                  className="btn btn-outline h-8 text-xs"
                  onClick={() => setRefusing(true)}
                >
                  Not approved
                </button>
              </>
            )}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function RemindButton({ disabled, title }: { disabled: boolean; title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title={title}
      className="btn btn-outline h-8 text-xs disabled:opacity-50"
    >
      {pending ? 'Sending…' : 'Send reminder'}
    </button>
  );
}

function DecideButton({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: 'primary' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={value}
      disabled={pending}
      className={`btn h-8 text-xs ${tone === 'primary' ? 'btn-primary' : 'btn-outline text-danger-600'}`}
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
