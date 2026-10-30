import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  QUESTION_LANGUAGES,
  canDeleteQuestion,
  type AnswerKey,
  type CreateQuestionInput,
  type CreateQuestionSetInput,
  type QuestionLanguage,
  type QuestionAvailability,
  type QuestionQuery,
  type QuestionSetView,
  type QuestionView,
  type TranslateQuestionInput,
  type TranslationStatus,
  type UpdateQuestionInput,
  type UpdateQuestionSetInput,
  type UpsertTranslationInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { TranslatorService } from './translator.service';

/**
 * The question bank.
 *
 * A question is one thing asked in several languages. The answer key, the
 * marks and the product live on the question; only the wording varies, which
 * is what makes it impossible for the Hindi and the English to disagree about
 * which option is right.
 *
 * Nothing here can move a past exam result. A published test freezes its own
 * copy of every question it draws, so editing a bank row reaches future tests
 * only — and once any test holds a copy, deletion becomes retirement.
 */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translator: TranslatorService,
    private readonly audit: AuditService,
  ) {}

  private readonly include = {
    product: { select: { id: true, name: true, group: { select: { name: true } } } },
    questionSet: { select: { id: true, name: true } },
    translations: {
      include: { approvedBy: { select: { firstName: true, lastName: true } } },
    },
    createdBy: { select: { firstName: true, lastName: true } },
  };

  private view(row: {
    id: string;
    sourceLanguage: string;
    correctAnswer: string;
    marks: unknown;
    negativeMarks: unknown;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    product: { id: string; name: string; group: { name: string } | null };
    questionSet: { id: string; name: string } | null;
    createdBy: { firstName: string; lastName: string };
    translations: Array<{
      language: string;
      text: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      explanation: string | null;
      status: string;
      approvedAt: Date | null;
      updatedAt: Date;
      approvedBy: { firstName: string; lastName: string } | null;
    }>;
  }): QuestionView {
    // Held as DECIMAL so a half-mark question is exact; the screen wants a
    // number, and these are small enough that the conversion is lossless.
    const toNumber = (value: unknown): number => Number(value);

    return {
      id: row.id,
      sourceLanguage: row.sourceLanguage as QuestionLanguage,
      correctAnswer: row.correctAnswer as AnswerKey,
      marks: toNumber(row.marks),
      negativeMarks: toNumber(row.negativeMarks),
      isActive: row.isActive,
      product: {
        id: row.product.id,
        name: row.product.name,
        groupName: row.product.group?.name ?? null,
      },
      questionSet: row.questionSet,
      translations: QUESTION_LANGUAGES.flatMap((language) => {
        const wording = row.translations.find((item) => item.language === language);
        if (!wording) return [];
        return [
          {
            language,
            text: wording.text,
            optionA: wording.optionA,
            optionB: wording.optionB,
            optionC: wording.optionC,
            optionD: wording.optionD,
            explanation: wording.explanation ?? undefined,
            status: wording.status as TranslationStatus,
            approvedBy: wording.approvedBy
              ? `${wording.approvedBy.firstName} ${wording.approvedBy.lastName}`.trim()
              : null,
            approvedAt: wording.approvedAt?.toISOString() ?? null,
            updatedAt: wording.updatedAt.toISOString(),
          },
        ];
      }),
      // Zero until the test module lands. Stated rather than omitted so the
      // screen's delete-or-retire logic is already reading the right field,
      // and starts telling the truth the moment tests exist.
      usedInTests: 0,
      createdBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(
    query: QuestionQuery,
  ): Promise<{ items: QuestionView[]; total: number; page: number; pageSize: number }> {
    const where = {
      ...(query.includeRetired ? {} : { isActive: true }),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.questionSetId ? { questionSetId: query.questionSetId } : {}),
      /*
        Language and review state both filter on the wording, not the
        question — "show me the Gujarati bank" means the questions that have
        a Gujarati wording, and "needs review" means the ones carrying a
        draft somebody has not read yet.
      */
      ...(query.language
        ? { translations: { some: { language: query.language, status: 'APPROVED' } } }
        : {}),
      ...(query.needsReview ? { translations: { some: { status: 'DRAFT' } } } : {}),
      ...(query.q
        ? { translations: { some: { text: { contains: query.q, mode: 'insensitive' as const } } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: this.include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.view(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findOne(id: string): Promise<QuestionView> {
    const row = await this.prisma.question.findUnique({ where: { id }, include: this.include });
    if (!row) throw new NotFoundException({ title: 'Question not found' });
    return this.view(row);
  }

  async create(user: AuthenticatedPrincipal, input: CreateQuestionInput): Promise<QuestionView> {
    await this.assertSetBelongsToProduct(input.productId, input.questionSetId);

    const created = await this.prisma.question.create({
      data: {
        productId: input.productId,
        questionSetId: input.questionSetId ?? null,
        sourceLanguage: input.sourceLanguage,
        correctAnswer: input.correctAnswer,
        marks: input.marks,
        negativeMarks: input.negativeMarks,
        createdById: user.id,
        translations: {
          create: {
            language: input.sourceLanguage,
            ...input.wording,
            explanation: input.wording.explanation ?? null,
            // Typed by hand, so its author is its reviewer.
            status: 'APPROVED',
            approvedById: user.id,
            approvedAt: new Date(),
          },
        },
      },
      include: this.include,
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'question',
      resourceId: created.id,
      changes: { productId: input.productId, language: input.sourceLanguage },
    });

    return this.view(created);
  }

  async update(
    user: AuthenticatedPrincipal,
    id: string,
    input: UpdateQuestionInput,
  ): Promise<QuestionView> {
    const existing = await this.prisma.question.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ title: 'Question not found' });

    if (input.productId || input.questionSetId !== undefined) {
      await this.assertSetBelongsToProduct(
        input.productId ?? existing.productId,
        input.questionSetId,
      );
    }

    await this.prisma.question.update({
      where: { id },
      data: {
        ...(input.productId !== undefined ? { productId: input.productId } : {}),
        ...(input.questionSetId !== undefined
          ? { questionSetId: input.questionSetId || null }
          : {}),
        ...(input.correctAnswer !== undefined ? { correctAnswer: input.correctAnswer } : {}),
        ...(input.marks !== undefined ? { marks: input.marks } : {}),
        ...(input.negativeMarks !== undefined ? { negativeMarks: input.negativeMarks } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    // The source wording travels with the question rather than through the
    // translation route, so editing a question and its own words is one save.
    if (input.wording) {
      await this.saveWording(
        user,
        id,
        (input.sourceLanguage ?? existing.sourceLanguage) as QuestionLanguage,
        { ...input.wording, machineDraft: false },
      );
    }

    await this.audit.record({
      action: 'UPDATE',
      resource: 'question',
      resourceId: id,
      changes: {
        ...(input.correctAnswer !== undefined
          ? { correctAnswer: { from: existing.correctAnswer, to: input.correctAnswer } }
          : {}),
        ...(input.isActive !== undefined
          ? { isActive: { from: existing.isActive, to: input.isActive } }
          : {}),
      },
    });

    return this.findOne(id);
  }

  /**
   * Remove a question nothing has used.
   *
   * Hard delete only while `usedInTests` is zero. Afterwards the route
   * refuses and retiring is the way to take it out of circulation — the test
   * carries its own frozen copy, so deleting the bank row would change no
   * past result and would only lose the question for everyone writing new
   * tests.
   */
  async remove(user: AuthenticatedPrincipal, id: string): Promise<void> {
    const existing = await this.findOne(id);

    if (!canDeleteQuestion(existing.usedInTests)) {
      throw new BadRequestException({
        title: 'This question has been used',
        detail:
          `It is part of ${existing.usedInTests} published test(s). Retire it instead — it ` +
          'will not appear in any new test, and the ones already sat keep their own copy.',
      });
    }

    // Wordings go with it: the cascade is declared on the foreign key, and a
    // wording has no meaning without the question it words.
    await this.prisma.question.delete({ where: { id } });

    await this.audit.record({
      action: 'DELETE',
      resource: 'question',
      resourceId: id,
      changes: { productId: existing.product.id },
    });
  }

  /**
   * A machine draft of this question in another language.
   *
   * Writes it as DRAFT rather than returning it unsaved, so the work is not
   * lost if the author closes the tab — but a draft is drawn by no test until
   * somebody opens it, reads it and saves it. That review is the whole reason
   * automatic translation is safe to offer for exam content.
   */
  async translate(
    user: AuthenticatedPrincipal,
    id: string,
    input: TranslateQuestionInput,
  ): Promise<QuestionView> {
    const question = await this.findOne(id);

    if (input.targetLanguage === question.sourceLanguage) {
      throw new BadRequestException({
        title: 'That is the source language',
        detail: 'Pick a language other than the one the question was written in.',
      });
    }

    const source = question.translations.find(
      (wording) => wording.language === question.sourceLanguage,
    );
    if (!source) {
      throw new BadRequestException({
        title: 'Nothing to translate from',
        detail: 'This question has no wording in its source language.',
      });
    }

    const existing = question.translations.find(
      (wording) => wording.language === input.targetLanguage,
    );
    if (existing?.status === 'APPROVED') {
      throw new BadRequestException({
        title: 'That wording is already approved',
        detail:
          'Translating again would replace text a person has signed off. Edit it directly, or ' +
          'clear it first.',
      });
    }

    const draft = await this.translator.draft(
      source,
      question.sourceLanguage,
      input.targetLanguage,
    );

    await this.saveWording(user, id, input.targetLanguage, { ...draft, machineDraft: true });

    await this.audit.record({
      action: 'CREATE',
      resource: 'question.translation',
      resourceId: id,
      changes: { language: input.targetLanguage, machineDraft: true },
    });

    return this.findOne(id);
  }

  /** Save one language's wording, by hand or after checking a draft. */
  async upsertTranslation(
    user: AuthenticatedPrincipal,
    id: string,
    input: UpsertTranslationInput,
  ): Promise<QuestionView> {
    await this.findOne(id);
    await this.saveWording(user, id, input.language, input);

    await this.audit.record({
      action: 'UPDATE',
      resource: 'question.translation',
      resourceId: id,
      changes: { language: input.language, approved: !input.machineDraft },
    });

    return this.findOne(id);
  }

  /** Drop one language's wording. The source language cannot be dropped. */
  async removeTranslation(
    user: AuthenticatedPrincipal,
    id: string,
    language: QuestionLanguage,
  ): Promise<QuestionView> {
    const question = await this.findOne(id);

    if (language === question.sourceLanguage) {
      throw new BadRequestException({
        title: 'That is the source language',
        detail:
          'A question cannot lose the wording it was written in. Delete the question instead.',
      });
    }

    await this.prisma.questionTranslation.deleteMany({ where: { questionId: id, language } });

    await this.audit.record({
      action: 'DELETE',
      resource: 'question.translation',
      resourceId: id,
      changes: { language },
    });

    return this.findOne(id);
  }

  /**
   * Write one wording, creating or replacing.
   *
   * One place, so the approval stamp cannot be set by one path and forgotten
   * by another — which is exactly how an unreviewed draft would end up
   * counting as approved.
   */
  private async saveWording(
    user: AuthenticatedPrincipal,
    questionId: string,
    language: QuestionLanguage,
    input: {
      text: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      explanation?: string;
      machineDraft: boolean;
    },
  ): Promise<void> {
    const approval = input.machineDraft
      ? { status: 'DRAFT', approvedById: null, approvedAt: null }
      : { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() };

    const wording = {
      text: input.text,
      optionA: input.optionA,
      optionB: input.optionB,
      optionC: input.optionC,
      optionD: input.optionD,
      explanation: input.explanation ?? null,
    };

    await this.prisma.questionTranslation.upsert({
      where: { questionId_language: { questionId, language } },
      update: { ...wording, ...approval },
      create: { questionId, language, ...wording, ...approval },
    });
  }

  // ---------------------------------------------------------------- sets

  async listSets(productId?: string): Promise<QuestionSetView[]> {
    const rows = await this.prisma.questionSet.findMany({
      where: { ...(productId ? { productId } : {}), isActive: true },
      include: {
        product: { select: { id: true, name: true } },
        questions: {
          where: { isActive: true },
          select: { translations: { select: { language: true, status: true } } },
        },
      },
      orderBy: [{ productId: 'asc' }, { name: 'asc' }],
    });

    return rows.map((row) => {
      /*
        Counted per language, because that is the number a test depends on:
        forty English questions build no Gujarati paper. Only approved
        wordings count — a draft is not something an exam may draw on.
      */
      const availableByLanguage = Object.fromEntries(
        QUESTION_LANGUAGES.map((language) => [
          language,
          row.questions.filter((question) =>
            question.translations.some(
              (wording) => wording.language === language && wording.status === 'APPROVED',
            ),
          ).length,
        ]),
      ) as QuestionSetView['availableByLanguage'];

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: row.isActive,
        product: row.product,
        availableByLanguage,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /**
   * What a test could draw on, per product.
   *
   * Counted from the questions rather than from the sets, because a set is
   * optional and most banks begin without one. Counting only set members made
   * a bank holding two usable questions report nothing at all, and left the
   * screen with no way to explain why no test could be built from them.
   */
  async availability(productId?: string): Promise<QuestionAvailability[]> {
    const rows = await this.prisma.question.findMany({
      where: { isActive: true, ...(productId ? { productId } : {}) },
      select: {
        product: { select: { id: true, name: true } },
        questionSet: { select: { id: true, name: true } },
        translations: { select: { language: true, status: true } },
      },
    });

    const countable = (
      questions: Array<{ translations: Array<{ language: string; status: string }> }>,
    ) =>
      Object.fromEntries(
        QUESTION_LANGUAGES.map((language) => [
          language,
          questions.filter((question) =>
            question.translations.some(
              (wording) => wording.language === language && wording.status === 'APPROVED',
            ),
          ).length,
        ]),
      ) as Record<QuestionLanguage, number>;

    const byProduct = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byProduct.get(row.product.id);
      if (bucket) bucket.push(row);
      else byProduct.set(row.product.id, [row]);
    }

    return [...byProduct.values()]
      .map((questions) => {
        const sets = new Map<string, { set: { id: string; name: string }; rows: typeof rows }>();
        for (const row of questions) {
          if (!row.questionSet) continue;
          const bucket = sets.get(row.questionSet.id);
          if (bucket) bucket.rows.push(row);
          else sets.set(row.questionSet.id, { set: row.questionSet, rows: [row] });
        }

        return {
          product: questions[0].product,
          byLanguage: countable(questions),
          inSets: [...sets.values()].map((entry) => ({
            set: entry.set,
            byLanguage: countable(entry.rows),
          })),
          looseByLanguage: countable(questions.filter((row) => !row.questionSet)),
        };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }

  async createSet(
    user: AuthenticatedPrincipal,
    input: CreateQuestionSetInput,
  ): Promise<QuestionSetView> {
    const clash = await this.prisma.questionSet.findFirst({
      where: { productId: input.productId, name: input.name },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        title: 'That set already exists',
        detail: 'This product already has a set by that name.',
      });
    }

    const created = await this.prisma.questionSet.create({
      data: {
        productId: input.productId,
        name: input.name,
        description: input.description ?? null,
        createdById: user.id,
      },
      select: { id: true },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'question-set',
      resourceId: created.id,
      changes: { name: input.name, productId: input.productId },
    });

    const sets = await this.listSets(input.productId);
    return sets.find((set) => set.id === created.id)!;
  }

  async updateSet(
    user: AuthenticatedPrincipal,
    id: string,
    input: UpdateQuestionSetInput,
  ): Promise<QuestionSetView> {
    const existing = await this.prisma.questionSet.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ title: 'Question set not found' });

    await this.prisma.questionSet.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'question-set',
      resourceId: id,
      changes: {
        ...(input.name !== undefined ? { name: { from: existing.name, to: input.name } } : {}),
      },
    });

    const sets = await this.listSets(existing.productId);
    return sets.find((set) => set.id === id)!;
  }

  /**
   * A set must belong to the product its questions are filed under.
   *
   * Without this a question could sit in "Equity" while its set sits under
   * "Mutual Funds", and the per-product counts a test is validated against
   * would quietly disagree with the bank.
   */
  private async assertSetBelongsToProduct(
    productId: string,
    questionSetId?: string | null,
  ): Promise<void> {
    if (!questionSetId) return;

    const set = await this.prisma.questionSet.findUnique({
      where: { id: questionSetId },
      select: { productId: true },
    });
    if (!set) throw new BadRequestException({ title: 'Question set not found' });

    if (set.productId !== productId) {
      throw new BadRequestException({
        title: 'That set belongs to another product',
        detail: 'Choose a set filed under the same product as the question.',
      });
    }
  }
}
