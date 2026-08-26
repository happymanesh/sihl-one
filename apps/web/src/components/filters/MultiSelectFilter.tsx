'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Multi-select as a disclosure with checkboxes, applied on submit.
 *
 * A native `<select multiple>` is the obvious choice and the wrong one: it needs
 * ctrl-click to select more than one, which most people never discover, and on a
 * phone it is close to unusable. `<details>` gives open/close and keyboard
 * support from the platform, with no library and no focus-trap code to get
 * wrong.
 *
 * Ticking a box used to apply the filter immediately. On a board of five
 * columns that meant choosing three products reloaded everything three times,
 * with the page shifting under the cursor between clicks — and the first two
 * loads were work nobody asked for, since the answer they wanted was the third.
 * The panel now holds a draft and commits it on Apply.
 *
 * The trigger keeps showing what is actually filtering, never the draft. A chip
 * reading "Products · 3" over a board filtered by one would be worse than the
 * reloading it replaced.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is selected, e.g. "All products". */
  allLabel: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState<string[]>(selected);

  // Keyed on content, never on the array itself.
  //
  // `selected` arrives from `searchParams.getAll()`, which builds a fresh array
  // on every render. An effect depending on that identity would fire every
  // render, setDraft would re-render, and the next render would hand it another
  // new array — an infinite loop, and one that would have looked like "the
  // filter does not work" rather than like a render bug.
  const selectedKey = selected.join('\n');

  // Held in a ref so the listeners below can read the current value without
  // being torn down and re-registered on every render.
  //
  // Written in an effect rather than during render: a render React throws
  // away would otherwise still have mutated the ref, which is the purity trap
  // the camera capture and the idle timeout both hit.
  const applied = useRef(selected);
  useEffect(() => {
    applied.current = selected;
  });

  // Resync whenever what is actually applied changes — after a commit, after
  // the bar's Clear, or on a back-button navigation. Without this the panel
  // would reopen still showing an abandoned draft.
  useEffect(() => {
    setDraft(selected);
    // Keyed on the joined contents, never the array itself — see selectedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const close = () => {
    if (details.current) details.current.open = false;
  };

  const discard = () => {
    setDraft(applied.current);
    close();
  };

  const commit = () => {
    onChange(draft);
    close();
  };

  // Closing the panel any other way — clicking the summary again, or clicking
  // away — abandons the draft rather than silently keeping it for next time.
  useEffect(() => {
    const node = details.current;
    if (!node) return;

    const onToggle = () => {
      if (!node.open) setDraft(applied.current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && node.open) {
        event.preventDefault();
        setDraft(applied.current);
        node.open = false;
        node.querySelector('summary')?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (node.open && !node.contains(event.target as Node)) {
        setDraft(applied.current);
        node.open = false;
      }
    };

    node.addEventListener('toggle', onToggle);
    node.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      node.removeEventListener('toggle', onToggle);
      node.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
    // Registered once. Everything they need comes from the ref above, so a new
    // `selected` array does not churn five listeners on every render.
  }, []);

  const toggle = (value: string) =>
    setDraft((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );

  // Compared as sets: the order boxes were ticked in is not a difference.
  const changed =
    draft.length !== selected.length || draft.some((value) => !selected.includes(value));

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0]!)
        : `${label} · ${selected.length}`;

  return (
    <details ref={details} className="relative">
      <summary
        className={`flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
          selected.length
            ? 'border-teal-500 bg-teal-500 text-white'
            : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
        }`}
        aria-label={`${label} filter`}
      >
        {summary}
        <span aria-hidden className="text-[0.625rem] opacity-70">▾</span>
      </summary>

      {/* Anchored to the left of the trigger, not the right.
          Right-aligning a fixed 15rem panel to a trigger that sits at the start
          of the filter bar hangs most of it off the left edge of the content,
          under the navigation — product names arrived as "odities" and "funds".
          A filter bar reads left to right, so the panel should grow the same
          way. The viewport clamp keeps it on screen on a phone, where the
          trigger can sit closer to the right than the panel is wide. */}
      <div
        className="absolute left-0 z-30 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        role="group"
        aria-label={label}
      >
        {/* Only the options scroll. The Apply button staying put is the whole
            point — a submit that scrolls out of sight is how people conclude
            there isn't one. */}
        <div className="max-h-64 overflow-y-auto p-1.5">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
            >
              <input
                type="checkbox"
                checked={draft.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="h-3.5 w-3.5 accent-teal-600"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}

          <p className="px-2 pb-1 pt-2 text-[0.6875rem] leading-4 text-[var(--color-text-subtle)]">
            Shows anything matching <strong>any</strong> of these.
          </p>
        </div>

        <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] p-1.5">
          <button
            type="button"
            onClick={commit}
            disabled={!changed}
            className="flex-1 rounded-lg bg-teal-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {changed ? 'Apply' : 'Applied'}
          </button>

          {draft.length > 0 ? (
            <button
              type="button"
              onClick={() => setDraft([])}
              className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            >
              Clear
            </button>
          ) : null}

          <button
            type="button"
            onClick={discard}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </details>
  );
}
