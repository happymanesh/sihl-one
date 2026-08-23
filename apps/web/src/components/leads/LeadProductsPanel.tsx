'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductItem } from '@sihl-one/contracts';

import { updateLeadProducts, type ActionState } from '@/app/actions/leads';
import { Badge } from '@/components/ui/Badge';

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
  canEdit,
}: {
  leadId: string;
  selected: string[];
  products: ProductItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(updateLeadProducts, INITIAL);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    if (state.status === 'success') {
      setEditing(false);
      router.refresh();
    }
  }, [state.status, router]);

  // Re-sync when the server sends a fresh list, so a cancel after fiddling
  // does not leave the checkboxes showing something that was never saved.
  useEffect(() => setPicked(selected), [selected]);

  const label = (code: string) =>
    products.find((product) => product.code === code)?.name ?? code;

  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {selected.map((code) => (
          <Badge key={code} tone="navy">
            {label(code)}
          </Badge>
        ))}

        {selected.length === 0 ? (
          <span className="text-xs text-[var(--color-text-subtle)]">No products recorded</span>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-teal-600 underline underline-offset-2 hover:text-teal-700 dark:text-teal-300"
          >
            {selected.length === 0 ? 'Add products' : 'Edit'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <input type="hidden" name="leadId" value={leadId} />
      {/* Posted even when nothing is ticked, so clearing the list is a thing a
          rep can actually do — without it, an empty selection would read as
          "the form said nothing" and silently keep the old products. */}
      <input type="hidden" name="productsTouched" value="1" />

      <p className="text-xs font-semibold">What are they interested in?</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {products.map((product) => (
          <label
            key={product.code}
            className="cursor-pointer rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-semibold transition-colors has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white"
          >
            <input
              type="checkbox"
              name="productInterest"
              value={product.code}
              checked={picked.includes(product.code)}
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
          </label>
        ))}
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-xs text-danger-500">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-accent h-8 px-3 text-xs">Save</button>
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
