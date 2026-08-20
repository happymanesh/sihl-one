'use client';

/**
 * Multi-select as a disclosure with checkboxes.
 *
 * A native `<select multiple>` is the obvious choice and the wrong one: it needs
 * ctrl-click to select more than one, which most people never discover, and on a
 * phone it is close to unusable. `<details>` gives open/close, keyboard support
 * and escape-to-close from the platform, with no library and no focus-trap code
 * to get wrong.
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
  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  };

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0]!)
        : `${label} · ${selected.length}`;

  return (
    <details className="relative">
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

      <div
        className="absolute right-0 z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-card"
        role="group"
        aria-label={label}
      >
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
          >
            Clear selection
          </button>
        ) : null}

        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
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
    </details>
  );
}
