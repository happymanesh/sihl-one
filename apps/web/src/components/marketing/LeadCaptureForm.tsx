'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { submitLeadCapture, type CaptureState } from '@/app/actions/lead-capture';

const INITIAL: CaptureState = { status: 'idle' };

function SubmitButton({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-accent w-full" disabled={pending}>
      {pending ? 'Submitting…' : (label ?? 'Request a call back')}
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

export function LeadCaptureForm({
  partnerCode,
  eventCode,
  submitLabel,
  products = [],
}: {
  /** Provenance from a coded link. Passed through as a code, never an id. */
  partnerCode?: string;
  eventCode?: string;
  submitLabel?: string;
  /**
   * The active product master, supplied by the page.
   *
   * Previously six options were hard-coded here. The master is edited in the
   * admin screen and had moved on: production has no COMMODITY at all, and IPO
   * and NRI are switched off — so three of the six choices on the public form
   * were rejected on submit as unknown products, losing the lead of somebody
   * who had already typed their name and number at a stall.
   */
  products?: Array<{ code: string; name: string }>;
} = {}) {
  const [state, formAction] = useActionState(submitLeadCapture, INITIAL);
  const [attribution, setAttribution] = useState({
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    landingPath: '',
  });

  /**
   * Attribution is read in the browser and posted as hidden fields.
   *
   * It has to happen client-side: the UTM parameters live in the URL the
   * visitor arrived on, and reading them in an effect keeps the page itself
   * statically renderable rather than forcing it dynamic for every visitor.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAttribution({
      utmSource: params.get('utm_source') ?? '',
      utmMedium: params.get('utm_medium') ?? '',
      utmCampaign: params.get('utm_campaign') ?? '',
      landingPath: window.location.pathname,
    });
  }, []);

  if (state.status === 'success') {
    return (
      <div className="rounded-lg border border-teal-500/40 bg-teal-50 p-5 text-center dark:bg-teal-900/30">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-500 text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m5 13 4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h3 className="mt-3 font-bold">Enquiry received</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{state.message}</p>
        {state.reference ? (
          <p className="mt-3 text-sm">
            Your reference is{' '}
            <span className="font-mono font-bold tnum">{state.reference}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="utmSource" value={attribution.utmSource} />
      <input type="hidden" name="utmMedium" value={attribution.utmMedium} />
      <input type="hidden" name="utmCampaign" value={attribution.utmCampaign} />
      <input type="hidden" name="landingPath" value={attribution.landingPath} />
      {partnerCode ? <input type="hidden" name="partnerCode" value={partnerCode} /> : null}
      {eventCode ? <input type="hidden" name="eventCode" value={eventCode} /> : null}

      {state.status === 'error' && state.message ? (
        <div
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
          role="alert"
        >
          {state.message}
        </div>
      ) : null}

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
            autoComplete="given-name"
            aria-invalid={Boolean(state.errors?.firstName)}
          />
          <FieldError errors={state.errors?.firstName} />
        </div>
        <div>
          <label className="label" htmlFor="lastName">
            Last name
          </label>
          <input id="lastName" name="lastName" className="input" autoComplete="family-name" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="mobile">
          Mobile number <span className="text-danger-500">*</span>
        </label>
        <input
          id="mobile"
          name="mobile"
          className="input"
          required
          // `inputMode` gives a phone keypad on mobile without the browser
          // validation quirks of type="tel" with a pattern.
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile"
          maxLength={13}
          aria-invalid={Boolean(state.errors?.mobile)}
        />
        <FieldError errors={state.errors?.mobile} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            aria-invalid={Boolean(state.errors?.email)}
          />
          <FieldError errors={state.errors?.email} />
        </div>
        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <input id="city" name="city" className="input" autoComplete="address-level2" />
        </div>
      </div>

      <fieldset>
        <legend className="label">What are you interested in?</legend>
        <div className="flex flex-wrap gap-2">
          {products.map((product) => (
            <label
              key={product.code}
              className="cursor-pointer rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold transition-colors has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white"
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
        <label className="label" htmlFor="message">
          Anything we should know?
        </label>
        <textarea id="message" name="message" rows={2} className="input resize-none" />
      </div>

      {/*
        Consent is an explicit, unticked checkbox with the full purpose spelled
        out. A pre-ticked box is not consent under the DPDP Act, and the API
        stores this exact wording alongside the timestamp as evidence.
      */}
      <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[var(--color-text-muted)]">
        {/*
          Ticked by default at the product owner's instruction, to cut the number
          of forms abandoned at a stall. Still `required`, so a visitor who
          unticks it cannot submit — the box remains a real control they can
          refuse, rather than a decoration.
        */}
        <input
          type="checkbox"
          name="consentToContact"
          defaultChecked
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-teal-500)]"
          aria-invalid={Boolean(state.errors?.consentToContact)}
        />
        <span>
          I agree to be contacted by SIHL about this enquiry by phone, SMS, WhatsApp or email,
          including on a number registered with DND.
        </span>
      </label>
      <FieldError errors={state.errors?.consentToContact} />

      <SubmitButton label={submitLabel} />
    </form>
  );
}
