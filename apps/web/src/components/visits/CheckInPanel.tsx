'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { locationQuality, MAX_ACCEPTABLE_ACCURACY_METRES } from '@sihl-one/contracts';

import { checkInVisit, checkOutVisit, type VisitActionState } from '@/app/actions/visits';

const INITIAL: VisitActionState = { status: 'idle' };

interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

const QUALITY_COPY: Record<string, { label: string; tone: string }> = {
  PRECISE: { label: 'Precise', tone: 'text-teal-600 dark:text-teal-300' },
  GOOD: { label: 'Good', tone: 'text-teal-600 dark:text-teal-300' },
  APPROXIMATE: { label: 'Approximate', tone: 'text-warn-600' },
  UNRELIABLE: { label: 'Too imprecise', tone: 'text-danger-500' },
};

/**
 * Shared location capture.
 *
 * `enableHighAccuracy` asks for GPS rather than a network fix — it costs
 * battery and a few seconds, which is the right trade when the reading is
 * evidence. `maximumAge: 0` refuses a cached position: a fix from twenty
 * minutes ago is from wherever the phone was then.
 */
function useGeolocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setError('This device cannot provide a location.');
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        });
        setLocating(false);
      },
      (positionError) => {
        setLocating(false);
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? 'Location permission was refused. A visit cannot be recorded without it.'
            : positionError.code === positionError.TIMEOUT
              ? 'Could not get a location in time. Move somewhere with a clearer view of the sky and try again.'
              : 'Could not determine your location.',
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  return { fix, error, locating, locate };
}

function LocationReadout({ fix }: { fix: Fix }) {
  const quality = locationQuality(fix.accuracy);
  const copy = QUALITY_COPY[quality] ?? QUALITY_COPY.UNRELIABLE!;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">Location captured</span>
        <span className={`text-xs font-bold ${copy.tone}`}>
          {copy.label} · ±{fix.accuracy} m
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
        {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}
      </p>
      {quality === 'UNRELIABLE' ? (
        <p className="mt-1.5 text-xs text-danger-500">
          This reading is too imprecise to place the visit. Move outdoors and locate again.
        </p>
      ) : null}
    </div>
  );
}

export function CheckInPanel({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(checkInVisit, INITIAL);
  const { fix, error, locating, locate } = useGeolocation();

  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state.status, router]);

  // Ask for the location as soon as the panel opens — it is the slowest step,
  // and starting it while the user takes the photo removes the wait entirely.
  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPhotoChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch('/api/upload?purpose=VISIT_PHOTO', { method: 'POST', body });
      const result = (await response.json()) as { storageKey?: string; detail?: string; title?: string };

      if (!response.ok || !result.storageKey) {
        setUploadError(result.detail ?? result.title ?? 'The photo could not be uploaded.');
        return;
      }

      setPhotoKey(result.storageKey);
      setPhotoPreview(URL.createObjectURL(file));
    } catch {
      setUploadError('The photo could not be uploaded. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const quality = fix ? locationQuality(fix.accuracy) : null;
  const canSubmit =
    Boolean(fix) &&
    Boolean(photoKey) &&
    quality !== 'UNRELIABLE' &&
    (fix?.accuracy ?? Infinity) <= MAX_ACCEPTABLE_ACCURACY_METRES;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="latitude" value={fix?.latitude ?? ''} />
      <input type="hidden" name="longitude" value={fix?.longitude ?? ''} />
      <input type="hidden" name="accuracy" value={fix?.accuracy ?? ''} />
      <input type="hidden" name="photoKey" value={photoKey ?? ''} />

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}

      <section>
        <h3 className="text-sm font-bold">1. Your location</h3>
        <div className="mt-2 space-y-2">
          {fix ? <LocationReadout fix={fix} /> : null}
          {error ? (
            <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={locate} className="btn btn-outline w-full" disabled={locating}>
            {locating ? 'Locating…' : fix ? 'Update location' : 'Get my location'}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold">2. Check-in photo</h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Required. This is the evidence that the visit happened.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          // `capture="user"` opens the front camera directly on a phone instead
          // of the gallery, which is both faster and harder to fake with an old
          // photo. On desktop it degrades to a normal file picker.
          capture="user"
          onChange={(event) => void onPhotoChosen(event)}
          className="sr-only"
        />

        <div className="mt-2 space-y-2">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Check-in photo preview"
              className="h-40 w-full rounded-lg object-cover"
            />
          ) : null}

          {uploadError ? (
            <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15">
              {uploadError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn btn-outline w-full"
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : photoKey ? 'Retake photo' : 'Take photo'}
          </button>
        </div>
      </section>

      <button type="submit" className="btn btn-accent w-full" disabled={!canSubmit}>
        Check in
      </button>

      {!canSubmit ? (
        <p className="text-center text-xs text-[var(--color-text-subtle)]">
          {!fix
            ? 'Waiting for your location…'
            : quality === 'UNRELIABLE'
              ? 'The location reading is too imprecise.'
              : 'Take a photo to check in.'}
        </p>
      ) : null}
    </form>
  );
}

export function CheckOutPanel({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(checkOutVisit, INITIAL);
  const { fix, error, locating, locate } = useGeolocation();

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state.status, router]);

  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quality = fix ? locationQuality(fix.accuracy) : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="latitude" value={fix?.latitude ?? ''} />
      <input type="hidden" name="longitude" value={fix?.longitude ?? ''} />
      <input type="hidden" name="accuracy" value={fix?.accuracy ?? ''} />

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}

      {fix ? <LocationReadout fix={fix} /> : null}
      {error ? (
        <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15">
          {error}
        </p>
      ) : null}
      {!fix ? (
        <button type="button" onClick={locate} className="btn btn-outline w-full" disabled={locating}>
          {locating ? 'Locating…' : 'Get my location'}
        </button>
      ) : null}

      <div>
        <label className="label" htmlFor="meetingNotes">
          What was discussed? <span className="text-danger-500">*</span>
        </label>
        <textarea
          id="meetingNotes"
          name="meetingNotes"
          rows={5}
          required
          className="input resize-none"
          placeholder="Documents collected, objections raised, what was agreed…"
          aria-invalid={Boolean(state.errors?.meetingNotes)}
        />
        {state.errors?.meetingNotes ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.meetingNotes[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="outcome">
            Outcome
          </label>
          <input
            id="outcome"
            name="outcome"
            className="input"
            placeholder="Documents collected"
          />
        </div>
        <div>
          <label className="label" htmlFor="nextFollowUpAt">
            Next follow-up
          </label>
          <input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" className="input" />
        </div>
      </div>

      <button type="submit" className="btn btn-accent w-full" disabled={!fix || quality === 'UNRELIABLE'}>
        Check out and complete
      </button>
    </form>
  );
}
