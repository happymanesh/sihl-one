'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Route } from 'next';
import { PRIORITIES } from '@sihl-one/contracts';

/**
 * The filter row under the grid headings.
 *
 * One control per column, because that is how the grid is used: a manager
 * narrows to one person's overdue calls for one client, and a single search
 * box cannot express that. They AND together on the server.
 *
 * Typing is debounced and written to the URL rather than held in component
 * state, so a filtered grid is a link somebody can send, a refresh keeps the
 * view, and the back button steps through the narrowing rather than leaving
 * the page.
 */
export function TaskGridFilters({ assignees }: { assignees: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const params = useSearchParams();

  const [draft, setDraft] = useState({
    reference: params.get('reference') ?? '',
    title: params.get('title') ?? '',
    client: params.get('client') ?? '',
    priority: params.get('priority') ?? '',
    assigneeId: params.get('assigneeId') ?? '',
    dueFrom: params.get('dueFrom') ?? '',
    dueTo: params.get('dueTo') ?? '',
  });

  /*
    Debounced, so a four-letter name is one request and not four.

    The dependency is the serialised draft rather than the object, which is a
    new reference on every keystroke and would re-arm the timer forever.
  */
  const serialised = JSON.stringify(draft);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(JSON.parse(serialised) as typeof draft)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any change to a filter puts you back on the first page. Staying on
      // page 4 of a narrower result is how a grid appears to be empty.
      next.delete('page');

      const query = next.toString();
      const current = params.toString();
      if (query === current) return;
      router.replace(`/tasks${query ? `?${query}` : ''}` as Route, { scroll: false });
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised]);

  const set = (field: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const anyFilter = Object.values(draft).some(Boolean);

  return (
    <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* The row-number column takes no filter. */}
      <td className="px-2 py-1.5" />

      <Cell>
        <input
          value={draft.reference}
          onChange={(event) => set('reference')(event.target.value)}
          placeholder="TK-…"
          aria-label="Filter by task number"
          className="input h-8 text-xs"
        />
      </Cell>

      <Cell>
        <input
          value={draft.title}
          onChange={(event) => set('title')(event.target.value)}
          placeholder="Task"
          aria-label="Filter by task"
          className="input h-8 text-xs"
        />
      </Cell>

      <Cell>
        <input
          value={draft.client}
          onChange={(event) => set('client')(event.target.value)}
          placeholder="Name, mobile or LD-…"
          aria-label="Filter by client"
          className="input h-8 text-xs"
        />
      </Cell>

      <Cell>
        <div className="flex gap-1">
          <input
            type="date"
            value={draft.dueFrom}
            onChange={(event) => set('dueFrom')(event.target.value)}
            aria-label="Due on or after"
            className="input h-8 text-xs"
          />
          <input
            type="date"
            value={draft.dueTo}
            onChange={(event) => set('dueTo')(event.target.value)}
            aria-label="Due on or before"
            className="input h-8 text-xs"
          />
        </div>
      </Cell>

      <Cell>
        <select
          value={draft.priority}
          onChange={(event) => set('priority')(event.target.value)}
          aria-label="Filter by priority"
          className="input h-8 text-xs"
        >
          <option value="">Any</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority.charAt(0) + priority.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </Cell>

      <Cell>
        <select
          value={draft.assigneeId}
          onChange={(event) => set('assigneeId')(event.target.value)}
          aria-label="Filter by assignee"
          className="input h-8 text-xs"
        >
          <option value="">Anyone</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Cell>

      <Cell>
        {anyFilter ? (
          <button
            type="button"
            onClick={() =>
              setDraft({
                reference: '',
                title: '',
                client: '',
                priority: '',
                assigneeId: '',
                dueFrom: '',
                dueTo: '',
              })
            }
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            Clear
          </button>
        ) : null}
      </Cell>
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1.5 align-top">{children}</td>;
}
