'use client';

import { useState, type ReactNode } from 'react';

/**
 * A QR block that can start folded away.
 *
 * Which of the two QR codes matters depends entirely on who is looking. Somebody
 * running the event wants the stall's code — the one that goes on the banner.
 * A rep working the floor wants their own, because that is the one that puts
 * leads in their name, and having to scroll past a code they will never print
 * is friction at exactly the wrong moment.
 *
 * Both stay reachable either way. Collapsing is about what greets you, not about
 * taking anything away.
 */
export function CollapsibleQr({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  /** One line shown while folded, so the section is still identifiable. */
  summary: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card p-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block font-bold">{title}</span>
          {!open ? (
            <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">{summary}</span>
          ) : null}
        </span>
        <span
          aria-hidden
          className={`mt-1 shrink-0 text-[var(--color-text-muted)] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          ›
        </span>
      </button>

      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
