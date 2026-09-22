'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Which leads are ticked, shared across the screen.
 *
 * The tick boxes live in the table and the thing they drive — the assign bar —
 * lives up in the filter row, so the state cannot sit in either. A context is
 * the smallest thing that lets a checkbox in row forty change a control above
 * the list without either component knowing the other exists.
 *
 * Selection is deliberately per-page. Carrying ticks across pagination would
 * mean a confirmation that says "assign 60 leads" while 20 are on screen, and
 * the reader has no way to audit the other 40 before committing.
 */
interface LeadSelectionValue {
  selected: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Tick or clear every lead on this page at once. */
  toggleAll: () => void;
  allSelected: boolean;
  clear: () => void;
}

const LeadSelectionContext = createContext<LeadSelectionValue | null>(null);

export function LeadSelectionProvider({
  ids,
  children,
}: {
  /** Every lead id on the current page, in order. */
  ids: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  /*
    Drop ticks for rows that are no longer here.

    After an assignment the list re-renders without the leads that just moved,
    and a filter change replaces the page wholesale. Keeping those ids would
    leave an invisible selection driving a visible button — "Assign 12" with
    nothing ticked on screen. Adjusting during render rather than in an effect
    is React's documented pattern for state derived from props, and avoids the
    extra commit an effect would cost on every page of results.
  */
  const signature = ids.join(',');
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setSelected((current) => current.filter((id) => ids.includes(id)));
  }

  const value = useMemo<LeadSelectionValue>(() => {
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    return {
      selected,
      allSelected,
      isSelected: (id) => selected.includes(id),
      toggle: (id) =>
        setSelected((current) =>
          current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        ),
      toggleAll: () => setSelected(allSelected ? [] : ids),
      clear: () => setSelected([]),
    };
  }, [ids, selected]);

  return <LeadSelectionContext.Provider value={value}>{children}</LeadSelectionContext.Provider>;
}

/**
 * Null when the screen is not in selection mode.
 *
 * The provider is only mounted where bulk assignment applies, so a null return
 * is the normal answer on every other lead list — the checkbox components use
 * it to render nothing rather than to throw.
 */
export function useLeadSelection(): LeadSelectionValue | null {
  return useContext(LeadSelectionContext);
}

/** The tick box on one row. */
export function LeadCheckbox({ id, label }: { id: string; label: string }) {
  const selection = useLeadSelection();
  if (!selection) return null;

  return (
    <input
      type="checkbox"
      checked={selection.isSelected(id)}
      onChange={() => selection.toggle(id)}
      aria-label={`Select ${label}`}
      className="h-4 w-4 cursor-pointer accent-teal-600"
    />
  );
}

/** The tick box in the header: every lead on this page. */
export function LeadSelectAllCheckbox() {
  const selection = useLeadSelection();
  if (!selection) return null;

  // Indeterminate is the honest state for a partial selection, and it is the
  // only way to say "some" on a control with two visual states.
  const partial = selection.selected.length > 0 && !selection.allSelected;

  return (
    <input
      type="checkbox"
      checked={selection.allSelected}
      ref={(node) => {
        if (node) node.indeterminate = partial;
      }}
      onChange={() => selection.toggleAll()}
      aria-label="Select every lead on this page"
      className="h-4 w-4 cursor-pointer accent-teal-600"
    />
  );
}
