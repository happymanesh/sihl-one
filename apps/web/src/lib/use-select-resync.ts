'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Puts a controlled `<select>` back where it was after a form action returns.
 *
 * React 19 resets the form element once an action completes. For a controlled
 * text input that is invisible — the state value still differs from the empty
 * DOM value, so React patches it straight back. A `<select>` reset to its
 * first option is not: React's own value never changed, so it schedules no
 * update, and the DOM silently keeps the reset.
 *
 * The result is worse than losing the value. The field reads "Choose a
 * product" while the state still holds Equity, so the next submit saves
 * against a product the screen says was never chosen. That is a wrong answer
 * presented as a blank one.
 *
 * Runs after every render rather than on a dependency list, because the thing
 * it is correcting happens outside React and so cannot be a dependency. It
 * touches only fields whose DOM value disagrees with the state, so a render
 * where nothing drifted does nothing.
 */
export function useSelectResync(
  form: RefObject<HTMLFormElement | null>,
  values: Record<string, string>,
): void {
  useEffect(() => {
    const node = form.current;
    if (!node) return;

    for (const [name, value] of Object.entries(values)) {
      const field = node.elements.namedItem(name);
      if (field instanceof HTMLSelectElement && field.value !== value) {
        field.value = value;
      }
    }
  });
}
