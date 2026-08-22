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
/** Guard against a pocket recording: the button also stops itself here. */
const MAX_SECONDS = 120;

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

  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled
          title={reason}
          aria-label={`Dictation unavailable. ${reason}`}
          className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 text-xs font-semibold text-[var(--color-text-subtle)] opacity-70"
        >
          <MicIcon />
          <span>Dictate</span>
        </button>
        <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">Coming soon</span>
      </span>
    );
  }

  const recording = phase === 'recording';
  const busy = phase === 'working' || phase === 'requesting';

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => void (recording ? finish() : start())}
        disabled={busy}
        aria-label={recording ? 'Stop recording and insert the note' : 'Dictate a note'}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors ${
          recording
            ? 'border-danger-500 bg-danger-500 text-white'
            : 'border-teal-500 text-teal-600 hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-900/30'
        }`}
      >
        <MicIcon />
        {/* The word carries the state, not the colour alone. */}
        <span>
          {recording
            ? `Stop ${formatSeconds(seconds)}`
            : phase === 'working'
              ? 'Transcribing…'
              : phase === 'requesting'
                ? 'Starting…'
                : 'Dictate'}
        </span>
      </button>

      {recording ? (
        <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">
          Speak in any language — the note is saved in English
        </span>
      ) : null}

      {message ? (
        <span
          role="status"
          className={`w-full text-right text-[0.6875rem] ${
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

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
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

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
      <path d="M12 17v4" strokeLinecap="round" />
    </svg>
  );
}
