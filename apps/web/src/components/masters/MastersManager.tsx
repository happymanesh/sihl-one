'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { LeadSourceItem, ProductItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import {
  createProduct,
  createSource,
  updateProduct,
  updateSource,
  type MasterState,
} from '@/app/actions/masters';
import { formatNumber } from '@/lib/format';

const INITIAL: MasterState = { status: 'idle' };

type Tab = 'sources' | 'products';

export function MastersManager({
  sources,
  products,
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
}) {
  const [tab, setTab] = useState<Tab>('sources');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ['sources', `Lead sources (${sources.length})`],
            ['products', `Products (${products.length})`],
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

      {tab === 'sources' ? <SourcesTab sources={sources} /> : <ProductsTab products={products} />}
    </div>
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

function ProductsTab({ products }: { products: ProductItem[] }) {
  const [state, action] = useActionState(createProduct, INITIAL);

  const topLevel = products.filter((product) => !product.parentId);
  const childrenOf = (parentId: string) =>
    products.filter((product) => product.parentId === parentId);

  return (
    <div className="space-y-4">
      <section className="card p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {/* Parents first, each followed by its own sub-products. A flat
              alphabetical list hides the structure that makes sub-products
              worth having — "Equity" and "Equity intraday" would sit apart. */}
          {topLevel.map((parent) => (
            <li key={parent.id}>
              <ProductRow product={parent} />
              {childrenOf(parent.id).length > 0 ? (
                <ul className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] pl-6">
                  {childrenOf(parent.id).map((child) => (
                    <li key={child.id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <ProductRow product={child} />
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

function ProductRow({ product }: { product: ProductItem }) {
  const [state, action] = useActionState(updateProduct, INITIAL);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{product.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">
              {product.code}
            </span>
            {product.isSystem ? <Badge tone="neutral">Built in</Badge> : null}
            {!product.isActive ? <Badge tone="amber">Off</Badge> : null}
            {!product.description ? <Badge tone="amber">No details yet</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {product.summary ?? 'No summary'} · {formatNumber(product.leadCount)}{' '}
            {product.leadCount === 1 ? 'lead' : 'leads'}
          </p>
        </div>

        <form action={action}>
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="isActive" value={String(!product.isActive)} />
          <ToggleButton on={product.isActive} />
        </form>
      </div>

      <Feedback state={state} />
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
