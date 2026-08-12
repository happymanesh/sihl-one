'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { PRIORITIES, type LeadSourceItem, type ProductItem } from '@sihl-one/contracts';

import { createLead, type ActionState } from '@/app/actions/leads';
import { humanise } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Creating…' : 'Create lead'}
    </button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p className="mt-1 text-xs font-medium text-danger-500" role="alert">
      {errors[0]}
    </p>
  );
}

export function NewLeadForm({
  sources,
  products,
  assignableUsers,
  canAssign,
}: {
  /** From the master, so a source added this morning appears this afternoon. */
  sources: LeadSourceItem[];
  products: ProductItem[];
  assignableUsers: Array<{ id: string; fullName: string; orgUnit: string | null }>;
  canAssign: boolean;
}) {
  const [state, action] = useActionState(createLead, INITIAL);

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.status === 'error' && state.message ? (
        <div
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15"
          role="alert"
        >
          {state.message}
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Who is it?</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="firstName">
              First name <span className="text-danger-500">*</span>
            </label>
            <input
              id="firstName"
              name="firstName"
              className="input"
              required
              autoFocus
              aria-invalid={Boolean(state.errors?.firstName)}
            />
            <FieldError errors={state.errors?.firstName} />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" className="input" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="mobile">
              Mobile <span className="text-danger-500">*</span>
            </label>
            <input
              id="mobile"
              name="mobile"
              className="input"
              required
              inputMode="numeric"
              maxLength={13}
              placeholder="10-digit mobile"
              aria-invalid={Boolean(state.errors?.mobile)}
            />
            <FieldError errors={state.errors?.mobile} />
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              One open lead per mobile number — a duplicate will be rejected.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="input" aria-invalid={Boolean(state.errors?.email)} />
            <FieldError errors={state.errors?.email} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="pan">PAN</label>
            <input id="pan" name="pan" className="input font-mono uppercase" maxLength={10} placeholder="ABCDE1234F" />
            <FieldError errors={state.errors?.pan} />
          </div>
          <div>
            <label className="label" htmlFor="city">City</label>
            <input id="city" name="city" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <input id="state" name="state" className="input" defaultValue="Gujarat" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Where did they come from?</legend>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="source">
              Source <span className="text-danger-500">*</span>
            </label>
            <select id="source" name="source" className="input" required defaultValue="INBOUND_CALL">
              {sources.map((source) => (
                <option key={source.code} value={source.code}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="input" defaultValue="MEDIUM">
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{humanise(priority)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="estimatedValue">Estimated value (₹)</label>
            <input id="estimatedValue" name="estimatedValue" type="number" min={0} step={1000} className="input" />
          </div>
        </div>

        {canAssign && assignableUsers.length > 0 ? (
          <div>
            <label className="label" htmlFor="ownerId">Assign to</label>
            <select id="ownerId" name="ownerId" className="input" defaultValue="">
              <option value="">Assign to me</option>
              {assignableUsers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                  {person.orgUnit ? ` — ${person.orgUnit}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-bold">What are they interested in?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {products.map((product) => (
            <label
              key={product.code}
              title={product.summary ?? undefined}
              className="cursor-pointer rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold transition-colors has-[:checked]:border-navy-500 has-[:checked]:bg-navy-500 has-[:checked]:text-white"
            >
              <input
                type="checkbox"
                name="productInterest"
                value={product.code}
                className="sr-only"
              />
              {product.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="notes">Opening note</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="input resize-none"
          placeholder="What did they ask for? Anything the next person needs to know?"
        />
      </div>

      <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
        <SubmitButton />
        <a href="/leads" className="btn btn-outline">Cancel</a>
      </div>
    </form>
  );
}
