'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  assessCheckInLocation,
  locationQuality,
  type LocationFailureReason,
} from '@sihl-one/contracts';

import { checkInVisit, checkOutVisit, type VisitActionState } from '@/app/actions/visits';
import { VoiceInputButton } from '@/components/leads/VoiceInputButton';
import { CameraCapture } from './CameraCapture';

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
  const [reason, setReason] = useState<LocationFailureReason | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setError('This device cannot provide a location.');
      setReason('UNSUPPORTED');
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
        setReason(null);
        setLocating(false);
      },
      (positionError) => {
        setLocating(false);
        setFix(null);

        if (positionError.code === positionError.PERMISSION_DENIED) {
          setReason('DENIED');
          setError(
            'Location permission was refused. The visit will be recorded, but marked as unverified.',
          );
        } else if (positionError.code === positionError.TIMEOUT) {
          setReason('TIMEOUT');
          setError(
            'Could not get a location in time. Move somewhere with a clearer view of the sky and try again, or continue — the visit will be marked as unverified.',
          );
        } else {
          setReason('UNAVAILABLE');
          setError(
            'Could not determine your location. The visit will be recorded, but marked as unverified.',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  return { fix, error, reason, locating, locate };
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
        <p className="mt-1.5 text-xs text-warn-600">
          This reading is too imprecise to place the visit, so it will be recorded as unverified.
          Moving outdoors and locating again usually fixes it.
        </p>
      ) : null}
    </div>
  );
}

export function CheckInPanel({
  visitId,
  requiresPhoto,
  expectsLocation,
}: {
  visitId: string;
  /**
   * Set from the visit's mode. A phone call planned from this screen must not
   * demand a photograph of the rep at their own desk — that is theatre, and
   * reps rightly resent being asked for it.
   */
  requiresPhoto: boolean;
  /**
   * Whether this mode expects a location at all.
   *
   * When it does not, the screen does not ask the browser for one. Prompting
   * for GPS before every phone call collects a position nobody will read, for a
   * mode where it proves nothing — and the brief is explicit that this product
   * records deliberate events, not whereabouts.
   */
  expectsLocation: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(checkInVisit, INITIAL);
  const { fix, error, reason, locating, locate } = useGeolocation();

  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state.status, router]);

  // Ask for the location as soon as the panel opens — it is the slowest step,
  // and starting it while the user takes the photo removes the wait entirely.
  // Skipped where the mode does not expect one: no prompt, no reading.
  useEffect(() => {
    if (expectsLocation) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCaptured = async (file: File, previewUrl: string) => {
    setUploading(true);
    setUploadError(null);
    setPhotoPreview(previewUrl);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch('/api/upload?purpose=VISIT_PHOTO', { method: 'POST', body });
      const result = (await response.json()) as { storageKey?: string; detail?: string; title?: string };

      if (!response.ok || !result.storageKey) {
        setUploadError(result.detail ?? result.title ?? 'The photo could not be uploaded.');
        setPhotoPreview(null);
        return;
      }

      setPhotoKey(result.storageKey);
    } catch {
      setUploadError('The photo could not be uploaded. Check your connection and try again.');
      setPhotoPreview(null);
    } finally {
      setUploading(false);
    }
  };

  // Resolved as soon as a fix arrives, in parallel with the rep framing the
  // shot, so the address is normally already there when they press Capture.
  // Never awaited by anything: a slow or absent answer just means the stamp
  // carries coordinates and a time.
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!fix) return;
    let cancelled = false;

    fetch(`/api/reverse-geocode?lat=${fix.latitude}&lng=${fix.longitude}`)
      .then((response) => (response.ok ? response.json() : { address: null }))
      .then((body: { address?: string | null }) => {
        if (!cancelled) setAddress(body.address ?? null);
      })
      .catch(() => {
        if (!cancelled) setAddress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fix]);

  // The same call the server will make, so the rep is told what will be
  // recorded before they press the button rather than after.
  const assessment = assessCheckInLocation({
    latitude: fix?.latitude,
    longitude: fix?.longitude,
    accuracy: fix?.accuracy,
    locationFailureReason: reason ?? undefined,
  });

  // Only the photo gates the check-in, and only where the mode calls for one.
  // A poor fix is recorded as a poor fix — refusing the visit outright would
  // mean no record at all of a visit that genuinely happened, which is worse
  // data, and it punishes the rep for the building they were sent into.
  const canSubmit = (!requiresPhoto || Boolean(photoKey)) && !uploading;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="latitude" value={fix?.latitude ?? ''} />
      <input type="hidden" name="longitude" value={fix?.longitude ?? ''} />
      <input type="hidden" name="accuracy" value={fix?.accuracy ?? ''} />
      <input type="hidden" name="photoKey" value={photoKey ?? ''} />
      <input type="hidden" name="locationFailureReason" value={reason ?? ''} />
      {/* Stored on the visit as well as burnt into the photo. The image is for
          a human reading a printout; the column is what a report can group. */}
      <input type="hidden" name="address" value={address ?? ''} />

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}

      {expectsLocation ? (
      <section>
        <h3 className="text-sm font-bold">{requiresPhoto ? '1. Your location' : 'Your location'}</h3>
        <div className="mt-2 space-y-2">
          {fix ? <LocationReadout fix={fix} /> : null}
          {/* A warning, not an error: the check-in still goes through. Styling
              this in red would tell the rep they are blocked when they are not. */}
          {error ? (
            <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/15 dark:text-warn-100">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={locate} className="btn btn-outline w-full" disabled={locating}>
            {locating ? 'Locating…' : fix ? 'Update location' : 'Get my location'}
          </button>
        </div>
      </section>
      ) : null}

      {requiresPhoto ? (
      <section>
        <h3 className="text-sm font-bold">2. Check-in photo</h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Required. This is the evidence that the visit happened. The photo is taken here in the
          app — an existing picture cannot be uploaded.
        </p>

        <div className="mt-2 space-y-2">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Check-in photo, with the location and time stamped on it"
              className="w-full rounded-lg object-cover"
            />
          ) : null}

          {uploadError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
            >
              {uploadError}
            </p>
          ) : null}

          {uploading ? (
            <p className="text-center text-xs text-[var(--color-text-subtle)]">Uploading…</p>
          ) : null}

          <CameraCapture
            stamp={{
              latitude: fix?.latitude,
              longitude: fix?.longitude,
              accuracy: fix?.accuracy,
              address,
            }}
            onCapture={(file, previewUrl) => void onCaptured(file, previewUrl)}
            onClear={() => {
              setPhotoKey(null);
              setPhotoPreview(null);
            }}
            hasPhoto={Boolean(photoKey)}
            busy={uploading}
          />
        </div>
      </section>
      ) : null}

      <button type="submit" className="btn btn-accent w-full" disabled={!canSubmit}>
        Check in
      </button>

      {!canSubmit ? (
        <p className="text-center text-xs text-[var(--color-text-subtle)]">
          {uploading ? 'Waiting for the photo to upload…' : 'Take a photo to check in.'}
        </p>
      ) : expectsLocation && assessment.status === 'UNVERIFIED' ? (
        <p className="text-center text-xs text-warn-600">
          This check-in will be recorded as <strong>location unverified</strong>.
          {locating ? ' Still trying for a better fix…' : ''}
        </p>
      ) : null}
    </form>
  );
}

export function CheckOutPanel({
  visitId,
  expectsLocation,
  voiceInputEnabled = false,
}: {
  visitId: string;
  /** See CheckInPanel: no prompt where the mode expects no location. */
  expectsLocation: boolean;
  /**
   * Dictation for the meeting notes. Same control as the interaction form, and
   * arguably needed more here: this is typed standing outside a client's office
   * on a phone, not at a desk.
   */
  voiceInputEnabled?: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(checkOutVisit, INITIAL);
  const { fix, error, reason, locating, locate } = useGeolocation();

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state.status, router]);

  useEffect(() => {
    if (expectsLocation) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="latitude" value={fix?.latitude ?? ''} />
      <input type="hidden" name="longitude" value={fix?.longitude ?? ''} />
      <input type="hidden" name="accuracy" value={fix?.accuracy ?? ''} />
      <input type="hidden" name="locationFailureReason" value={reason ?? ''} />

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </div>
      ) : null}

      {expectsLocation && fix ? <LocationReadout fix={fix} /> : null}
      {expectsLocation && error ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/15 dark:text-warn-100">
          {error}
        </p>
      ) : null}
      {expectsLocation && !fix ? (
        <button type="button" onClick={locate} className="btn btn-outline w-full" disabled={locating}>
          {locating ? 'Locating…' : 'Get my location'}
        </button>
      ) : null}

      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="label" htmlFor="meetingNotes">
            What was discussed? <span className="text-danger-500">*</span>
          </label>
          <VoiceInputButton enabled={voiceInputEnabled} />
        </div>
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

      {/* Deliberately not gated on a location. A rep who checked in from a
          basement must still be able to close the visit — blocking here would
          strand it open and lose the meeting notes, which are worth far more
          than a reading that was never going to arrive. */}
      <button type="submit" className="btn btn-accent w-full">
        Check out and complete
      </button>
    </form>
  );
}
