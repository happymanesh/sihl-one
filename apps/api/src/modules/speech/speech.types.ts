/**
 * Turning a rep's spoken note into English text.
 *
 * A seam with a disabled default, like the malware scanner and the geocoder.
 * The reps were told dictation is coming, so the control is visible either way;
 * what changes is whether it does anything, and that is configuration rather
 * than a release.
 */
export interface Transcriber {
  readonly name: string;

  /**
   * Transcribes speech and returns English.
   *
   * Throws only for genuine faults. An empty transcript is a normal outcome —
   * somebody tapped the button and said nothing, or the room was too loud — and
   * the caller reports that rather than treating it as an error.
   */
  transcribe(input: {
    audio: Buffer;
    contentType: string;
    fileName: string;
  }): Promise<TranscriptionResult>;
}

export interface TranscriptionResult {
  /** English text. Empty when nothing intelligible was said. */
  text: string;
  /** The language the speaker used, as reported by the provider. */
  languageCode: string | null;
}

export const TRANSCRIBER = 'TRANSCRIBER';
