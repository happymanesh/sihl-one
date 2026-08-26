'use client';

import { useState } from 'react';
import { guessIdentifierKind } from '@sihl-one/contracts';

/**
 * The two things converting asks for beyond the product itself: the reference
 * the back office knows the client by, and what they actually put in.
 *
 * Shared because conversion is recorded from two places — the Products panel
 * and the foot of the interaction form — and they drifted apart once already:
 * the panel accepted a conversion with neither field, which read as won while
 * attached to nothing. One component, one set of names, one behaviour.
 *
 * The field names are the wire format. Both callers post them to
 * /leads/{id}/products/convert, so renaming anything here is an API change.
 */
export function ConversionFields({
  idPrefix,
  inputClassName = 'input',
  invalid = false,
}: {
  /** Keeps ids unique when both callers are on the page at once. */
  idPrefix: string;
  inputClassName?: string;
  invalid?: boolean;
}) {
  const [identifier, setIdentifier] = useState('');
  const [kindOverride, setKindOverride] = useState<'PAN' | 'CLIENT_CODE' | null>(null);

  // Guessed from what is typed until the rep overrides it, and the override
  // then sticks: retyping a character should not undo a deliberate choice.
  const identifierKind = kindOverride ?? guessIdentifierKind(identifier);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        {/* The kind sits on the label rather than under the field: it is one
            word plus a way to correct it, and a paragraph of explanation under
            every input pushed the two fields apart for no one's benefit. The
            button says what it does; which kind is in force is on aria-label
            for anyone who cannot see the field being read back. */}
        <div className="flex items-baseline justify-between gap-2">
          <label className="label" htmlFor={`${idPrefix}-identifier`}>
            PAN or client code <span className="text-danger-500">*</span>
          </label>
          <button
            type="button"
            className="text-xs font-semibold text-teal-700 underline underline-offset-2 dark:text-teal-300"
            onClick={() => setKindOverride(identifierKind === 'PAN' ? 'CLIENT_CODE' : 'PAN')}
            aria-label={`Recorded as ${
              identifierKind === 'PAN' ? 'a PAN' : 'a client code'
            }. Record it as ${identifierKind === 'PAN' ? 'a client code' : 'a PAN'} instead.`}
          >
            Use {identifierKind === 'PAN' ? 'client code' : 'PAN'}
          </button>
        </div>
        <input
          id={`${idPrefix}-identifier`}
          name="identifier"
          className={inputClassName}
          required
          autoCapitalize="characters"
          placeholder="ABCDE1234F or R0018"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          aria-invalid={invalid}
        />
        <input type="hidden" name="identifierKind" value={identifierKind} />
      </div>

      <div className="min-w-0">
        <label className="label" htmlFor={`${idPrefix}-finalAmount`}>
          Final amount
        </label>
        <input
          id={`${idPrefix}-finalAmount`}
          name="finalAmount"
          className={inputClassName}
          inputMode="decimal"
          placeholder="250000"
        />
      </div>
    </div>
  );
}
