'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/shell/Icon';

/**
 * Export, with a second shape behind an arrow.
 *
 * A split button rather than two: one of these is what almost everybody wants
 * almost every time, and putting them side by side would make the reader choose
 * between two things they have to read first. The main half does the ordinary
 * export; the arrow is for the month-end job.
 *
 * Both halves are plain links carrying `download`, so the file streams from the
 * proxy exactly as it did before. Nothing is fetched into the page — a lead
 * export can be twenty thousand rows, and holding that in a blob to hand it
 * back to the browser buys nothing.
 */
export function ExportMenu({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const href = (layout: 'lead' | 'product') =>
    `/api/leads/export${query}${query ? '&' : '?'}layout=${layout}`;

  /*
    Close on a click anywhere else, and on Escape.

    Without this the menu stays open behind whatever the person does next,
    which on a list page means it hangs over the rows they were trying to read.
  */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative inline-flex">
      {/* The two halves read as one control: the divider is a border, and only
          the outer corners are rounded. */}
      <a
        href={href('lead')}
        className="btn btn-outline rounded-r-none border-r-0"
        download
        onClick={() => setOpen(false)}
      >
        <Icon name="file" size={16} />
        Export CSV
      </a>
      <button
        type="button"
        className="btn btn-outline rounded-l-none px-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose an export format"
        onClick={() => setOpen((showing) => !showing)}
      >
        <Icon name="chevron-down" size={16} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        >
          <a
            href={href('lead')}
            download
            role="menuitem"
            className="block px-3 py-2.5 hover:bg-[var(--color-surface-muted)]"
            onClick={() => setOpen(false)}
          >
            <span className="block text-sm font-semibold">One row per lead</span>
            <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
              Products listed together in one column.
            </span>
          </a>
          <a
            href={href('product')}
            download
            role="menuitem"
            className="block border-t border-[var(--color-border)] px-3 py-2.5 hover:bg-[var(--color-surface-muted)]"
            onClick={() => setOpen(false)}
          >
            <span className="block text-sm font-semibold">One row per product</span>
            <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
              A lead wanting Equity and MTF appears twice, once for each — ready to count and pivot.
            </span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
