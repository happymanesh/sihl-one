'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * The least this control needs from an action's state.
 *
 * Deliberately not `UserFormState`: the two screens that use this switch have
 * their own state types, and tying the component to one of them would drag the
 * users module into the org-unit screen for the sake of a status string.
 */
export interface SwitchState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

const INITIAL: SwitchState = { status: 'idle' };

function Track({ on, disabled }: { on: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      disabled={pending || disabled}
      aria-label={on ? 'Switch event access off' : 'Switch event access on'}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
        on
          ? 'border-teal-600 bg-teal-500'
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/**
 * The events on/off switch, shared by the hierarchy-level and branch screens.
 *
 * A switch rather than a button labelled "Allow" or "Withdraw", because this is
 * a state and not an action: an administrator scanning the column wants to see
 * at a glance which rows are on, and a column of buttons whose text depends on
 * the row reads backwards — "Withdraw" appears exactly where access is granted.
 *
 * Access is the AND of this switch on a person's level and the one on their
 * branch, so either screen alone can only ever answer half the question. The
 * `hint` is where each screen says which half it is showing.
 */
export function EventAccessSwitch({
  action,
  idField,
  id,
  enabled,
  hint,
  disabled = false,
}: {
  action: (state: SwitchState, formData: FormData) => Promise<SwitchState>;
  /** The form field the id is posted under — differs between the two screens. */
  idField: string;
  id: string;
  enabled: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name={idField} value={id} />
      <input type="hidden" name="canAccessEvents" value={String(!enabled)} />
      <Track on={enabled} disabled={disabled} />
      {hint ? (
        <span className="text-[11px] leading-tight text-[var(--color-text-subtle)]">{hint}</span>
      ) : null}
      {state.status === 'error' && state.message ? (
        <span className="text-[11px] leading-tight text-danger-500">{state.message}</span>
      ) : null}
    </form>
  );
}
