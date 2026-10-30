import { Module } from '@nestjs/common';

import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { TranslatorService } from './translator.service';

/**
 * The question bank.
 *
 * Exported because the test module will draw on it: publishing a test freezes
 * a copy of every question it selects, and the per-language availability
 * count is what decides whether a test can be published at all.
 */
@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService, TranslatorService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
