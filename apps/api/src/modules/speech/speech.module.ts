import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { SpeechController } from './speech.controller';
import { DisabledTranscriber, SarvamTranscriber } from './transcribers';
import { TRANSCRIBER } from './speech.types';

/**
 * Speech wiring. Provider chosen from configuration and injected by token, so
 * switching one on — or changing vendor — is an environment change.
 */
@Global()
@Module({
  controllers: [SpeechController],
  providers: [
    {
      provide: TRANSCRIBER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.speech.provider !== 'sarvam') return new DisabledTranscriber();

        // The key is guaranteed by the configuration validator, which refuses
        // this provider without one.
        return new SarvamTranscriber(
          config.speech.sarvam.apiKey!,
          config.speech.sarvam.model,
          config.speech.sarvam.endpoint,
          config.speech.timeoutMs,
        );
      },
    },
  ],
  exports: [TRANSCRIBER],
})
export class SpeechModule {}
