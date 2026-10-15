'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PRIORITIES, type LeadSourceItem, type ProductItem } from '@sihl-one/contracts';

import { DuplicateMobileNotice } from '@/components/leads/DuplicateMobileNotice';
import { ProductPicker } from '@/components/leads/ProductPicker';
import { LeadProfileFields } from '@/components/leads/LeadProfileFields';
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

/**
 * PAN, hidden behind a disclosure rather than shown as an empty optional field.
 *
 * A visible input is itself a prompt: reps were asking clients for PAN at first
 * contact simply because the box was there. Marking it optional does not fix
 * that — it says the field may be skipped, not that the question should not be
 * asked. Removing it from first sight does, and the guidance appears only for
 * whoever deliberately went looking.
 *
 * Opens automatically if the server rejected the value, so a validation error is
 * never hidden inside a collapsed section.
 */
function PanField({
  errors,
  value,
  onChange,
}: {
  errors?: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Also opened by a value that survived a refused save: a PAN the rep typed
  // must not be hidden behind "+ Add PAN" when the form comes back.
  const shown = open || Boolean(errors?.length) || value.length > 0;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 text-sm font-semibold text-teal-600 hover:underline dark:text-teal-300"
      >
        + Add PAN (optional)
      </button>
    );
  }

  return (
    <>
      <label className="label" htmlFor="pan">PAN</label>
      <input
        id="pan"
        name="pan"
        className="input font-mono uppercase"
        maxLength={10}
        placeholder="ABCDE1234F"
        autoFocus={open}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby="pan-guidance"
        aria-invalid={Boolean(errors?.length)}
      />
      <p id="pan-guidance" className="mt-1 text-xs text-[var(--color-text-muted)]">
        Only if the client offers it. PAN is collected properly at account opening.
      </p>
      <FieldError errors={errors} />
    </>
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
  const [pickedProducts, setPickedProducts] = useState<string[]>([]);

  /*
    Everything typed, held here.

    A form action resets uncontrolled inputs once it returns, so a refused
    save — a duplicate mobile, a bad PAN, anything the server rejects — handed
    back an empty form and the whole lead had to be retyped to fix one field.
    The same fault the user form had, and the same fix.

    One object rather than a dozen `useState` calls: every field here is the
    same kind of thing, and a dozen setters is a dozen chances to wire one to
    the wrong input.
  */
  const [values, setValues] = useState({
    firstName: '',
    lastName: '',
    mobile: '',
    email: '',
    pan: '',
    city: '',
    state: 'Gujarat',
    source: 'INBOUND_CALL',
    priority: 'MEDIUM',
    estimatedValue: '',
    ownerId: '',
    notes: '',
  });
  const set = (field: keyof typeof values) => (next: string) =>
    setValues((current) => ({ ...current, [field]: next }));
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (event: { target: { value: string } }) => set(field)(event.target.value),
  });

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
              {...bind('firstName')}
              aria-invalid={Boolean(state.errors?.firstName)}
            />
            <FieldError errors={state.errors?.firstName} />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" className="input" {...bind('lastName')} />
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
              {...bind('mobile')}
              aria-invalid={Boolean(state.errors?.mobile)}
            />
            <FieldError errors={state.errors?.mobile} />
            <DuplicateMobileNotice
              productLabels={Object.fromEntries(products.map((p) => [p.code, p.name]))}
            />
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              One open lead per mobile number — a duplicate will be rejected.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="input" {...bind('email')} aria-invalid={Boolean(state.errors?.email)} />
            <FieldError errors={state.errors?.email} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <PanField errors={state.errors?.pan} value={values.pan} onChange={set('pan')} />
          </div>
          <div>
            <label className="label" htmlFor="city">City</label>
            <input id="city" name="city" className="input" {...bind('city')} />
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <input id="state" name="state" className="input" {...bind('state')} />
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
            <select id="source" name="source" className="input" required {...bind('source')} aria-invalid={Boolean(state.errors?.source)}>
              {sources.map((source) => (
                <option key={source.code} value={source.code}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="input" {...bind('priority')}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{humanise(priority)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="estimatedValue">Estimated value (₹)</label>
            <input id="estimatedValue" name="estimatedValue" type="number" min={0} step={1000} className="input" {...bind('estimatedValue')} />
          </div>
        </div>

        {canAssign && assignableUsers.length > 0 ? (
          <div>
            <label className="label" htmlFor="ownerId">Assign to</label>
            <select id="ownerId" name="ownerId" className="input" {...bind('ownerId')}>
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
        {/* The same picker the interaction form uses. Sub-products sit under
            their parent rather than beside it, so a rep does not meet the same
            fourteen products laid out two different ways within a minute. */}
        <div className="mt-2">
          <ProductPicker
            products={products}
            name="productInterest"
            selected={pickedProducts}
            onToggle={(code) =>
              setPickedProducts((current) =>
                current.includes(code)
                  ? current.filter((value) => value !== code)
                  : [...current, code],
              )
            }
            tone="navy"
          />
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
          {...bind('notes')}
        />
      </div>

      <LeadProfileFields />

      <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
        <SubmitButton />
        <a href="/leads" className="btn btn-outline">Cancel</a>
      </div>
    </form>
  );
}
