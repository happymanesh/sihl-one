import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  QUESTION_LANGUAGES,
  createQuestionSchema,
  createQuestionSetSchema,
  questionQuerySchema,
  translateQuestionSchema,
  updateQuestionSchema,
  updateQuestionSetSchema,
  upsertTranslationSchema,
  type CreateQuestionInput,
  type CreateQuestionSetInput,
  type QuestionLanguage,
  type QuestionQuery,
  type TranslateQuestionInput,
  type UpdateQuestionInput,
  type UpdateQuestionSetInput,
  type UpsertTranslationInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { QuestionsService } from './questions.service';
import { TranslatorService } from './translator.service';

/**
 * The question bank, under Training & Test.
 *
 * Everything here is `test:manage`, reading included — unlike training, which
 * is announced to the people expected to attend. A question carries its own
 * answer, so an open bank is an open answer key.
 */
@ApiTags('Question bank')
@ApiBearerAuth()
@Controller('questions')
export class QuestionsController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly translator: TranslatorService,
  ) {}

  @Get()
  @RequirePermissions('test:manage')
  @ApiOperation({ summary: 'Search the bank' })
  list(@Query(new ZodValidationPipe(questionQuerySchema)) query: QuestionQuery) {
    return this.questions.list(query);
  }

  @Get('languages')
  @RequirePermissions('test:manage')
  @ApiOperation({
    summary: 'Languages offered, and whether drafting is available',
    description:
      '`translationAvailable` is false when no provider is configured, so the screen hides the ' +
      'Translate button rather than offering one that always fails.',
  })
  languages(): { languages: readonly string[]; translationAvailable: boolean } {
    return {
      languages: QUESTION_LANGUAGES,
      translationAvailable: this.translator.available,
    };
  }

  @Get('availability')
  @RequirePermissions('test:manage')
  @ApiOperation({
    summary: 'What a test could draw on, per product',
    description:
      'Counted from the questions, not from the sets: a set is optional, and counting only set ' +
      'members made a bank holding usable questions report nothing at all.',
  })
  availability(@Query('productId') productId?: string) {
    return this.questions.availability(productId || undefined);
  }

  @Get('sets')
  @RequirePermissions('test:manage')
  @ApiOperation({
    summary: 'Question sets, with how many questions each has per language',
    description:
      'The per-language count is what the test form checks before it will let a test be ' +
      'published: forty English questions build no Gujarati paper.',
  })
  listSets(@Query('productId') productId?: string) {
    return this.questions.listSets(productId || undefined);
  }

  @Post('sets')
  @RequirePermissions('test:manage')
  @ApiOperation({ summary: 'Create a question set' })
  @ApiZodBody(createQuestionSetSchema)
  createSet(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createQuestionSetSchema) body: CreateQuestionSetInput,
  ) {
    return this.questions.createSet(user, body);
  }

  @Patch('sets/:id')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Rename a set, or retire it' })
  @ApiZodBody(updateQuestionSetSchema)
  updateSet(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateQuestionSetSchema) body: UpdateQuestionSetInput,
  ) {
    return this.questions.updateSet(user, id, body);
  }

  @Get(':id')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'One question, with every wording it has' })
  findOne(@Param('id', IdParamPipe) id: string) {
    return this.questions.findOne(id);
  }

  @Post()
  @RequirePermissions('test:manage')
  @ApiOperation({ summary: 'Add a question in its source language' })
  @ApiZodBody(createQuestionSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createQuestionSchema) body: CreateQuestionInput,
  ) {
    return this.questions.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Edit a question, or retire it',
    description:
      'Edits reach future tests only. A test that has already been published holds its own ' +
      'frozen copy of the wording and the answer, so nothing here can move a past result.',
  })
  @ApiZodBody(updateQuestionSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateQuestionSchema) body: UpdateQuestionInput,
  ) {
    return this.questions.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('test:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Remove a question no test has used',
    description: 'Refused once any published test holds a copy — retire it instead.',
  })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.questions.remove(user, id);
  }

  @Post(':id/translate')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Draft this question in another language',
    description:
      'Saves the result as a DRAFT. A draft is drawn by no test until somebody opens it, reads ' +
      'it and saves it — the answer key was written against the source wording, and that review ' +
      'is what makes automatic translation safe to use on exam content.',
  })
  @ApiZodBody(translateQuestionSchema)
  translate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(translateQuestionSchema) body: TranslateQuestionInput,
  ) {
    return this.questions.translate(user, id, body);
  }

  @Patch(':id/translation')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Save one language’s wording',
    description: 'Submitting it approves it: the person saving is the person vouching for it.',
  })
  @ApiZodBody(upsertTranslationSchema)
  upsertTranslation(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(upsertTranslationSchema) body: UpsertTranslationInput,
  ) {
    return this.questions.upsertTranslation(user, id, body);
  }

  @Delete(':id/translation/:language')
  @RequirePermissions('test:manage')
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'language' })
  @ApiOperation({ summary: 'Drop one language’s wording' })
  removeTranslation(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @Param('language') language: string,
  ) {
    return this.questions.removeTranslation(user, id, language as QuestionLanguage);
  }
}
