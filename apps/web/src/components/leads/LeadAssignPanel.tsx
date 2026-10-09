'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import type { LeadProductView } from '@sihl-one/contracts';

import { assignLeadProduct, assignAllLeadProducts } from '@/app/actions/leads';
import { Badge } from '@/components/ui/Badge';
import { humanise } from '@/lib/format';

/** Somebody a product can be handed to, with enough to tell two Sharmas apart. */
export interface AssignableOption {
  id: string;
  fullName: string;
  designation: string | null;
  branch: string | null;
  /** Product groups they sell, so the list can lead with the people who fit. */
  productGroups: string[];
}

const INITIAL = { status: 'idle' as const };

/**
 * Who is working each product on this lead.
 *
 * A client's broking business and their wealth business are two conversations
 * with two desks, so work is handed over one product at a time rather than by
 * moving the whole lead. The lead's own owner stays as the person accountable
 * for the client and answers for any product nobody has been named for.
 *
 * Only the lead owner or a manager sees this. A lead product owner holds one
 * desk's work and does not get to pass it on — otherwise a lead migrates across
 * the firm a product at a time with nobody having decided it should.
 */
export function LeadAssignPanel({
  leadId,
  leadProducts,
  assignableCodes,
  assignable,
  groupOfProduct,
  leadOwnerName,
}: {
  leadId: string;
  leadProducts: LeadProductView[];
  /**
   * The products this person is working, and so the ones they can hand on.
   *
   * The panel used to list every product on the lead, including ones already
   * being worked by somebody else — so it offered to move another desk's work
   * and the save was refused. You give away what you hold.
   */
  assignableCodes: string[];
  assignable: AssignableOption[];
  /** Product code to its group code, for ordering the list by expertise. */
  groupOfProduct: Record<string, string | null>;
  leadOwnerName: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(assignLeadProduct, INITIAL);
  const [allState, allAction] = useActionState(assignAllLeadProducts, INITIAL);

  /*
    What each dropdown is showing.

    Held locally so the selection a person just made survives the round trip:
    the server action revalidates and the page re-renders, and a dropdown reading
    straight from props would snap back to its old value for the moment between
    the save landing and the refresh arriving. The product owner asked
    specifically that the chosen value stay visible after committing.
  */
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(leadProducts.map((row) => [row.productCode, row.owner?.id ?? ''])),
  );

  /*
    Products handed on in this sitting.

    The row stops being yours the moment the save lands, so its Save button is
    dead from that instant — before the refresh arrives and removes the row
    altogether. Without this there is a second or so in which the button still
    looks live and a second click would be refused by the API.
  */
  const [handedOn, setHandedOn] = useState<string[]>([]);

  useEffect(() => {
    if (state.status === 'success' || allState.status === 'success') router.refresh();
  }, [state, allState, router]);

  // Re-sync when the server sends a fresh list, so a failed save does not leave
  // the dropdown showing something that was never stored.
  useEffect(() => {
    setChoice(
      Object.fromEntries(leadProducts.map((row) => [row.productCode, row.owner?.id ?? ''])),
    );
  }, [leadProducts]);

  // Only what this person holds. Closed products are excluded for the same
  // reason the server excludes them: moving one would rewrite who closed it.
  const mine = leadProducts.filter(
    (row) => assignableCodes.includes(row.productCode) && row.isOpen,
  );

  if (leadProducts.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No products on this lead yet. Add what they are interested in, and each one can then be
        given its own owner.
      </p>
    );
  }

  if (mine.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        None of the open products on this lead are being worked by you, so there is nothing here for
        you to hand on. Whoever holds a product can pass it on themselves.
      </p>
    );
  }

  /*
    People who sell this product's group first, everybody else after.

    A hard filter was the other option and would have been wrong: expertise is
    empty for most of the directory, so filtering would leave dropdowns that
    cannot assign to anyone. Leading with the people who fit gets the same
    result when the data is there without breaking the screen when it is not.
  */
  const optionsFor = (productCode: string) => {
    const group = groupOfProduct[productCode];
    if (!group) return { matching: [] as AssignableOption[], others: assignable };

    const matching = assignable.filter((person) => person.productGroups.includes(group));
    const others = assignable.filter((person) => !person.productGroups.includes(group));
    return { matching, others };
  };

  const describe = (person: AssignableOption) =>
    [person.fullName, [person.designation, person.branch].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' — ');

  const message = state.message ?? allState.message;
  const failed = state.status === 'error' || allState.status === 'error';

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role={failed ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 text-sm ${
            failed
              ? 'border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
              : 'border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
          }`}
        >
          {message}
        </p>
      ) : null}

      {/*
        The shortcut, above the table rather than inside it.

        Handing a whole lead over otherwise costs as many saves as the client
        has products, which is where people stop bothering and the ownership
        data stops being true. Open products only — moving a converted or lost
        one would rewrite who closed it.
      */}
      <form
        action={allAction}
        onSubmit={(event) => {
          const picked = new FormData(event.currentTarget).get('ownerId');
          const to = assignable.find((person) => person.id === picked);
          const only = mine.length === 1 ? mine[0] : undefined;
          const what = only
            ? `this lead for ${only.productName ?? only.productCode}`
            : `this lead for ${mine.length} products`;
          if (
            !window.confirm(
              `The ownership of ${what} will be transferred to ${to?.fullName ?? 'the selected person'}. Are you sure?`,
            )
          ) {
            event.preventDefault();
          }
        }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
      >
        <input type="hidden" name="leadId" value={leadId} />
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="assign-all">
            Assign my open products to
          </label>
          <select id="assign-all" name="ownerId" className="input" defaultValue="" required>
            <option value="" disabled>
              Choose somebody
            </option>
            {assignable.map((person) => (
              <option key={person.id} value={person.id}>
                {describe(person)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton label="Assign all" />
      </form>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th
                scope="col"
                className="px-2 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Product
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Status
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Owner
              </th>
            </tr>
          </thead>
          <tbody>
            {mine.map((row) => {
              const { matching, others } = optionsFor(row.productCode);
              const name = row.productName ?? row.productCode;
              const done = handedOn.includes(row.productCode);

              return (
                <tr
                  key={row.productCode}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-2 py-2.5 align-middle font-semibold">{name}</td>
                  <td className="px-2 py-2.5 align-middle">
                    <Badge tone="navy">{humanise(row.status)}</Badge>
                  </td>
                  <td className="px-2 py-2.5 align-middle">
                    {/*
                      `sm:flex-nowrap` so owner and Save stay on the product's
                      own line on a desktop. Wrapping is kept for narrow
                      screens, where forcing one line would push the button off
                      the edge instead.
                    */}
                    <form
                      action={action}
                      onSubmit={(event) => {
                        const picked = new FormData(event.currentTarget).get('ownerId');
                        const to = assignable.find((person) => person.id === picked);
                        // Handing it back to the lead owner is the empty option,
                        // and is worth confirming in the same words.
                        const whom = to?.fullName ?? `${leadOwnerName} (lead owner)`;
                        if (
                          !window.confirm(
                            `The ownership of this lead for ${name} will be transferred to ${whom}. Are you sure?`,
                          )
                        ) {
                          event.preventDefault();
                          return;
                        }
                        setHandedOn((current) => [...current, row.productCode]);
                      }}
                      className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
                    >
                      <input type="hidden" name="leadId" value={leadId} />
                      <input type="hidden" name="productCode" value={row.productCode} />
                      <select
                        name="ownerId"
                        className="input h-9 min-w-56 py-0"
                        value={choice[row.productCode] ?? ''}
                        disabled={done}
                        onChange={(event) =>
                          setChoice((current) => ({
                            ...current,
                            [row.productCode]: event.target.value,
                          }))
                        }
                        aria-label={`Owner for ${name}`}
                      >
                        {/* Empty hands it back, so the lead's own owner answers
                            for it again. A misassignment has to be undoable. */}
                        <option value="">{leadOwnerName} (lead owner)</option>
                        {matching.length > 0 ? (
                          <optgroup label="Sells this">
                            {matching.map((person) => (
                              <option key={person.id} value={person.id}>
                                {describe(person)}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {others.length > 0 ? (
                          <optgroup label={matching.length > 0 ? 'Everyone else' : 'Anyone'}>
                            {others.map((person) => (
                              <option key={person.id} value={person.id}>
                                {describe(person)}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                      <SubmitButton label={done ? 'Transferred' : 'Save'} compact disabled={done} />
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubmitButton({
  label,
  compact = false,
  disabled = false,
}: {
  label: string;
  compact?: boolean;
  /** Already handed on in this sitting, so there is nothing left to save. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`btn btn-outline shrink-0 disabled:opacity-60 ${compact ? 'h-9 text-xs' : ''}`}
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
