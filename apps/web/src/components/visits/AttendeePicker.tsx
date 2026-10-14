'use client';

import { useEffect, useRef } from 'react';

/**
 * Who else is coming, as a dropdown of checkboxes.
 *
 * A native `<select multiple>` was the obvious choice and the wrong one, for
 * the reason it is wrong everywhere else in this product: adding a second
 * person needs ctrl-click, and *removing* one needs ctrl-clicking the name
 * that is already highlighted — which nobody finds. A colleague added by
 * mistake could not be taken off again, and on a phone the control is close to
 * unusable. This form is filled in between meetings, often on a phone.
 *
 * `<details>` gives open, close, keyboard and focus behaviour from the
 * platform, with no library and no focus trap to get wrong — the same choice
 * `MultiSelectFilter` made. That component is not reused here because it holds
 * a draft and commits on Apply, which earns its keep when applying means
 * reloading a board and is pure ceremony inside a form.
 *
 * So ticking applies immediately, and the trigger says what is ticked.
 */
export function AttendeePicker({
  colleagues,
  selected,
  onChange,
}: {
  colleagues: Array<{
    id: string;
    fullName: string;
    employeeCode?: string | null;
    orgUnit?: string | null;
  }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);

  // Close on Escape and on a click outside, which a bare <details> does not do.
  // Registered once; everything the handlers need is on the node itself.
  useEffect(() => {
    const node = details.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && node.open) {
        event.preventDefault();
        node.open = false;
        node.querySelector('summary')?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (node.open && !node.contains(event.target as Node)) node.open = false;
    };

    node.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  /*
    Name, code, then branch.

    The code tells two people of the same name apart; the branch says which of
    them you actually mean without having to know the codes. Asked for after
    the picker shipped with the code alone, which answers "are these two people
    different" but not "which one is mine".
  */
  const label = (person: {
    fullName: string;
    employeeCode?: string | null;
    orgUnit?: string | null;
  }) =>
    [`${person.fullName}${person.employeeCode ? ` [${person.employeeCode}]` : ''}`, person.orgUnit]
      .filter(Boolean)
      .join(' — ');

  /*
    One name when one is picked, a count after that.

    "2 colleagues" rather than two names: the trigger is one line, and a list
    that truncates mid-name is worse than a number you can open to check.
  */
  const summary =
    selected.length === 0
      ? 'Choose colleagues'
      : selected.length === 1
        ? (() => {
            const only = colleagues.find((person) => person.id === selected[0]);
            return only ? label(only) : '1 colleague';
          })()
        : `${selected.length} colleagues`;

  return (
    <details ref={details} className="relative">
      <summary
        className={`flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border px-3 text-sm transition-colors ${
          selected.length
            ? 'border-teal-500 text-[var(--color-text)]'
            : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
        }`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-[0.625rem] opacity-70">
          ▾
        </span>
      </summary>

      <div
        className="absolute left-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        role="group"
        aria-label="Colleagues joining this visit"
      >
        {/* Only the names scroll, so Clear and the count stay put on a long
            list — a control that scrolls out of sight is one people conclude
            does not exist. */}
        <div className="max-h-56 overflow-y-auto p-1.5">
          {colleagues.map((person) => (
            <label
              key={person.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
            >
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={() => toggle(person.id)}
                className="h-3.5 w-3.5 accent-teal-600"
              />
              {/*
                The employee code in brackets is not decoration. Two people
                called Priya Shah is ordinary at this size, and picking the
                wrong one puts a colleague's name against a client meeting they
                never attended.
              */}
              <span className="truncate">{label(person)}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2.5 py-1.5">
          <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {selected.length === 0 ? 'Nobody selected' : `${selected.length} selected`}
          </span>
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}
