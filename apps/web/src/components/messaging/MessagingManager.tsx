'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  extractVariables,
  MESSAGE_CHANNELS,
  MESSAGE_PURPOSES,
  smsSegments,
  type MessageLogItem,
} from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { createTemplate, updateTemplate, type MessagingState } from '@/app/actions/messaging';
import { formatRelative, humanise } from '@/lib/format';

const INITIAL: MessagingState = { status: 'idle' };

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  channel: string;
  purpose: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

const PURPOSE_TONES: Record<string, 'red' | 'navy' | 'amber'> = {
  TRANSACTIONAL: 'red',
  SERVICE: 'navy',
  PROMOTIONAL: 'amber',
};

/** What each purpose actually costs you in restrictions. */
const PURPOSE_RULES: Record<string, string> = {
  TRANSACTIONAL: 'Ignores DND and quiet hours. Only for messages a client needs regardless.',
  SERVICE: 'Clients only. Respects quiet hours, ignores DND.',
  PROMOTIONAL: 'Needs marketing consent. Respects DND and quiet hours.',
};

export function MessagingManager({
  templates,
  log,
  canCreate,
}: {
  templates: TemplateRow[];
  log: MessageLogItem[];
  canCreate: boolean;
}) {
  const [tab, setTab] = useState<'templates' | 'log'>('templates');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ['templates', `Templates (${templates.length})`],
            ['log', `Sent (${log.length})`],
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

      {tab === 'templates' ? (
        <TemplatesTab templates={templates} canCreate={canCreate} />
      ) : (
        <LogTab log={log} />
      )}
    </div>
  );
}

function TemplatesTab({
  templates,
  canCreate,
}: {
  templates: TemplateRow[];
  canCreate: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="card p-0">
        {templates.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-text-muted)]">
            No templates yet. Write one below and it becomes available to send from a lead.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {templates.map((template) => (
              <TemplateRowItem key={template.id} template={template} />
            ))}
          </ul>
        )}
      </section>

      {canCreate ? <NewTemplateForm /> : null}
    </div>
  );
}

function TemplateRowItem({ template }: { template: TemplateRow }) {
  const [state, action] = useActionState(updateTemplate, INITIAL);
  const variables = extractVariables(template.body);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{template.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">
              {template.code}
            </span>
            <Badge tone="neutral">{humanise(template.channel)}</Badge>
            <Badge tone={PURPOSE_TONES[template.purpose] ?? 'neutral'}>
              {humanise(template.purpose)}
            </Badge>
            {!template.isActive ? <Badge tone="amber">Off</Badge> : null}
          </div>

          <p className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--color-text-muted)]">
            {template.body}
          </p>

          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            {variables.length > 0 ? `Needs: ${variables.join(', ')}` : 'No variables'}
            {template.channel === 'SMS'
              ? ` · ${smsSegments(template.body)} SMS ${smsSegments(template.body) === 1 ? 'segment' : 'segments'}`
              : ''}
          </p>
        </div>

        <form action={action} className="shrink-0">
          <input type="hidden" name="id" value={template.id} />
          <input type="hidden" name="isActive" value={String(!template.isActive)} />
          <ToggleButton on={template.isActive} />
        </form>
      </div>

      <Feedback state={state} />
    </li>
  );
}

function NewTemplateForm() {
  const [state, action] = useActionState(createTemplate, INITIAL);
  const [channel, setChannel] = useState<string>('SMS');
  const [purpose, setPurpose] = useState<string>('SERVICE');
  const [body, setBody] = useState('');

  const variables = extractVariables(body);

  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="font-bold">New template</h2>
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" hint="Permanent, uppercase.">
          <input name="code" required maxLength={40} className="input font-mono" />
        </Field>
        <Field label="Name">
          <input name="name" required maxLength={120} className="input" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Channel">
          <select
            name="channel"
            className="input"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            {MESSAGE_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purpose" hint={PURPOSE_RULES[purpose]}>
          <select
            name="purpose"
            className="input"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          >
            {MESSAGE_PURPOSES.map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Stated at the point of choosing, because it cannot be changed later —
          the purpose is what decides whether DND and quiet hours apply. */}
      <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/10">
        The purpose cannot be changed after this is created. Marking a promotion as
        transactional to reach more people is the specific thing TRAI penalises.
      </p>

      {channel === 'EMAIL' ? (
        <Field label="Subject">
          <input name="subject" required maxLength={200} className="input" />
        </Field>
      ) : null}

      {channel === 'WHATSAPP' ? (
        <Field
          label="Meta template id"
          hint="WhatsApp will reject a business-initiated message without an approved template."
        >
          <input name="providerTemplateId" maxLength={120} className="input font-mono" />
        </Field>
      ) : null}

      <Field
        label="Body"
        hint={
          variables.length > 0
            ? `Variables: ${variables.join(', ')}. {{name}} is always available.`
            : 'Use {{variable}} for anything that changes. {{name}} is always available.'
        }
      >
        <textarea
          name="body"
          required
          rows={4}
          maxLength={4000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Dear {{name}}, your account {{clientCode}} is now active."
          className="input resize-none"
        />
      </Field>

      {channel === 'SMS' && body.length > 0 ? (
        <p className="text-xs text-[var(--color-text-subtle)]">
          {body.length} characters · {smsSegments(body)}{' '}
          {smsSegments(body) === 1 ? 'segment' : 'segments'} — each segment is billed separately.
        </p>
      ) : null}

      <Submit label="Create template" pendingLabel="Creating…" />
    </form>
  );
}

function LogTab({ log }: { log: MessageLogItem[] }) {
  if (log.length === 0) {
    return (
      <section className="card p-5">
        <p className="text-sm text-[var(--color-text-muted)]">Nothing sent yet.</p>
      </section>
    );
  }

  return (
    <section className="card p-0">
      <ul className="divide-y divide-[var(--color-border)]">
        {log.map((entry) => {
          const suppressed = entry.status === 'SUPPRESSED';
          return (
            <li
              key={entry.id}
              className={`px-4 py-3 ${suppressed ? 'border-l-[3px] border-warn-500' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={suppressed ? 'amber' : entry.status === 'FAILED' ? 'red' : 'green'}>
                  {humanise(entry.status)}
                </Badge>
                <span className="font-mono text-xs">{entry.templateCode}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {humanise(entry.channel)} · {humanise(entry.purpose)}
                </span>
                <span className="ml-auto text-xs text-[var(--color-text-subtle)]">
                  {formatRelative(entry.createdAt)}
                </span>
              </div>

              <p className="mt-1.5 text-sm">{entry.body}</p>

              {/* The reason is the point of logging a refusal at all. */}
              {entry.failureReason ? (
                <p className="mt-1 text-xs text-warn-600">{entry.failureReason}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
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

function Feedback({ state }: { state: MessagingState }) {
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
      {state.suppressedReason ? ` ${state.suppressedReason}` : ''}
    </p>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
