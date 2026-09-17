'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation for a free-text field.
 *
 * A rep speaks in whichever of the ten languages they think in; the recording
 * goes to the API, which has the provider key, and English text comes back and
 * is appended to the field. Appended rather than replacing: somebody who has
 * already typed half a note should not lose it by tapping the wrong control.
 *
 * The audio is encoded to WAV here rather than handed straight from
 * MediaRecorder. MediaRecorder emits whatever container the phone prefers —
 * webm/opus on Android Chrome, mp4 on iOS — and the two do not overlap
 * cleanly with what a speech provider accepts. Sixteen kilohertz mono WAV is
 * understood everywhere, is what the provider was verified against, and at
 * roughly 32 KB per second keeps a two-minute note well inside the upload cap.
 */

/** Speech is intelligible far below this; higher only inflates the upload. */
const SAMPLE_RATE = 16_000;

/**
 * A dictated note is a sentence or two, not a monologue.
 *
 * Was two minutes, which was a guard against a pocket recording rather than a
 * considered limit. Ten seconds is the length of the thing reps actually say —
 * "met at the branch, wants an F&O account, call Tuesday" — and a short, hard
 * window is also kinder: the counter runs down rather than up, so a rep can see
 * how long they have instead of guessing when to stop.
 */
const MAX_SECONDS = 10;

type Phase = 'idle' | 'requesting' | 'recording' | 'working' | 'denied' | 'failed';

export function VoiceInputButton({
  enabled,
  targetId,
  reason = 'Voice input is being set up. It will switch on once the language service is connected.',
}: {
  enabled: boolean;
  /**
   * The textarea to append into. Omitted, the control still records and reports
   * — useful while a screen is being built, useless to a rep, so every real
   * caller passes it.
   */
  targetId?: string;
  reason?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  // Releasing the microphone on unmount matters: the browser's recording
  // indicator staying lit after the form closes reads as the app listening in.
  useEffect(() => release, [release]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const finish = useCallback(async () => {
    const audio = encodeWav(chunksRef.current, contextRef.current?.sampleRate ?? SAMPLE_RATE);
    release();
    chunksRef.current = [];

    // Under about a quarter of a second nobody said anything; sending it would
    // spend money to be told so.
    if (audio.byteLength < SAMPLE_RATE / 2) {
      setPhase('idle');
      setMessage('That was too short to hear. Hold the button while you speak.');
      return;
    }

    setPhase('working');
    setMessage(null);

    try {
      const form = new FormData();
      form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'note.wav');

      const response = await fetch('/api/transcribe', { method: 'POST', body: form });
      const body = (await response.json()) as {
        text?: string;
        detail?: string;
        title?: string;
      };

      if (!response.ok) {
        setPhase('failed');
        setMessage(body.detail ?? body.title ?? 'The note could not be transcribed.');
        return;
      }

      const text = (body.text ?? '').trim();
      if (!text) {
        setPhase('idle');
        setMessage('Nothing could be made out. Try again somewhere quieter.');
        return;
      }

      const field = targetId
        ? (document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null)
        : null;

      if (field) {
        const existing = field.value.trim();
        const next = existing ? `${existing} ${text}` : text;

        // Set through the native setter and dispatch an input event, or React's
        // controlled inputs never see the change.
        const prototype =
          field instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, next);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
      }

      setPhase('idle');
      setMessage(field ? null : text);
    } catch {
      setPhase('failed');
      setMessage('The recording could not be sent. Check your connection.');
    }
  }, [release, targetId]);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase('failed');
      setMessage('This device cannot record audio, or the page is not on a secure address.');
      return;
    }

    setPhase('requesting');
    setMessage(null);
    setSeconds(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      contextRef.current = context;

      const source = context.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated in favour of AudioWorklet, but a worklet
      // needs a separate module file served over the network — and this has to
      // work on a mid-range Android phone on a branch's patchy connection.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = context.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(context.destination);

      stopRef.current = () => {
        processor.disconnect();
        source.disconnect();
        processor.onaudioprocess = null;
      };

      setPhase('recording');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase('denied');
        setMessage(
          'Microphone access was refused. Allow it from the padlock in the address bar, then try again.',
        );
      } else {
        setPhase('failed');
        setMessage('The microphone could not be started. Another app may be using it.');
      }
    }
  }, []);

  // Stops itself rather than trusting a rep to notice a pocketed phone.
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) void finish();
  }, [phase, seconds, finish]);

  /*
    A column beside the field, not a labelled button above it.

    `self-stretch` is what makes the whole control exactly as tall as the
    textarea it sits next to — the mic grows to fill whatever height the field
    has and the counter takes the line underneath, so the two read as one
    element however many rows the caller asks for.
  */
  const shell =
    'relative flex w-12 shrink-0 select-none flex-col items-stretch gap-1 self-stretch';
  const face =
    'flex flex-1 items-center justify-center rounded-lg border transition-colors min-h-[2.25rem]';
  const caption = 'text-center text-[0.6875rem] leading-none tnum';

  if (!enabled) {
    return (
      <span className={shell}>
        <button
          type="button"
          disabled
          title={reason}
          aria-label={`Dictation unavailable. ${reason}`}
          className={`${face} cursor-not-allowed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)]`}
        >
          <MicIcon />
        </button>
        <span className={`${caption} text-[var(--color-text-subtle)]`} title={reason}>
          off
        </span>
      </span>
    );
  }

  const recording = phase === 'recording';
  const busy = phase === 'working' || phase === 'requesting';
  const remaining = Math.max(0, MAX_SECONDS - seconds);

  return (
    <span className={shell}>
      <button
        type="button"
        onClick={() => void (recording ? finish() : start())}
        disabled={busy}
        title={recording ? 'Stop and insert the note' : 'Dictate a note — 10 seconds'}
        /*
          The label carries the state in words, because the colour cannot. Green
          against red is the single commonest form of colour blindness, and this
          control is now an icon with no text on it — so what a screen reader
          announces is the only description some people get.
        */
        aria-label={
          recording
            ? `Recording, ${remaining} seconds left. Stop and insert the note.`
            : phase === 'working'
              ? 'Transcribing the recording'
              : phase === 'requesting'
                ? 'Starting the microphone'
                : 'Dictate a note, up to 10 seconds'
        }
        className={`${face} ${
          recording
            ? 'border-danger-500 bg-danger-500 text-white'
            : busy
              ? 'border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)]'
              : 'border-teal-500 bg-teal-500 text-white hover:bg-teal-600'
        }`}
      >
        <MicIcon />
      </button>

      <span
        role={recording ? 'timer' : undefined}
        aria-live={recording ? 'off' : undefined}
        className={`${caption} ${
          recording
            ? 'font-bold text-danger-600 dark:text-danger-400'
            : 'text-[var(--color-text-subtle)]'
        }`}
      >
        {/* Counts down, so the number answers "how long have I got" rather than
            "how long have I been going" — the only one of the two a speaker can
            act on. */}
        {recording
          ? `${remaining}s`
          : phase === 'working'
            ? '…'
            : phase === 'requesting'
              ? '·'
              : `${MAX_SECONDS}s`}
      </span>

      {/*
        Out of the column's flow on purpose. "The microphone is blocked for this
        site" does not fit in three rem, and a refusal the rep cannot read is a
        refusal they will report as the button being broken.
      */}
      {message ? (
        <span
          role="status"
          className={`absolute right-0 top-full z-10 mt-1 w-48 text-right text-[0.6875rem] leading-tight ${
            phase === 'failed' || phase === 'denied'
              ? 'text-danger-500'
              : 'text-[var(--color-text-subtle)]'
          }`}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Float samples to a 16-bit mono WAV.
 *
 * Written out by hand because the alternative is shipping an encoder library to
 * do forty lines of header work, on a page a rep loads over mobile data.
 */
function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, 'data');
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      // Clamped before scaling: a sample outside [-1, 1] would wrap and arrive
      // as a loud click rather than clipping quietly.
      const sample = Math.max(-1, Math.min(1, chunk[i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Sized for the box it now sits in, not the one it came from.
 *
 * Thirteen pixels was right beside the word "Dictate"; alone in a full-height
 * tile it read as a speck. The mic is the only thing identifying this control
 * now that the label has gone, so it is drawn at a size somebody can recognise
 * with a thumb over it.
 */
function MicIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
      <path d="M12 17v4" strokeLinecap="round" />
      <path d="M8.5 21h7" strokeLinecap="round" />
    </svg>
  );
}
