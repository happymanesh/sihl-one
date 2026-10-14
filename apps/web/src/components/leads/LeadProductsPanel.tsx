'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeadProductView, ProductItem } from '@sihl-one/contracts';

import { updateLeadProducts, type ActionState } from '@/app/actions/leads';
import { ProductGroupList } from '@/components/products/ProductGroupList';
import { humanise } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

/**
 * The products a lead is interested in, editable in place.
 *
 * These used to be fixed at creation, which did not survive contact with the
 * job: a rep goes in to talk about equity and comes out having been asked about
 * PMS. Recording that only against the interaction left the lead itself looking
 * like a single-product prospect, so it never showed up in a filter for PMS.
 *
 * Sits in the header where the products were already displayed, rather than as
 * a new card. One place to read them and the same place to change them.
 */
export function LeadProductsPanel({
  leadId,
  selected,
  products,
  leadProducts,
  canEdit,
}: {
  leadId: string;
  selected: string[];
  products: ProductItem[];
  /** Where each product on this lead stands, so a worked one cannot be dropped. */
  leadProducts: LeadProductView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(updateLeadProducts, INITIAL);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>(selected);

  // Keyed on the whole state rather than `state.status`: two successful saves
  // running leave that string unchanged, so the effect never fires the second
  // time and the editor stays open. Same defect as the outcomes panel below it.
  useEffect(() => {
    if (state.status === 'success') {
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  // Re-sync when the server sends a fresh list, so a cancel after fiddling
  // does not leave the checkboxes showing something that was never saved.
  useEffect(() => setPicked(selected), [selected]);

  /*
    A product somebody has worked cannot be unticked.

    The server has enforced this since the per-product work shipped, but it does
    so silently — it keeps the row and reports success, so unticking looked like
    it had saved and the product came back on the next load. The tick is
    disabled here so the rule is visible at the moment it applies rather than
    discovered afterwards.

    "Worked" means the status has moved at all. Once it has, the product is part
    of the lead's history and the way to end it is to mark it lost, not to make
    it never have existed.
  */
  const statusOf = new Map(leadProducts.map((row) => [row.productCode, row.status]));

  /*
    The catalogue by desk, in the order the master defines.

    A product with no group collects under "Other" rather than vanishing: an
    unfiled product is a gap in the master, not a reason to hide something a
    client can be interested in.
  */
  const grouped: Array<{ name: string; items: ProductItem[] }> = [];
  for (const product of products) {
    const name = product.groupName ?? 'Other';
    const existing = grouped.find((group) => group.name === name);
    if (existing) existing.items.push(product);
    else grouped.push({ name, items: [product] });
  }
  const isLocked = (code: string) => {
    const status = statusOf.get(code);
    return Boolean(status && status !== 'NEW');
  };

  if (!editing) {
    /*
      Everything on this lead, including anything locked.

      The chips were drawn from `productInterest` alone, so a product that had
      been worked but was missing from that array — which legacy rows and the
      old interest cap both produced — was invisible here while still being
      locked, still carrying a status, and still counting towards the lead. The
      union is the honest list: what they are interested in, plus anything with
      work recorded against it.
    */
    const shown = [...new Set([...selected, ...leadProducts.map((row) => row.productCode)])];

    return (
      <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <ProductGroupList
          codes={shown}
          products={products}
          // The same marker the edit view uses, so "why can I not untick this"
          // is answered before the edit view is opened.
          annotate={(code) => (isLocked(code) ? <span aria-label=" (locked)"> 🔒</span> : null)}
        />

        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-teal-600 underline underline-offset-2 hover:text-teal-700 dark:text-teal-300"
          >
            {shown.length === 0 ? 'Add products' : 'Edit'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={action}
      className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
    >
      <input type="hidden" name="leadId" value={leadId} />
      {/* Posted even when nothing is ticked, so clearing the list is a thing a
          rep can actually do — without it, an empty selection would read as
          "the form said nothing" and silently keep the old products. */}
      <input type="hidden" name="productsTouched" value="1" />

      <p className="text-xs font-semibold">What are they interested in?</p>
      {leadProducts.some((row) => row.status !== 'NEW') ? (
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          A product somebody has already worked cannot be removed — mark it lost instead.
        </p>
      ) : null}

      {/*
        Grouped by desk, one row each — the same reading as everywhere else a
        product is shown. This view kept its own flat chip list when the shared
        picker was grouped, so the lead screen disagreed with the new-lead form
        about how the catalogue is organised.

        A grid rather than indented text, so a desk whose products wrap
        continues under the products and not under its own label.
      */}
      <div className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2">
        {grouped.map((group) => (
          <div key={group.name} className="col-span-2 grid grid-cols-subgrid items-baseline">
            <span className="whitespace-nowrap text-xs font-bold text-[var(--color-text-muted)]">
              {group.name} :
            </span>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((product) => {
                const locked = isLocked(product.code);
                return (
                  <label
                    key={product.code}
                    // Still checked, still readable, simply not changeable — and the
                    // cursor says so before the click rather than after.
                    title={
                      locked
                        ? `${humanise(statusOf.get(product.code) ?? '')} — mark it lost to close it, it cannot be removed`
                        : undefined
                    }
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      locked
                        ? 'cursor-not-allowed border-teal-500/40 bg-teal-500/40 text-white'
                        : 'cursor-pointer border-[var(--color-border-strong)] has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="productInterest"
                      value={product.code}
                      checked={picked.includes(product.code)}
                      disabled={locked}
                      onChange={(event) =>
                        setPicked((current) =>
                          event.target.checked
                            ? [...current, product.code]
                            : current.filter((code) => code !== product.code),
                        )
                      }
                      aria-label={product.name}
                      className="sr-only"
                    />
                    {product.name}
                    {locked ? <span aria-hidden> 🔒</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-xs text-danger-500">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-accent h-8 px-3 text-xs">
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setPicked(selected);
            setEditing(false);
          }}
          className="btn btn-outline h-8 px-3 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
