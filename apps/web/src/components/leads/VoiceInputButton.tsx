'use client';

/**
 * Dictation for the Remarks field.
 *
 * Present but switched off until the language service is configured. Shown
 * rather than hidden on purpose: reps were told this is coming, and a control
 * that says "not available yet, and here is why" is more honest than one that
 * silently appears one day — or worse, one that appears and does nothing.
 *
 * `enabled` comes from the server, so switching it on is an environment change
 * rather than a release. The capture pipeline itself lands with the API key:
 * writing recording and transcription code that cannot be exercised end to end
 * would be guesswork dressed as progress.
 */
export function VoiceInputButton({
  enabled,
  reason = 'Voice input is being set up. It will switch on once the language service is connected.',
}: {
  enabled: boolean;
  reason?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={!enabled}
        title={enabled ? 'Dictate a remark' : reason}
        aria-label={enabled ? 'Dictate a remark' : `Dictation unavailable. ${reason}`}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors ${
          enabled
            ? 'border-teal-500 text-teal-600 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-900/30'
            : 'cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-subtle)] opacity-70'
        }`}
      >
        {/* Colour alone would not carry the state — the word does the work. */}
        <MicIcon />
        <span>Dictate</span>
      </button>

      {!enabled ? (
        <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">Coming soon</span>
      ) : null}
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
      <path d="M12 17v4" strokeLinecap="round" />
    </svg>
  );
}
