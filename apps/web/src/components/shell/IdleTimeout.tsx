'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Signs the user out after a period without activity, warning first.
 *
 * The browser side is the courtesy: the API enforces the same window against
 * `session.lastSeenAt` and rejects a refresh past it, so closing the laptop lid
 * does not leave a usable session behind. Without the server check this would be
 * decoration.
 *
 * Activity deliberately includes typing. A rep writing up a long visit note is
 * working, and signing them out mid-sentence is how you teach a team to distrust
 * the system — which is also why the draft-preserving `beforeunload` guard below
 * matters more than it looks.
 */
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointermove'] as const;

export function IdleTimeout({
  onLogout,
  idleMinutes = 15,
  warnSecondsBefore = 120,
}: {
  onLogout: () => Promise<void>;
  idleMinutes?: number;
  warnSecondsBefore?: number;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const signingOut = useRef(false);

  const idleMs = idleMinutes * 60_000;
  const warnMs = warnSecondsBefore * 1000;

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    await onLogout();
  }, [onLogout]);

  const staySignedIn = useCallback(() => {
    lastActivity.current = Date.now();
    setRemaining(null);
    // Any authenticated request refreshes `lastSeenAt` server-side; this is the
    // cheapest one that proves the session is still good.
    void fetch('/api/session/touch', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const markActive = () => {
      // While the warning is showing, ordinary movement must not silently cancel
      // it — the user has to choose, or the countdown means nothing.
      if (remaining !== null) return;
      lastActivity.current = Date.now();
    };

    for (const event of EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      const msLeft = idleMs - idleFor;

      if (msLeft <= 0) {
        void signOut();
        return;
      }
      setRemaining(msLeft <= warnMs ? Math.ceil(msLeft / 1000) : null);
    }, 1000);

    return () => {
      for (const event of EVENTS) window.removeEventListener(event, markActive);
      window.clearInterval(tick);
    };
  }, [idleMs, warnMs, remaining, signOut]);

  if (remaining === null) return null;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-body"
    >
      <div className="card w-full max-w-sm p-5">
        <h2 id="idle-title" className="text-lg font-bold">
          Still there?
        </h2>
        <p id="idle-body" className="mt-1 text-sm text-[var(--color-text-muted)]">
          You will be signed out in{' '}
          <span className="font-mono font-bold tabular-nums text-[var(--color-text)]">
            {minutes}:{String(seconds).padStart(2, '0')}
          </span>{' '}
          because of inactivity. Anything you have typed but not saved will be lost.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary" onClick={staySignedIn} autoFocus>
            Stay signed in
          </button>
          <button type="button" className="btn btn-outline" onClick={() => void signOut()}>
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
