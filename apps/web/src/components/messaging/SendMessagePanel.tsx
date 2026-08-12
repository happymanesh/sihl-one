'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { extractVariables, renderTemplate } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { sendMessage, type MessagingState } from '@/app/actions/messaging';
import { humanise } from '@/lib/format';

const INITIAL: MessagingState = { status: 'idle' };

interface Template {
  code: string;
  name: string;
  channel: string;
  purpose: string;
  body: string;
}

/**
 * Sending a templated message from a lead.
 *
 * Shows the rendered text before it goes. A rep who cannot see what will
 * actually arrive is guessing, and the first time they find out a variable was
 * wrong is when the client reads it.
 */
export function SendMessagePanel({
  leadId,
  templates,
}: {
  leadId: string;
  templates: Template[];
}) {
  const [state, action] = useActionState(sendMessage, INITIAL);
  const [code, setCode] = useState(templates[0]?.code ?? '');
  const [values, setValues] = useState<Record<string, string>>({});

  const template = templates.find((entry) => entry.code === code);
  const variables = template ? extractVariables(template.body).filter((v) => v !== 'name') : [];

  // `name` is filled server-side from the record, so the preview shows it as a
  // placeholder rather than pretending the rep has to supply it.
  const preview = template
    ? renderTemplate(template.body, { ...values, name: '(their name)' }).text
    : '';

  if (state.status === 'success') {
    return (
      <div
        className={`rounded-lg border px-3 py-3 text-sm ${
          state.suppressedReason
            ? 'border-warn-500/40 bg-warn-50 text-warn-600 dark:bg-warn-500/10'
            : 'border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
        }`}
        role="status"
      >
        <p className="font-semibold">{state.message}</p>
        {state.suppressedReason ? (
          <>
            <p className="mt-1">{state.suppressedReason}</p>
            {/* Not a failure. The gate working is the feature. */}
            <p className="mt-2 text-xs">
              This is recorded against the lead, so there is a record that it was attempted and
              why it was held back.
            </p>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="templateCode">
          Template
        </label>
        <select
          id="templateCode"
          name="templateCode"
          className="input"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setValues({});
          }}
        >
          {templates.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name} — {humanise(entry.channel)}
            </option>
          ))}
        </select>
      </div>

      {template ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{humanise(template.channel)}</Badge>
            <Badge
              tone={
                template.purpose === 'PROMOTIONAL'
                  ? 'amber'
                  : template.purpose === 'TRANSACTIONAL'
                    ? 'red'
                    : 'navy'
              }
            >
              {humanise(template.purpose)}
            </Badge>
            {template.purpose === 'PROMOTIONAL' ? (
              <span className="text-xs text-[var(--color-text-muted)]">
                Held back without marketing consent, or outside 9am–9pm.
              </span>
            ) : null}
          </div>

          {variables.map((variable) => (
            <div key={variable}>
              <label className="label" htmlFor={`var-${variable}`}>
                {humanise(variable)}
              </label>
              <input
                id={`var-${variable}`}
                name={`var:${variable}`}
                required
                maxLength={500}
                className="input h-9"
                value={values[variable] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [variable]: event.target.value }))
                }
              />
            </div>
          ))}

          <div>
            <p className="label">What they will receive</p>
            <p className="whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
              {preview}
            </p>
          </div>
        </>
      ) : null}

      <Submit />

      <p className="text-xs text-[var(--color-text-subtle)]">
        No provider is connected yet, so this is recorded rather than delivered. The consent,
        DND and quiet-hours checks run either way.
      </p>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Sending…' : 'Send'}
    </button>
  );
}
