'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { LeadSourceItem, ProductGroupSummary, ProductItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import {
  createProduct,
  createProductGroup,
  createSource,
  updateProduct,
  updateProductGroup,
  updateSource,
  type MasterState,
} from '@/app/actions/masters';
import { formatNumber } from '@/lib/format';

const INITIAL: MasterState = { status: 'idle' };

type Tab = 'sources' | 'products' | 'groups';

export function MastersManager({
  sources,
  products,
  groups,
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
  groups: ProductGroupSummary[];
}) {
  const [tab, setTab] = useState<Tab>('sources');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['sources', `Lead sources (${sources.length})`],
            ['products', `Products (${products.length})`],
            ['groups', `Product groups (${groups.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`h-9 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              tab === value
                ? 'border-teal-500 bg-teal-500 text-white'
                : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sources' ? <SourcesTab sources={sources} /> : null}
      {tab === 'products' ? <ProductsTab products={products} groups={groups} /> : null}
      {tab === 'groups' ? <GroupsTab groups={groups} /> : null}
    </div>
  );
}

/**
 * The desks, and what sits in each.
 *
 * Until this screen existed the five groups were created by the deploy script
 * and a product could only be filed into one by changing a hard-coded map and
 * releasing — so a new product was permanently ungrouped, and nothing said so.
 */
function GroupsTab({ groups }: { groups: ProductGroupSummary[] }) {
  const [state, action] = useActionState(createProductGroup, INITIAL);

  return (
    <div className="space-y-4">
      <section className="card p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      </section>

      <form action={action} className="card space-y-3 p-5">
        <h2 className="font-bold">Add a group</h2>
        <p className="text-xs text-[var(--color-text-subtle)]">
          A desk that sells several products — Broking and Wealth are two. A person says which
          groups they sell on their user record, and lead assignment prefers somebody who sells what
          the client asked about.
        </p>
        <Feedback state={state} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Permanent. Uppercase, e.g. INSURANCE.">
            <input name="code" required maxLength={40} className="input font-mono" />
          </Field>
          <Field label="Name" hint="What people see.">
            <input name="name" required maxLength={80} className="input" />
          </Field>
        </div>

        <Field label="Order" hint="Low numbers first. The five built-in desks are 10 to 50.">
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={100}
            className="input max-w-[8rem]"
          />
        </Field>

        <Submit label="Add group" pendingLabel="Adding…" />
      </form>
    </div>
  );
}

function GroupRow({ group }: { group: ProductGroupSummary }) {
  const [state, action] = useActionState(updateProductGroup, INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{group.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">{group.code}</span>
            {!group.isActive ? <Badge tone="amber">Off</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {group.productCount === 0
              ? 'No products filed here yet'
              : `${formatNumber(group.productCount)} ${
                  group.productCount === 1 ? 'product' : 'products'
                }`}{' '}
            · order {group.sortOrder}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <form action={action}>
            <input type="hidden" name="id" value={group.id} />
            <input type="hidden" name="isActive" value={String(!group.isActive)} />
            <ToggleButton on={group.isActive} />
          </form>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            {open ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      <Feedback state={state} />

      {open ? (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={group.id} />
          <div className="min-w-[12rem] flex-1">
            <label className="label">Name</label>
            <input name="name" defaultValue={group.name} maxLength={80} className="input h-9" />
          </div>
          <div>
            <label className="label">Order</label>
            <input
              name="sortOrder"
              type="number"
              min={0}
              max={10000}
              defaultValue={group.sortOrder}
              className="input h-9 w-24"
            />
          </div>
          <Submit label="Save" pendingLabel="Saving…" small />
        </form>
      ) : null}

      {/* Switching a group off does not empty it — the products stay filed and
          come back if it is switched on again. Said here because "off" could
          reasonably be read the other way. */}
      {!group.isActive && group.productCount > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Its {formatNumber(group.productCount)}{' '}
          {group.productCount === 1 ? 'product stays' : 'products stay'} filed here, but it is no
          longer offered when filing others.
        </p>
      ) : null}
    </li>
  );
}

function SourcesTab({ sources }: { sources: LeadSourceItem[] }) {
  const [state, action] = useActionState(createSource, INITIAL);

  return (
    <div className="space-y-4">
      <section className="card p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      </section>

      <form action={action} className="card space-y-3 p-5">
        <h2 className="font-bold">Add a source</h2>
        <Feedback state={state} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Permanent. Uppercase, e.g. BRANCH_EVENT.">
            <input name="code" required maxLength={40} className="input font-mono" />
          </Field>
          <Field label="Label" hint="What people see in the dropdown.">
            <input name="label" required maxLength={80} className="input" />
          </Field>
        </div>

        <Field
          label="Scoring weight"
          hint="0–25 points a lead from this channel contributes. Required: a channel nobody has valued will silently score as average forever."
        >
          <input
            name="scoringWeight"
            type="number"
            min={0}
            max={25}
            required
            defaultValue={10}
            className="input max-w-[8rem]"
          />
        </Field>

        <Field label="Description" hint="Optional.">
          <input name="description" maxLength={300} className="input" />
        </Field>

        <Submit label="Add source" pendingLabel="Adding…" />
      </form>
    </div>
  );
}

function SourceRow({ source }: { source: LeadSourceItem }) {
  const [state, action] = useActionState(updateSource, INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{source.label}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">{source.code}</span>
            {source.isSystem ? <Badge tone="neutral">Built in</Badge> : null}
            {!source.isActive ? <Badge tone="amber">Off</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Weight {source.scoringWeight} · {formatNumber(source.leadCount)}{' '}
            {source.leadCount === 1 ? 'lead' : 'leads'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <form action={action}>
            <input type="hidden" name="id" value={source.id} />
            <input type="hidden" name="isActive" value={String(!source.isActive)} />
            <ToggleButton on={source.isActive} />
          </form>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            {open ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      <Feedback state={state} />

      {open ? (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={source.id} />
          <div className="min-w-[12rem] flex-1">
            <label className="label">Label</label>
            <input name="label" defaultValue={source.label} maxLength={80} className="input h-9" />
          </div>
          <div>
            <label className="label">Weight</label>
            <input
              name="scoringWeight"
              type="number"
              min={0}
              max={25}
              defaultValue={source.scoringWeight}
              className="input h-9 w-24"
            />
          </div>
          <Submit label="Save" pendingLabel="Saving…" small />
        </form>
      ) : null}
    </li>
  );
}

function ProductsTab({
  products,
  groups,
}: {
  products: ProductItem[];
  groups: ProductGroupSummary[];
}) {
  const [state, action] = useActionState(createProduct, INITIAL);

  // Only groups that are on. Filing something into a switched-off group would
  // put it somewhere that appears in no dropdown, and the API refuses it.
  const filable = groups.filter((group) => group.isActive);
  const ungrouped = products.filter((product) => !product.groupId).length;

  const topLevel = products.filter((product) => !product.parentId);
  const childrenOf = (parentId: string) =>
    products.filter((product) => product.parentId === parentId);

  return (
    <div className="space-y-4">
      {/*
        Ungrouped products are not an error, but they are never what anybody
        intended: expertise ordering and the group-inheritance rule both do
        nothing for them, silently. Worth saying once, where they can be fixed.
      */}
      {ungrouped > 0 ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/15">
          {ungrouped} {ungrouped === 1 ? 'product has' : 'products have'} no group. Lead assignment
          cannot prefer a rep by expertise for {ungrouped === 1 ? 'it' : 'them'}, and a new one
          added to a lead will not join whoever already handles that desk. Use Edit below to file{' '}
          {ungrouped === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      <section className="card p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {/* Parents first, each followed by its own sub-products. A flat
              alphabetical list hides the structure that makes sub-products
              worth having — "Equity" and "Equity intraday" would sit apart. */}
          {topLevel.map((parent) => (
            <li key={parent.id}>
              <ProductRow product={parent} groups={filable} />
              {childrenOf(parent.id).length > 0 ? (
                <ul className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] pl-6">
                  {childrenOf(parent.id).map((child) => (
                    <li
                      key={child.id}
                      className="border-b border-[var(--color-border)] last:border-b-0"
                    >
                      <ProductRow product={child} groups={filable} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <form action={action} className="card space-y-3 p-5">
        <h2 className="font-bold">Add a product</h2>
        <p className="text-xs text-[var(--color-text-subtle)]">
          {/* The catalogue and the dropdown are one list on purpose. */}
          What you write here is what a salesperson reads out to a client.
        </p>
        <Feedback state={state} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Permanent. Uppercase.">
            <input name="code" required maxLength={40} className="input font-mono" />
          </Field>
          <Field label="Name">
            <input name="name" required maxLength={80} className="input" />
          </Field>
        </div>

        <Field
          label="Sits under"
          hint="Leave blank for a top-level product. Two levels only — a sub-product cannot have its own."
        >
          <select name="parentId" className="input" defaultValue="">
            <option value="">Top-level product</option>
            {topLevel.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Group"
          hint="The desk that sells it. Leave blank only for something no desk owns — a partner programme, say."
        >
          <select name="groupId" className="input" defaultValue="">
            <option value="">No group</option>
            {filable.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Summary" hint="One line, shown on the chip and the card.">
          <input name="summary" maxLength={300} className="input" />
        </Field>

        <Field label="Key benefits" hint="One per line.">
          <textarea name="keyBenefits" rows={3} className="input resize-none" />
        </Field>

        <Field label="Charges" hint="Indicative only — the back office owns actual pricing.">
          <input name="chargesSummary" maxLength={600} className="input" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Eligibility">
            <input name="eligibility" maxLength={600} className="input" />
          </Field>
          <Field label="Risk note" hint="SEBI wording where it applies.">
            <input name="riskNote" maxLength={600} className="input" />
          </Field>
        </div>

        <Submit label="Add product" pendingLabel="Adding…" />
      </form>
    </div>
  );
}

function ProductRow({ product, groups }: { product: ProductItem; groups: ProductGroupSummary[] }) {
  const [state, action] = useActionState(updateProduct, INITIAL);
  const [open, setOpen] = useState(false);

  /*
    A group this product sits in but which has since been switched off still
    belongs in its own dropdown, or opening Edit and saving would silently move
    the product out of it. The list is otherwise the filable ones.
  */
  const options: Array<{ id: string; name: string }> =
    product.groupId && !groups.some((group) => group.id === product.groupId)
      ? [...groups, { id: product.groupId, name: `${product.groupName ?? 'Current'} (off)` }]
      : groups;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{product.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">
              {product.code}
            </span>
            {product.groupName ? (
              <Badge tone="navy">{product.groupName}</Badge>
            ) : (
              <Badge tone="amber">No group</Badge>
            )}
            {product.isSystem ? <Badge tone="neutral">Built in</Badge> : null}
            {!product.isActive ? <Badge tone="amber">Off</Badge> : null}
            {!product.description ? <Badge tone="amber">No details yet</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {product.summary ?? 'No summary'} · {formatNumber(product.leadCount)}{' '}
            {product.leadCount === 1 ? 'lead' : 'leads'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Its own form, carrying only `id` and `isActive`. The edit form
              below posts the fields it shows; neither sends the other's, so a
              switch-off cannot overwrite a group. */}
          <form action={action}>
            <input type="hidden" name="id" value={product.id} />
            <input type="hidden" name="isActive" value={String(!product.isActive)} />
            <ToggleButton on={product.isActive} />
          </form>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            {open ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      <Feedback state={state} />

      {open ? (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={product.id} />
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor={`name-${product.id}`}>
              Name
            </label>
            <input
              id={`name-${product.id}`}
              name="name"
              defaultValue={product.name}
              maxLength={80}
              className="input h-9"
            />
          </div>
          <div className="min-w-[10rem]">
            <label className="label" htmlFor={`group-${product.id}`}>
              Group
            </label>
            <select
              id={`group-${product.id}`}
              name="groupId"
              defaultValue={product.groupId ?? ''}
              className="input h-9 py-0"
            >
              <option value="">No group</option>
              {options.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <Submit label="Save" pendingLabel="Saving…" small />
        </form>
      ) : null}
    </li>
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
    </div>
  );
}

function Feedback({ state }: { state: MasterState }) {
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

function Submit({
  label,
  pendingLabel,
  small,
}: {
  label: string;
  pendingLabel: string;
  small?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn btn-primary ${small ? 'h-9 text-sm' : ''}`}
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
