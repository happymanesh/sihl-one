'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { ProductItem } from '@sihl-one/contracts';

import { updateLeadProducts, type ActionState } from '@/app/actions/leads';

const INITIAL: ActionState = { status: 'idle' };

/**
 * "You have reached them — what did they ask about?"
 *
 * A lead whose number has been confirmed but which carries no product is the
 * one shape that cannot be worked. Every per-product thing the system does —
 * the assign panel, the stage of each desk's work, the expertise preference,
 * every report that groups by product — has nothing to act on, and the lead
 * sits in the pipeline looking live while being impossible to progress.
 *
 * It appears at the moment the gap is newest and cheapest to fix: the rep has
 * just spoken to the client, so the answer is in their head rather than in a
 * note they would have to go back for.
 *
 * Dismissable, and deliberately not remembered. A prompt that cannot be shut
 * blocks whatever the rep actually opened the lead to do, and one that is
 * remembered for ever is a gap nobody is reminded of again — so Cancel clears
 * it for now and it returns on the next visit, which is what a nudge is.
 */
export function MissingProductsPrompt({
  leadId,
  leadName,
  mobile,
  products,
}: {
  leadId: string;
  leadName: string;
  mobile: string;
  products: ProductItem[];
}) {
  const router = useRouter();
  const [state, action] = useActionState(updateLeadProducts, INITIAL);
  const [dismissed, setDismissed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (state.status === 'success') {
      setDismissed(true);
      router.refresh();
    }
  }, [state, router]);

  if (dismissed || products.length === 0) return null;

  const toggle = (code: string) =>
    setPicked((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-navy-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="missing-products-title"
    >
      <div className="card w-full max-w-md p-5">
        <h2 id="missing-products-title" className="text-base font-bold">
          What are they interested in?
        </h2>

        {/* Who this is about. The rep may have several leads open, and a prompt
            that does not say whose number was just confirmed is a prompt they
            have to go and check before answering. */}
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          <span className="font-semibold text-[var(--color-text)]">{leadName}</span>
          {mobile ? <span className="tnum"> · {mobile}</span> : null}
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Their number is confirmed but no product is recorded, so there is nothing to assign or
          progress. Tick what came up.
        </p>

        {state.status === 'error' && state.message ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
          >
            {state.message}
          </p>
        ) : null}

        <form action={action} className="mt-3">
          <input type="hidden" name="leadId" value={leadId} />
          {/* The panel's own marker for "the form really did say something about
              products", so an empty tick list is a deliberate clear rather than
              a silent no-op. */}
          <input type="hidden" name="productsTouched" value="1" />

          <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] p-2">
            <div className="flex flex-wrap gap-1.5">
              {products.map((product) => {
                const on = picked.includes(product.code);
                return (
                  <label
                    key={product.code}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      on
                        ? 'border-teal-500 bg-teal-500 text-white'
                        : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="productInterest"
                      value={product.code}
                      checked={on}
                      onChange={() => toggle(product.code)}
                      className="sr-only"
                    />
                    {product.name}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setDismissed(true)}>
              Cancel
            </button>
            {/* Nothing ticked is nothing to save, so the button says so rather
                than accepting a submission that would do nothing. */}
            <SaveButton disabled={picked.length === 0} />
          </div>
        </form>
      </div>
    </div>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn btn-primary disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
