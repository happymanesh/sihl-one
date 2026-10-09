'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Still there?", shortly before the session goes.
 *
 * The API signs a session out after fifteen minutes without a request, and it
 * has no other way to know whether anybody is still at the desk. That rule is
 * right for a broker's system and it is keeping it — but being dropped mid-form
 * with no warning is what people actually complain about, not the rule itself.
 *
 * So the last two minutes are spent asking. Answer and nothing is lost; ignore
 * it and the sign-out happens exactly when it would have anyway.
 *
 * Deliberately not a countdown that runs the whole fifteen minutes on screen.
 * A timer in the corner of a screen somebody is working in is an interruption
 * repeated hundreds of times a day, to say something that matters twice.
 */

/** Anything the person does that means they are still here. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * How recently someone must have touched the page for the warning to be
 * answered on their behalf rather than shown to them.
 *
 * Long enough that a pause for thought mid-form still counts as working;
 * short enough that it cannot cover somebody who has left the desk.
 *
 * It also bounds how far a silent extension can stretch the idle rule, and the
 * bound is this window and nothing more — not another whole cycle. An extension
 * needs input within the last 90 seconds, so the latest it can fire is 90
 * seconds after the last keystroke, and a terminal left unattended can stay
 * signed in for at most `idleMinutes` plus this window: sixteen and a half
 * minutes against a fifteen-minute policy.
 */
const WORKING_WINDOW_MS = 90_000;

export function SessionExpiryWarning({
  /** Must match AUTH_IDLE_TIMEOUT_MINUTES on the API. */
  idleMinutes = 15,
  /** How long the warning is on screen before the session actually goes. */
  warnSeconds = 120,
}: {
  idleMinutes?: number;
  warnSeconds?: number;
}) {
  const idleMs = idleMinutes * 60_000;
  const warnMs = warnSeconds * 1000;

  /*
    Held in a ref, not in state.

    Every pointer and key event would otherwise re-render the whole shell, and
    this component's job is to be invisible until the one moment it is not.
  */
  /*
    Two clocks, because there are two facts and they are not the same one.

    `lastRequestAt` is the only thing the API's idle rule is about: it moves when
    a real request goes through, and it is what the countdown is computed from.
    `lastInputAt` moves on every keystroke and says whether anybody is at the
    desk right now.

    Keeping one clock is what broke this. Local input used to reset the single
    clock, so filling a long form kept the countdown permanently topped up while
    the server — which had seen nothing since the page loaded — signed the
    session out at fifteen minutes to the second. The dialog never showed, no
    request was ever sent, and the person found out when their save failed.
  */
  // Seeded on mount, not here. Reading the clock during render is impure — it
  // would give the server render and the hydration two different answers.
  const lastRequestAt = useRef(0);
  const lastInputAt = useRef(0);
  /** Stops a silent extension being asked for again while one is in flight. */
  const extendingSilently = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);

  const markActive = useCallback(() => {
    lastInputAt.current = Date.now();
  }, []);

  /*
    Browser activity and server activity are not the same thing, and the gap is
    the whole reason this exists. Scrolling a long page sends nothing, so the
    session ages while the person is plainly working. Local events decide when
    to *ask*; only a real request resets the server's clock, which is what the
    button does.
  */
  useEffect(() => {
    // The page just rendered, which was a request, which is the server's idea
    // of activity. Both clocks start from there.
    const now = Date.now();
    lastRequestAt.current = now;
    lastInputAt.current = now;

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, markActive, { passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, markActive);
    };
  }, [markActive]);

  /**
   * Sends the one request that resets the API's idle clock.
   *
   * Shared by the button and by the silent extension below, because the thing
   * that has to happen is identical: a real authenticated request. The only
   * difference is whether a dialog is on screen waiting for it.
   */
  const touchServer = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/session/keepalive', {
        method: 'POST',
        cache: 'no-store',
      });
      const data = (await response.json()) as { alive?: boolean };

      if (data.alive === false) return false;

      // Only now, and only because a real request just went through. Moving
      // this on the click alone would hide the dialog while the server went on
      // counting, and the sign-out would arrive with no warning at all.
      lastRequestAt.current = Date.now();
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    // One second, so the countdown reads honestly. It is a comparison against a
    // number, not work.
    const timer = setInterval(() => {
      // Zero until the mount effect has run; nothing to judge yet.
      if (lastRequestAt.current === 0) return;
      const now = Date.now();
      const remaining = idleMs - (now - lastRequestAt.current);

      if (remaining <= 0) {
        // Gone. Sent through the sign-in page rather than left on a screen whose
        // every action is about to fail with a permission error.
        window.location.href = `/login?reason=idle&next=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`;
        return;
      }

      if (remaining > warnMs) {
        setSecondsLeft(null);
        return;
      }

      /*
        Inside the last two minutes, and the question is who is being asked.

        Somebody who is demonstrably typing has already answered it, so the
        request is sent for them and they are never interrupted — this is the
        case that used to end in a dead session and a lost form. Somebody who
        has not touched the page gets the dialog, which is the rule working as
        intended: an idle timeout should sign out the person who walked away,
        not the person filling in a long form.
      */
      if (now - lastInputAt.current <= WORKING_WINDOW_MS) {
        if (extendingSilently.current) return;
        extendingSilently.current = true;
        void touchServer()
          .then((alive) => {
            if (!alive) window.location.href = '/login?reason=expired';
          })
          .finally(() => {
            extendingSilently.current = false;
          });
        return;
      }

      setSecondsLeft(Math.ceil(remaining / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [idleMs, warnMs, touchServer]);

  const staySignedIn = useCallback(async () => {
    setExtending(true);
    try {
      if (await touchServer()) {
        setSecondsLeft(null);
        return;
      }
      window.location.href = '/login?reason=expired';
    } finally {
      setExtending(false);
    }
  }, [touchServer]);

  if (secondsLeft === null) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-navy-950/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expiry-title"
      aria-describedby="session-expiry-detail"
    >
      {/*
        No dismiss on the backdrop, and no close button.

        Every other dialog in the product closes when you click away, and that
        is right for a dialog you can ignore. Clicking away from this one looks
        like dismissing it and would in fact be choosing to be signed out.
      */}
      <div className="card w-full max-w-sm p-5">
        <h2 id="session-expiry-title" className="text-base font-bold">
          Are you still there?
        </h2>
        <p id="session-expiry-detail" className="mt-2 text-sm text-[var(--color-text-muted)]">
          You will be signed out in{' '}
          <span className="tnum font-bold text-[var(--color-text)]">
            {minutes}:{String(seconds).padStart(2, '0')}
          </span>{' '}
          because there has been no activity. Anything you have typed and not saved will be lost.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <a href="/login?reason=signed-out" className="btn btn-outline">
            Sign out
          </a>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void staySignedIn()}
            disabled={extending}
            autoFocus
          >
            {extending ? 'One moment…' : 'Stay signed in'}
          </button>
        </div>
      </div>
    </div>
  );
}
