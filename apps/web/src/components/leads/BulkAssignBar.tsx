'use client';

import { useActionState, useState } from 'react';

import { bulkAssignLeads, type ActionState } from '@/app/actions/leads';
import { useLeadSelection } from '@/components/leads/LeadSelection';

export interface AssignableOption {
  id: string;
  fullName: string;
}

const IDLE: ActionState = { status: 'idle' };

/**
 * The assign controls, shown in place of the search box while leads are ticked.
 *
 * Swapping rather than stacking is the point. Searching and assigning are
 * different modes — a search box beside a live selection invites someone to
 * filter the list out from under the batch they were about to move, and the ids
 * they ticked would go with it. One row, one job at a time.
 *
 * Renders nothing when nothing is ticked, which is what puts the search box
 * back the moment the selection empties or an assignment lands.
 */
export function BulkAssignBar({ people }: { people: AssignableOption[] }) {
  const selection = useLeadSelection();
  const [state, formAction, pending] = useActionState(bulkAssignLeads, IDLE);
  const [ownerId, setOwnerId] = useState('');

  /*
    Clear the ticks once an assignment succeeds.

    Adjusted during render on the action's own result rather than in an effect:
    the leads that moved are about to disappear from the list anyway, and
    holding their ids would leave the bar open over a selection that no longer
    exists. `seen` is what stops this firing again on every later render.
  */
  const [seen, setSeen] = useState<ActionState>(IDLE);
  if (state !== seen) {
    setSeen(state);
    if (state.status === 'success') {
      selection?.clear();
      setOwnerId('');
    }
  }

  // The success message has to survive the selection being emptied, so it is
  // rendered from the action result rather than from the bar being open.
  if (!selection || selection.selected.length === 0) {
    return state.status === 'success' && state.message ? (
      <p className="text-sm font-semibold text-brand-green-700 dark:text-brand-green-400">
        {state.message}
      </p>
    ) : null;
  }

  const count = selection.selected.length;

  return (
    <form action={formAction} className="flex flex-1 flex-wrap items-center gap-2">
      <input type="hidden" name="leadIds" value={selection.selected.join(',')} />

      <span className="text-sm font-semibold">
        {count} {count === 1 ? 'lead' : 'leads'} selected
      </span>

      <select
        name="ownerId"
        value={ownerId}
        onChange={(event) => setOwnerId(event.target.value)}
        className="input h-9 w-auto"
        aria-label="Assign the selected leads to"
        required
      >
        <option value="">Assign to…</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.fullName}
          </option>
        ))}
      </select>

      <button type="submit" className="btn btn-primary h-9" disabled={pending || !ownerId}>
        {pending ? 'Assigning…' : 'Assign'}
      </button>

      <button
        type="button"
        onClick={() => selection.clear()}
        className="btn btn-ghost h-9 text-xs"
        disabled={pending}
      >
        Cancel
      </button>

      {state.status === 'error' && state.message ? (
        <span className="text-sm font-semibold text-danger-600 dark:text-danger-500">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
