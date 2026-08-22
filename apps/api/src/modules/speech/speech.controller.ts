import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequirePermissions } from '../../common/decorators';
import { TRANSCRIBER, type Transcriber } from './speech.types';

interface UploadedAudio {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Audio formats the speech provider accepts. WAV first because that is what the
 * browser recorder produces: encoding to WAV client-side removes any dependence
 * on which container a given phone's MediaRecorder happens to emit.
 */
const ALLOWED_AUDIO = new Set(['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm']);

/**
 * Two minutes of 16 kHz mono WAV is roughly 3.8 MB. The cap is both a cost
 * control — this is billed per second of audio — and a guard against somebody
 * posting an hour of ambient recording from a pocket.
 */
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

@ApiTags('speech')
@ApiBearerAuth()
@Controller('speech')
export class SpeechController {
  constructor(@Inject(TRANSCRIBER) private readonly transcriber: Transcriber) {}

  /**
   * Turns a spoken note into English text.
   *
   * Proxied through the API rather than called from the browser, for the same
   * reason as geocoding: the provider key would otherwise be extractable from a
   * phone, on an account SIHL is billed for by the second.
   *
   * Throttled per user. A stuck client retrying in a loop is a bill.
   */
  @Post('transcribe')
  @RequirePermissions('lead:update')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: { audio: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Transcribe a spoken note and translate it to English',
    description:
      'Returns { text, languageCode }. An empty string means nothing intelligible was said, ' +
      'which is a normal outcome rather than an error.',
  })
  async transcribe(
    @UploadedFile() audio: UploadedAudio | undefined,
  ): Promise<{ text: string; languageCode: string | null; provider: string }> {
    if (!audio) {
      throw new BadRequestException({ title: 'No recording supplied' });
    }

    if (!ALLOWED_AUDIO.has(audio.mimetype)) {
      throw new BadRequestException({
        title: 'Unsupported audio format',
        detail: `${audio.mimetype} cannot be transcribed. Record again from the app.`,
      });
    }

    const result = await this.transcriber.transcribe({
      audio: audio.buffer,
      contentType: audio.mimetype,
      fileName: audio.originalname || 'note.wav',
    });

    return { ...result, provider: this.transcriber.name };
  }
}
