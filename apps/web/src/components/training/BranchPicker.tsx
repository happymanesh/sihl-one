'use client';

import { useEffect, useRef, useState } from 'react';

export interface BranchOption {
  id: string;
  name: string;
  /**
   * The region it sits under.
   *
   * Shown because the list is flat now: with the zones and regions stripped
   * out there is no indentation left to say where a branch belongs, and two
   * offices in one city read identically without it.
   */
  region?: string | null;
}

/**
 * Which branches a session is for, as a dropdown of checkboxes.
 *
 * Branches only. It offered the whole org tree to begin with — company, zones,
 * regions and branches alike — which read as though picking a region covered
 * everything under it. It does not: the link is stored against that one unit,
 * so a session aimed at a region would have reached nobody once announcements
 * are wired. The roll-up levels are gone rather than made to cascade, because
 * a branch is the level a session is actually held at.
 *
 * Same control as the visit attendee picker, for the same reasons — a native
 * `<select multiple>` cannot be un-selected without ctrl-click, and this is
 * filled in by whoever schedules the session, often for most of the network at
 * once. `<details>` carries open/close, keyboard and focus from the platform.
 *
 * The difference from the attendee picker is "All branches": a compliance
 * session usually goes to everybody, and ticking forty boxes to say so is the
 * kind of friction that gets a session scheduled for one branch by accident.
 *
 * Each selection is also written as a hidden input, so the enclosing form posts
 * `branchIds` repeated and the action reads it with `getAll` — no JSON blob in
 * a text field, and the form still works the way every other form here does.
 */
export function BranchPicker({
  branches,
  defaultSelected = [],
  disabled = false,
}: {
  branches: BranchOption[];
  defaultSelected?: string[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const details = useRef<HTMLDetailsElement>(null);

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
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const allSelected = branches.length > 0 && selected.length === branches.length;

  const summary =
    selected.length === 0
      ? 'Choose branches'
      : allSelected
        ? 'All branches'
        : selected.length === 1
          ? (branches.find((branch) => branch.id === selected[0])?.name ?? '1 branch')
          : `${selected.length} branches`;

  return (
    <>
      {selected.map((id) => (
        <input key={id} type="hidden" name="branchIds" value={id} />
      ))}

      <details ref={details} className="relative">
        <summary
          className={`flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm transition-colors ${
            disabled ? 'pointer-events-none opacity-60' : 'cursor-pointer'
          } ${
            selected.length
              ? 'border-teal-500 text-[var(--color-text)]'
              : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
          } list-none`}
        >
          <span className="truncate">{summary}</span>
          <span aria-hidden className="text-[0.625rem] opacity-70">
            ▾
          </span>
        </summary>

        <div
          className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
          role="group"
          aria-label="Branches this session is for"
        >
          <div className="max-h-56 overflow-y-auto p-1.5">
            {branches.map((branch) => (
              <label
                key={branch.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(branch.id)}
                  onChange={() => toggle(branch.id)}
                  className="h-3.5 w-3.5 accent-teal-600"
                />
                {/* Two lines rather than one truncated one: at the width of
                    the field the region is exactly the half that gets cut. */}
                <span className="min-w-0">
                  <span className="block truncate">{branch.name}</span>
                  {branch.region ? (
                    <span className="block truncate text-xs text-[var(--color-text-subtle)]">
                      {branch.region}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2.5 py-1.5">
            <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">
              {selected.length === 0 ? 'None selected' : `${selected.length} selected`}
            </span>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? [] : branches.map((branch) => branch.id))}
              className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
            >
              {allSelected ? 'Clear' : 'Select all'}
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
