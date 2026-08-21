'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatDateTime } from '@/lib/format';

/**
 * Check-in photo capture, from a live camera only.
 *
 * There is deliberately no file input here. A file picker lets a rep submit a
 * photograph taken last week from a different town, and `capture="user"` on an
 * `<input type="file">` is a hint that phones are free to ignore — several
 * Android browsers open the gallery anyway. Reading frames from a MediaStream
 * removes the route: the image is whatever the sensor sees at the moment the
 * button is pressed.
 *
 * The stamp burnt into the frame is for the person looking at the photo — it
 * makes a printed or forwarded copy self-describing, which is what the Chief
 * Business Development Officer asked for. It is NOT the evidence. Anything
 * drawn in a canvas on the rep's own phone could be drawn differently by
 * someone determined enough. The coordinates, accuracy and server clock stored
 * against the visit are the record; the stamp is a caption of them.
 */

/** Longest edge of the stored image. Enough to read an ID card, small enough to
 *  upload on a weak connection in a stairwell. */
const MAX_EDGE = 1280;
const TARGET_BYTES = 300 * 1024;
/** Tried in order until one comes in under the target. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.42];

export interface CameraStamp {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

type Phase = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'failed';

export function CameraCapture({
  stamp,
  onCapture,
  onClear,
  hasPhoto,
  busy,
}: {
  stamp: CameraStamp;
  onCapture: (file: File, previewUrl: string) => void;
  onClear: () => void;
  hasPhoto: boolean;
  busy: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  // Held in a ref as well as in props: `capture` reads it at the moment the
  // shutter fires, and a stale closure would stamp a fix from before the last
  // location update.
  const stampRef = useRef(stamp);
  useEffect(() => {
    stampRef.current = stamp;
  }, [stamp]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Release the camera when the panel unmounts. Without this the indicator
  // light stays on after check-in, which reasonably alarms people.
  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (mode: 'user' | 'environment') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        // Also the state on an insecure origin: browsers hide the API entirely
        // outside HTTPS and localhost, so this covers "someone opened the LAN
        // address over http" too.
        setPhase('unsupported');
        return;
      }

      setPhase('requesting');
      setFailure(null);
      stop();

      const open = (facingMode: 'user' | 'environment') =>
        navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });

      try {
        let stream: MediaStream;
        try {
          stream = await open(mode);
        } catch (error) {
          // No camera matching that facing mode — a laptop has no rear camera.
          // Fall back to any camera rather than reporting no camera at all.
          const name = error instanceof DOMException ? error.name : '';
          const noSuchCamera = name === 'NotFoundError' || name === 'OverconstrainedError';
          if (!noSuchCamera || mode !== 'environment') throw error;
          setFacing('user');
          stream = await open('user');
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS Safari will not autoplay without an explicit play(), and it
          // rejects if the element was removed while permission was pending.
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase('live');
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setPhase('denied');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setPhase('unsupported');
        } else {
          setFailure(
            name === 'NotReadableError'
              ? 'Another app is using the camera. Close it and try again.'
              : 'The camera could not be started.',
          );
          setPhase('failed');
        }
      }
    },
    [stop],
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The preview is mirrored for the front camera so it behaves like a mirror,
    // but the saved frame must not be — mirrored text on an ID card is
    // unreadable, which defeats the point of holding one up.
    ctx.drawImage(video, 0, 0, width, height);
    drawStamp(ctx, width, height, stampRef.current);

    const blob = await toBlobUnderTarget(canvas);
    if (!blob) {
      setFailure('The photo could not be saved. Try again.');
      setPhase('failed');
      return;
    }

    const file = new File([blob], `check-in-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stop();
    setPhase('idle');
    onCapture(file, URL.createObjectURL(blob));
  }, [onCapture, stop]);

  if (hasPhoto) {
    return (
      <button
        type="button"
        onClick={() => {
          onClear();
          void start(facing);
        }}
        className="btn btn-outline w-full"
        disabled={busy}
      >
        Retake photo
      </button>
    );
  }

  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={() => void start(facing)}
        className="btn btn-outline w-full"
        disabled={busy}
      >
        Open camera
      </button>
    );
  }

  if (phase === 'denied') {
    return (
      <Notice tone="danger" title="Camera permission was refused">
        <p>A check-in needs a photo, so this has to be turned back on before you can continue.</p>
        <p className="mt-1.5">
          Tap the padlock or camera icon in the address bar and allow camera access for this site,
          then press the button below. On an iPhone it is Settings → Safari → Camera → Ask, or
          Settings → the app → Camera.
        </p>
        <button type="button" onClick={() => void start(facing)} className="btn btn-outline mt-3 w-full">
          I have allowed it — try again
        </button>
      </Notice>
    );
  }

  if (phase === 'unsupported') {
    return (
      <Notice tone="danger" title="No camera available">
        <p>
          This device has no camera the browser can use, or the page was not opened over a secure
          (https) address. Use the mobile app link, or a phone, to record this visit.
        </p>
      </Notice>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-64 w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />

        {phase === 'requesting' ? (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white">
            Waiting for camera permission…
          </p>
        ) : null}

        {phase === 'live' ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-2.5 py-1.5 font-mono text-[0.625rem] leading-tight text-white">
            {stampLines(stamp).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-[var(--color-text-subtle)]">
        Hold your ID card in the frame with the premises behind you.{' '}
        <strong className="font-semibold">Please do not photograph the client.</strong>
      </p>

      {failure ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {failure}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void capture()}
          className="btn btn-accent flex-1"
          disabled={phase !== 'live' || busy}
        >
          Capture
        </button>
        <button
          type="button"
          onClick={() => {
            const next = facing === 'user' ? 'environment' : 'user';
            setFacing(next);
            void start(next);
          }}
          className="btn btn-outline"
          disabled={busy}
          aria-label="Switch between the front and rear camera"
        >
          Flip
        </button>
      </div>
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'danger';
  title: string;
  children: React.ReactNode;
}) {
  void tone;
  return (
    <div className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * The caption, as lines. Shared between the live overlay and the burnt-in
 * stamp so what the rep sees before pressing Capture is what ends up on the
 * image.
 */
function stampLines(stamp: CameraStamp): string[] {
  const when = formatDateTime(new Date());

  if (stamp.latitude === undefined || stamp.longitude === undefined) {
    return ['Location unavailable', when];
  }

  const accuracy =
    stamp.accuracy === undefined ? '' : `  ±${Math.round(stamp.accuracy)} m`;

  return [
    `${stamp.latitude.toFixed(5)}, ${stamp.longitude.toFixed(5)}${accuracy}`,
    when,
  ];
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stamp: CameraStamp,
) {
  const lines = stampLines(stamp);
  const size = Math.max(13, Math.round(width * 0.028));
  const gap = Math.round(size * 0.35);
  const pad = Math.round(size * 0.6);
  const band = lines.length * size + (lines.length - 1) * gap + pad * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, height - band, width, band);

  ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';

  lines.forEach((line, index) => {
    ctx.fillText(line, pad, height - band + pad + index * (size + gap));
  });
}

/**
 * Encode at decreasing quality until the file is small enough to upload over a
 * patchy mobile connection. Returns the last attempt even if it is still over
 * the target — a large photo is better than a failed check-in.
 */
async function toBlobUnderTarget(canvas: HTMLCanvasElement): Promise<Blob | null> {
  let last: Blob | null = null;

  for (const quality of QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    if (!blob) break;
    last = blob;
    if (blob.size <= TARGET_BYTES) return blob;
  }

  return last;
}
