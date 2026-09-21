'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ALLOWED_PARENT_TYPES, ORG_UNIT_TYPES, type OrgUnitNode } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import {
  createOrgUnit,
  moveOrgUnit,
  toggleOrgUnitEvents,
  updateOrgUnit,
  type OrgState,
} from '@/app/actions/org-units';
import { EventAccessSwitch } from '@/components/admin/EventAccessSwitch';
import { formatNumber, humanise } from '@/lib/format';

const INITIAL: OrgState = { status: 'idle' };

const TYPE_TONES: Record<string, 'navy' | 'teal' | 'green' | 'neutral'> = {
  COMPANY: 'navy',
  ZONE: 'teal',
  REGION: 'green',
  BRANCH: 'neutral',
  TEAM: 'neutral',
};

export function OrgTree({ units }: { units: OrgUnitNode[] }) {
  return (
    <div className="space-y-4">
      <section className="card p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {units.map((unit) => (
            <UnitRow key={unit.id} unit={unit} units={units} />
          ))}
        </ul>
      </section>

      <AddUnitForm units={units} />
    </div>
  );
}

function UnitRow({ unit, units }: { unit: OrgUnitNode; units: OrgUnitNode[] }) {
  const [state, action] = useActionState(updateOrgUnit, INITIAL);
  const [panel, setPanel] = useState<'none' | 'rename' | 'move'>('none');

  // A unit cannot move into its own subtree, and the type rules still apply.
  const validParents = units.filter(
    (candidate) =>
      candidate.id !== unit.id &&
      !candidate.path.startsWith(unit.path) &&
      ALLOWED_PARENT_TYPES[unit.type].includes(candidate.type),
  );

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0" style={{ paddingLeft: `${unit.depth * 1.25}rem` }}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Depth is shown as indentation *and* stated as a type, because
                indentation alone disappears the moment the list wraps. */}
            <Badge tone={TYPE_TONES[unit.type] ?? 'neutral'}>{humanise(unit.type)}</Badge>
            <span className="font-semibold">{unit.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">{unit.code}</span>
            {!unit.isActive ? <Badge tone="amber">Off</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {formatNumber(unit.userCount)} {unit.userCount === 1 ? 'person' : 'people'} ·{' '}
            {formatNumber(unit.leadCount)} {unit.leadCount === 1 ? 'lead' : 'leads'}
            {unit.childCount > 0 ? ` · ${unit.childCount} under it` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs font-semibold">
          {/*
            Events, switched on here and inherited downwards.

            A unit covered by an ancestor shows its own switch off with a note
            saying where the access comes from, rather than showing it on — a
            switch that reads on when nothing is set here would be a lie the
            moment somebody turned the parent off.
          */}
          <EventAccessSwitch
            action={toggleOrgUnitEvents}
            idField="id"
            id={unit.id}
            enabled={unit.canAccessEvents}
            hint={
              unit.canAccessEvents
                ? 'Events on'
                : unit.eventsInherited
                  ? 'On, from above'
                  : 'Events off'
            }
          />
          <button
            type="button"
            onClick={() => setPanel(panel === 'rename' ? 'none' : 'rename')}
            className="text-[var(--color-text-muted)] underline underline-offset-2"
          >
            Rename
          </button>
          {unit.type !== 'COMPANY' && validParents.length > 0 ? (
            <button
              type="button"
              onClick={() => setPanel(panel === 'move' ? 'none' : 'move')}
              className="text-[var(--color-text-muted)] underline underline-offset-2"
            >
              Move
            </button>
          ) : null}
          {unit.type !== 'COMPANY' ? (
            <form action={action}>
              <input type="hidden" name="id" value={unit.id} />
              <input type="hidden" name="isActive" value={String(!unit.isActive)} />
              <ToggleButton on={unit.isActive} />
            </form>
          ) : null}
        </div>
      </div>

      <Feedback state={state} />

      {panel === 'rename' ? (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={unit.id} />
          <div className="min-w-[14rem] flex-1">
            <label className="label">Name</label>
            <input name="name" defaultValue={unit.name} maxLength={120} className="input h-9" />
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              {/* Paths are built from ids, so this is genuinely cosmetic. */}
              Renaming changes nothing about who can see what.
            </p>
          </div>
          <Submit label="Save" pendingLabel="Saving…" />
        </form>
      ) : null}

      {panel === 'move' ? <MoveForm unit={unit} validParents={validParents} /> : null}
    </li>
  );
}

function MoveForm({
  unit,
  validParents,
}: {
  unit: OrgUnitNode;
  validParents: OrgUnitNode[];
}) {
  const [state, action] = useActionState(moveOrgUnit, INITIAL);

  return (
    <form action={action} className="mt-3 space-y-2 rounded-lg border border-warn-500/40 bg-warn-50 p-3 dark:bg-warn-500/10">
      <input type="hidden" name="id" value={unit.id} />

      <p className="text-xs font-semibold text-warn-600">
        {/* Said plainly: this is the action that changes visibility. */}
        Everything under {unit.name} moves with it, and the people in it will immediately see a
        different set of records.
      </p>

      <Feedback state={state} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label className="label">Move under</label>
          <select name="parentId" required className="input h-9" defaultValue="">
            <option value="" disabled>
              Choose a parent
            </option>
            {validParents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {'— '.repeat(parent.depth)}
                {parent.name} ({humanise(parent.type)})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="label">Why</label>
          <input
            name="reason"
            required
            minLength={5}
            maxLength={300}
            placeholder="Surat realigned to the Maharashtra region"
            className="input h-9"
          />
        </div>
        <Submit label="Move" pendingLabel="Moving…" />
      </div>
    </form>
  );
}

function AddUnitForm({ units }: { units: OrgUnitNode[] }) {
  const [state, action] = useActionState(createOrgUnit, INITIAL);
  const [type, setType] = useState<(typeof ORG_UNIT_TYPES)[number]>('BRANCH');

  // Only parents the chosen type is actually allowed to sit under.
  const parents = units.filter((unit) => ALLOWED_PARENT_TYPES[type].includes(unit.type));

  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="font-bold">Open a branch, region or zone</h2>
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Type</label>
          <select
            name="type"
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            {ORG_UNIT_TYPES.filter((value) => value !== 'COMPANY').map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Code</label>
          <input name="code" required maxLength={40} placeholder="AHM-BOP" className="input font-mono" />
        </div>
        <div>
          <label className="label">Name</label>
          <input name="name" required maxLength={120} placeholder="Bopal branch" className="input" />
        </div>
      </div>

      <div>
        <label className="label">Sits under</label>
        <select name="parentId" required className="input" defaultValue="">
          <option value="" disabled>
            Choose a parent
          </option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {'— '.repeat(parent.depth)}
              {parent.name} ({humanise(parent.type)})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          A {type.toLowerCase()} can sit under:{' '}
          {ALLOWED_PARENT_TYPES[type].map((value) => value.toLowerCase()).join(', ')}.
        </p>
      </div>

      <Submit label="Add unit" pendingLabel="Adding…" />
    </form>
  );
}

function ToggleButton({ on }: { on: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
        on
          ? 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
          : 'border-teal-500 text-teal-600 dark:text-teal-300'
      }`}
    >
      {pending ? '…' : on ? 'Switch off' : 'Switch on'}
    </button>
  );
}

function Feedback({ state }: { state: OrgState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <p
      role="alert"
      className={`mt-2 rounded-lg px-3 py-2 text-xs ${
        isError
          ? 'border border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
          : 'border border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
      }`}
    >
      {state.message}
    </p>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-9 text-sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
