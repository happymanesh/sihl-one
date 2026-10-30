import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  SARVAM_LANGUAGE_CODES,
  type QuestionLanguage,
  type QuestionWording,
} from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';

/**
 * Drafts a question's wording in another language.
 *
 * Sarvam again, the same vendor and the same key as dictation: an Indian
 * provider, so SIHL's exam content stays with an Indian company, and nothing
 * new to procure.
 *
 * What this deliberately is not: a translation layer at exam time. Everything
 * it returns is a **draft** that a person has to read and save before any test
 * can draw on it. Two reasons, both from the spec rather than taste. The
 * answer key is written against the source wording, and regulatory language
 * is where machine translation quietly goes wrong — "may" for "must", a loose
 * rendering of a defined term. And §2 asks that a past result be
 * reproducible, which it cannot be if the paper is generated afresh each time
 * somebody opens it.
 *
 * So this writes nothing. It hands text back to the screen, and the screen
 * asks a person.
 */
@Injectable()
export class TranslatorService {
  private readonly logger = new Logger(TranslatorService.name);
  private warned = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Whether the screen should offer the button at all. */
  get available(): boolean {
    const speech = this.config.speech;
    return speech.provider === 'sarvam' && Boolean(speech.sarvam.apiKey);
  }

  /**
   * A draft of every field, in `target`.
   *
   * The five pieces go as five calls rather than one concatenated blob: a
   * question and its options are separate sentences, and joining them with a
   * separator invites the model to merge, reorder or drop one — which would
   * silently move the answer, since the answer is a position.
   */
  async draft(
    wording: QuestionWording,
    source: QuestionLanguage,
    target: QuestionLanguage,
  ): Promise<QuestionWording> {
    if (!this.available) {
      if (!this.warned) {
        this.logger.warn(
          'No translation provider configured. The Translate button is hidden. Set ' +
            'SPEECH_PROVIDER=sarvam with SARVAM_API_KEY to enable it.',
        );
        this.warned = true;
      }
      throw new ServiceUnavailableException({
        title: 'Translation is not switched on',
        detail: 'Type the wording for this language for now.',
      });
    }

    const [text, optionA, optionB, optionC, optionD, explanation] = await Promise.all([
      this.one(wording.text, source, target),
      this.one(wording.optionA, source, target),
      this.one(wording.optionB, source, target),
      this.one(wording.optionC, source, target),
      this.one(wording.optionD, source, target),
      wording.explanation ? this.one(wording.explanation, source, target) : Promise.resolve(''),
    ]);

    return {
      text,
      optionA,
      optionB,
      optionC,
      optionD,
      explanation: explanation || undefined,
    };
  }

  private async one(
    input: string,
    source: QuestionLanguage,
    target: QuestionLanguage,
  ): Promise<string> {
    const { sarvam, timeoutMs } = this.config.speech;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(sarvam.translateEndpoint, {
        method: 'POST',
        headers: {
          'api-subscription-key': sarvam.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          source_language_code: SARVAM_LANGUAGE_CODES[source],
          target_language_code: SARVAM_LANGUAGE_CODES[target],
          model: sarvam.translateModel,
          // Exam wording, so the formal register rather than the colloquial
          // one the default would pick.
          mode: 'formal',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The provider's own message is logged but not passed on: it is
        // written for us, not for whoever is drafting a question.
        this.logger.warn(
          `Sarvam translate returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
        throw new ServiceUnavailableException({
          title: 'Translation did not come back',
          detail: 'Try again, or type the wording for this language.',
        });
      }

      const body = (await response.json()) as { translated_text?: string };
      const translated = body.translated_text?.trim();

      if (!translated) {
        throw new ServiceUnavailableException({
          title: 'Translation came back empty',
          detail: 'Type the wording for this language.',
        });
      }

      return translated;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // An abort lands here too, which is the common case worth naming.
      this.logger.warn(`Sarvam translate failed: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Translation did not come back',
        detail: 'Try again, or type the wording for this language.',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
