'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DATA_SCOPES, type DesignationSummary } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { createDesignation, toggleDesignation, type UserFormState } from '@/app/actions/users';
import { humanise } from '@/lib/format';

const INITIAL: UserFormState = { status: 'idle' };

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function ToggleButton({ id, isActive, inUse }: { id: string; isActive: boolean; inUse: boolean }) {
  const [state, action] = useActionState(toggleDesignation, INITIAL);
  const { pending } = useFormStatus();

  return (
    <form action={action}>
      <input type="hidden" name="designationId" value={id} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button
        type="submit"
        className="btn btn-ghost h-8 text-xs"
        // Deactivating a level people still hold would strip their place in the
        // hierarchy and the scope derived from it. The API refuses too; this
        // just avoids offering the action.
        disabled={pending || (isActive && inUse)}
        title={isActive && inUse ? 'Move the people at this level first' : undefined}
      >
        {isActive ? 'Deactivate' : 'Activate'}
      </button>
      {state.status === 'error' && state.message ? (
        <p className="mt-1 text-xs text-danger-500">{state.message}</p>
      ) : null}
    </form>
  );
}

export function DesignationManager({ designations }: { designations: DesignationSummary[] }) {
  const [state, action] = useActionState(createDesignation, INITIAL);
  const [showForm, setShowForm] = useState(false);

  // Suggest a level that sits in an existing gap, so adding one does not
  // require renumbering anybody.
  const levels = designations.map((d) => d.level).sort((a, b) => a - b);
  const suggested = (() => {
    for (let index = 1; index < levels.length; index += 1) {
      const gap = levels[index]! - levels[index - 1]!;
      if (gap >= 4) return levels[index - 1]! + Math.floor(gap / 2);
    }
    return (levels[levels.length - 1] ?? 100) + 10;
  })();

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
            <tr>
              {['Level', 'Designation', 'Sees', 'People', ''].map((heading) => (
                <th
                  key={heading}
                  className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {designations.map((designation) => (
              <tr
                key={designation.id}
                className={designation.isActive ? '' : 'opacity-60'}
              >
                <td className="px-4 py-3 font-bold tnum">{designation.level}</td>
                <td className="px-4 py-3">
                  <span className="font-semibold">{designation.name}</span>
                  {!designation.isActive ? (
                    <Badge tone="neutral">
                      <span className="ml-1">Inactive</span>
                    </Badge>
                  ) : null}
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {designation.code}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs">{humanise(designation.defaultScope)}</td>
                <td className="px-4 py-3 text-xs tnum">{designation.userCount ?? 0}</td>
                <td className="px-4 py-3 text-right">
                  <ToggleButton
                    id={designation.id}
                    isActive={designation.isActive}
                    inUse={(designation.userCount ?? 0) > 0}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm ? (
        <form action={action} className="card space-y-3 p-5">
          <h2 className="font-bold">Add a level</h2>

          {state.status === 'error' && state.message ? (
            <p
              role="alert"
              className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
            >
              {state.message}
            </p>
          ) : null}
          {state.status === 'success' && state.message ? (
            <p className="rounded-lg border border-teal-500/40 bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-900/30 dark:text-teal-200">
              {state.message}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Name <span className="text-danger-500">*</span>
              </label>
              <input id="name" name="name" className="input" required placeholder="Cluster Head" />
            </div>
            <div>
              <label className="label" htmlFor="code">
                Code <span className="text-danger-500">*</span>
              </label>
              <input
                id="code"
                name="code"
                className="input font-mono uppercase"
                required
                placeholder="CLUSTER_HEAD"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="level">
                Level <span className="text-danger-500">*</span>
              </label>
              <input
                id="level"
                name="level"
                type="number"
                min={1}
                max={1000}
                className="input"
                required
                defaultValue={suggested}
              />
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Higher is more senior. {suggested} sits in a gap between existing levels.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="defaultScope">
                Sees by default <span className="text-danger-500">*</span>
              </label>
              <select id="defaultScope" name="defaultScope" className="input" required defaultValue="BRANCH">
                {DATA_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {humanise(scope)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked className="h-4 w-4" />
            Available immediately
          </label>

          <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
            <Submit label="Add level" pendingLabel="Adding…" />
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-outline" onClick={() => setShowForm(true)}>
          Add a level
        </button>
      )}
    </div>
  );
}
