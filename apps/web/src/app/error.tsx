'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary.
 *
 * Shows the digest, not the message. Next replaces server error messages with
 * an opaque digest in production precisely so internal details do not leak, and
 * the digest is what lets support find the matching server log line. Rendering
 * `error.message` here would show "An error occurred in the Server Components
 * render" in production and something far more revealing in development.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('SIHL ONE render error', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          We could not load this screen. Your data is safe — nothing was changed.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            Quote this reference to support:{' '}
            <span className="font-mono font-semibold">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <a href="/dashboard" className="btn btn-outline">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
