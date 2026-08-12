'use client';

import { useState } from 'react';

/**
 * A read-only value with a copy button.
 *
 * The value stays selectable rather than being hidden behind the button alone:
 * clipboard access is blocked in some managed browser configurations, and a
 * copy button that silently does nothing is worse than no button.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        className="input h-9 min-w-[18rem] flex-1 font-mono text-xs"
      />
      <button type="button" onClick={() => void copy()} className="btn btn-outline h-9 text-xs">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
      </button>
      {/* Announced to screen readers without moving focus. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}
