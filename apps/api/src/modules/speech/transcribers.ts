import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { Transcriber, TranscriptionResult } from './speech.types';

/**
 * No speech service configured.
 *
 * Refuses rather than returning empty text: unlike a missing street address,
 * silence here is indistinguishable from "the service ate my note", and a rep
 * who dictated two minutes of detail deserves to be told it went nowhere.
 */
@Injectable()
export class DisabledTranscriber implements Transcriber {
  readonly name = 'disabled';
  private readonly logger = new Logger(DisabledTranscriber.name);
  private warned = false;

  async transcribe(): Promise<TranscriptionResult> {
    if (!this.warned) {
      this.logger.warn(
        'No speech provider configured. Dictation is shown as unavailable. Set ' +
          'SPEECH_PROVIDER=sarvam with a key to enable it.',
      );
      this.warned = true;
    }

    throw new ServiceUnavailableException({
      title: 'Dictation is not switched on',
      detail: 'Type the note for now. This will be enabled shortly.',
    });
  }
}

/**
 * Sarvam AI — speech to text and translation in one call.
 *
 * Chosen for the same reason as Mappls: an Indian provider, so a recording of a
 * rep discussing a named client stays with an Indian company. Their
 * `speech-to-text-translate` endpoint takes audio in any of the ten languages
 * the business asked for and returns English, which is what the business
 * actually wanted — a manager should be able to read every note without
 * speaking Gujarati.
 *
 * Billed per second of audio, so a note is fractions of a rupee. That is only
 * true while the browser sends short recordings; the size cap on the controller
 * is what keeps it true.
 */
@Injectable()
export class SarvamTranscriber implements Transcriber {
  readonly name = 'sarvam';
  private readonly logger = new Logger(SarvamTranscriber.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly endpoint: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe(input: {
    audio: Buffer;
    contentType: string;
    fileName: string;
  }): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('file', new Blob([input.audio], { type: input.contentType }), input.fileName);
    form.append('model', this.model);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        // Their own header name, not an Authorization bearer.
        headers: { 'api-subscription-key': this.apiKey },
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        // The provider's own message is genuinely useful here — it names the
        // unsupported format or the retired model — so it is logged in full and
        // summarised to the caller rather than swallowed.
        const detail = await response.text().catch(() => '');
        this.logger.warn(`Sarvam returned ${response.status}: ${detail.slice(0, 300)}`);

        throw new ServiceUnavailableException({
          title: 'The note could not be transcribed',
          detail:
            response.status === 401 || response.status === 403
              ? 'The speech service rejected our credentials. Type the note and tell an administrator.'
              : 'The speech service could not process that recording. Try again, or type the note.',
        });
      }

      const body = (await response.json()) as {
        transcript?: string;
        language_code?: string | null;
      };

      return {
        text: (body.transcript ?? '').trim(),
        languageCode: body.language_code ?? null,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Sarvam request failed: ${reason}`);

      throw new ServiceUnavailableException({
        title: 'The note could not be transcribed',
        detail:
          reason.includes('abort') || reason.includes('timeout')
            ? 'The speech service took too long. Try a shorter recording, or type the note.'
            : 'The speech service could not be reached. Type the note for now.',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
