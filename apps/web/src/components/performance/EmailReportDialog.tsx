'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { sendPerformanceReport, type ActionState } from '@/app/actions/performance';

const INITIAL: ActionState = { status: 'idle' };

/** Where the last CC list is remembered, per browser. */
const CC_KEY = 'sihl.performance.lastCc';

/**
 * The report, as it will arrive, before it goes anywhere.
 *
 * Asked for explicitly, and right: this mails a judgement of people's work to
 * those people. Sending it is not something to discover you have done — the
 * preview is the moment to notice the wrong team is selected, or that a bad
 * month is about to land in sixteen inboxes without a covering word.
 *
 * What is previewed is what is sent. The body goes to the server as text
 * rather than being rebuilt there from the same query, so there is no way for
 * the message to differ from the one that was approved.
 */
export function EmailReportDialog({
  subject,
  body,
  recipients,
}: {
  subject: string;
  body: string;
  /** The people in the report. Pre-filled, and editable before sending. */
  recipients: Array<{ fullName: string; email: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(sendPerformanceReport, INITIAL);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');

  useEffect(() => {
    setTo(recipients.map((person) => person.email).join(', '));
  }, [recipients]);

  /*
    The CC list is remembered, the To list never is.

    "Blank or last used" was the request, and the asymmetry is the point: who
    the report is about changes every time, while who is copied — a head, an
    analyst — tends not to. Browser-local, because it is a convenience for one
    person at one desk and not a setting anybody should have to administer.
  */
  useEffect(() => {
    if (!open) return;
    try {
      setCc(window.localStorage.getItem(CC_KEY) ?? '');
    } catch {
      // Private browsing, or storage blocked. A remembered convenience is not
      // worth failing the dialog over.
    }
  }, [open]);

  useEffect(() => {
    if (state.status !== 'success') return;
    try {
      window.localStorage.setItem(CC_KEY, cc);
    } catch {
      /* As above. */
    }
    setOpen(false);
  }, [state, cc]);

  if (recipients.length === 0) return null;

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Send email
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-navy-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-report-title"
        >
          <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-5">
            <h2 id="send-report-title" className="text-base font-bold">
              Send this report
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              This is exactly what will be sent. Check who is on it before sending.
            </p>

            {state.status === 'error' && state.message ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
              >
                {state.message}
              </p>
            ) : null}

            <form action={action} className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
              <input type="hidden" name="subject" value={subject} />
              <input type="hidden" name="body" value={body} />

              <div>
                <label className="label" htmlFor="send-to">
                  To <span className="text-danger-500">*</span>
                </label>
                <textarea
                  id="send-to"
                  name="to"
                  rows={2}
                  className="input resize-none text-sm"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                  {recipients.length} {recipients.length === 1 ? 'person' : 'people'} in this
                  report. Separate addresses with commas.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="send-cc">
                  Cc
                </label>
                <input
                  id="send-cc"
                  name="cc"
                  className="input text-sm"
                  value={cc}
                  onChange={(event) => setCc(event.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="min-h-0 flex-1">
                <span className="label">Preview</span>
                {/* Read-only on purpose: the body is generated, and an edited
                    copy would no longer match the report it claims to be. */}
                <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs leading-5 whitespace-pre-wrap">
                  {`Subject: ${subject}\n\n${body}`}
                </pre>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                  Close
                </button>
                <SendButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-60">
      {pending ? 'Sending…' : 'Send'}
    </button>
  );
}
