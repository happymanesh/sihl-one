'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Attach a deck or handout to a session.
 *
 * Posts to the same-origin proxy rather than through a server action: a 25MB
 * deck as an action payload is slow and fails in ways that give the user
 * nothing to read. The size is checked here too, so an oversized file is
 * refused before it is uploaded rather than after.
 */
export function MaterialUploader({ trainingId }: { trainingId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(`${file.name} is larger than 25 MB. Share it as a link in the remarks instead.`);
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file, file.name);

      const response = await fetch(`/api/training/${trainingId}/material`, {
        method: 'POST',
        body,
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as {
          title?: string;
          detail?: string;
        } | null;
        setError(problem?.detail ?? problem?.title ?? 'The file could not be attached.');
        return;
      }

      // The list of attached files is rendered on the server, so a refresh is
      // what makes the new row appear — not local state that could disagree.
      router.refresh();
      if (input.current) input.current.value = '';
    } catch {
      setError('The upload did not complete. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        className="input"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <p className="text-xs text-[var(--color-text-subtle)]">
        {busy ? 'Uploading…' : 'Up to 25 MB. Decks, handouts, recordings.'}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
