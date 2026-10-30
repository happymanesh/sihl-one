import { z } from 'zod';

import { idSchema } from './common';

/**
 * The question bank, under Training & Test.
 *
 * A bank, not a pile of test papers: a question belongs to a product and
 * optionally to a named set, and any number of tests draw from it. Questions
 * are deliberately never attached to a test, which would make them
 * unreusable — the thing a bank exists to prevent.
 *
 * A question is one thing asked in several languages, not several questions.
 * The answer key, the marks and the product live on the question; only the
 * wording varies by language. The alternative — a row per language — was
 * rejected because it makes the Hindi and the English strangers to each
 * other: fixing the answer on one silently leaves the other wrong, and no
 * report can tell you how people did on "that question" across both.
 *
 * The rule that shapes the rest of the module is that a question used in a
 * published test must not be editable in a way that moves a past result. That
 * is solved by freezing a copy onto the test at publish (see `TestQuestion`),
 * not by versioning rows here — so the bank row stays a plain, editable
 * record of what we ask today, and history lives with the test that asked it.
 */

/**
 * Languages a question may be worded in.
 *
 * Matches what Sarvam's translate endpoint covers, since that is what fills
 * the drafts. A closed list rather than free text, so "have we enough
 * questions to build this test in Gujarati" has something exact to count.
 */
export const QUESTION_LANGUAGES = ['EN', 'HI', 'GU', 'MR'] as const;
export type QuestionLanguage = (typeof QUESTION_LANGUAGES)[number];

export const QUESTION_LANGUAGE_NAMES: Record<QuestionLanguage, string> = {
  EN: 'English',
  HI: 'Hindi',
  GU: 'Gujarati',
  MR: 'Marathi',
};

/** Sarvam's own codes, for the translate call. */
export const SARVAM_LANGUAGE_CODES: Record<QuestionLanguage, string> = {
  EN: 'en-IN',
  HI: 'hi-IN',
  GU: 'gu-IN',
  MR: 'mr-IN',
};

/**
 * Which option is right, as a position rather than a copy of the text.
 *
 * Storing the answer as text invites it to drift from the option it names the
 * moment somebody fixes a typo in one and not the other. A position cannot
 * drift — and it is the same position in every language, which is exactly
 * what makes one shared answer key possible.
 */
export const ANSWER_KEYS = ['A', 'B', 'C', 'D'] as const;
export type AnswerKey = (typeof ANSWER_KEYS)[number];

/**
 * Whether a wording has been signed off by a person.
 *
 * A machine translation arrives as `DRAFT` and stays unusable until somebody
 * opens it, reads it and saves it. That gate is the whole reason automatic
 * translation is safe to offer here: the answer key was written against the
 * source wording, and regulatory language is exactly where machine
 * translation goes quietly wrong — "may" for "must", or a loose rendering of
 * a defined term like cooling-off period. A rep who fails on an ambiguous
 * sentence is a compliance record SIHL has to defend, and "the machine
 * translated it" is not a defence.
 *
 * Text typed by hand is `APPROVED` on save: its author is its reviewer.
 */
export const TRANSLATION_STATUSES = ['DRAFT', 'APPROVED'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export const questionWordingSchema = z.object({
  text: z.string().trim().min(10, 'Write the question out in full').max(2000),
  optionA: z.string().trim().min(1, 'Option A is required').max(500),
  optionB: z.string().trim().min(1, 'Option B is required').max(500),
  optionC: z.string().trim().min(1, 'Option C is required').max(500),
  optionD: z.string().trim().min(1, 'Option D is required').max(500),
  /** Shown after marking, so a wrong answer teaches something. */
  explanation: z.string().trim().max(2000).optional(),
});
export type QuestionWording = z.infer<typeof questionWordingSchema>;

export const createQuestionSchema = z.object({
  /** What it is about. Reuses the product master, sub-products included. */
  productId: idSchema,
  /** An optional named grouping inside a product, such as "AML — basics". */
  questionSetId: idSchema.optional(),
  /**
   * The language it was written in, and the one every translation is made
   * from. Authoritative if a translation and the source ever disagree.
   */
  sourceLanguage: z.enum(QUESTION_LANGUAGES).default('EN'),
  correctAnswer: z.enum(ANSWER_KEYS),
  marks: z.coerce.number().min(0.25).max(100).default(1),
  /**
   * Deducted for a wrong answer, as a positive number.
   *
   * Positive rather than negative so that "0.25" in the form means what the
   * person typing it expects. A sign convention that has to be explained is a
   * sign convention somebody will get backwards.
   */
  negativeMarks: z.coerce.number().min(0).max(100).default(0),
  /** The wording in the source language. Translations are added afterwards. */
  wording: questionWordingSchema,
});
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = createQuestionSchema.partial().extend({
  /**
   * Retire rather than delete, once a test has used it.
   *
   * A retired question is drawn by no new test and stays readable in every
   * old one. See `canDeleteQuestion`.
   */
  isActive: z.boolean().optional(),
});
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

/** Saving one language's wording, by hand or after checking a draft. */
export const upsertTranslationSchema = questionWordingSchema.extend({
  language: z.enum(QUESTION_LANGUAGES),
  /**
   * True only when the text came straight from the translator and nobody has
   * read it yet. The form that a person submits always sends false, because
   * submitting it is the act of approving it.
   */
  machineDraft: z.boolean().default(false),
});
export type UpsertTranslationInput = z.infer<typeof upsertTranslationSchema>;

/** Asking the translator for a draft. Writes nothing on its own. */
export const translateQuestionSchema = z.object({
  targetLanguage: z.enum(QUESTION_LANGUAGES),
});
export type TranslateQuestionInput = z.infer<typeof translateQuestionSchema>;

export interface QuestionTranslationView extends QuestionWording {
  language: QuestionLanguage;
  status: TranslationStatus;
  /** Who signed the wording off, and when. Null while it is still a draft. */
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
}

export interface QuestionView {
  id: string;
  sourceLanguage: QuestionLanguage;
  correctAnswer: AnswerKey;
  marks: number;
  negativeMarks: number;
  isActive: boolean;
  product: { id: string; name: string; groupName: string | null };
  questionSet: { id: string; name: string } | null;
  /** Every wording held, source included, newest first by language order. */
  translations: QuestionTranslationView[];
  /**
   * How many published tests have frozen a copy of this question.
   *
   * Drives the whole edit story on screen: at zero it can be deleted outright,
   * above zero it can only be retired, and an edit is explained as applying to
   * future tests alone.
   */
  usedInTests: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a question can be deleted outright rather than retired.
 *
 * Only while no published test holds a copy. After that there is nothing a
 * delete could usefully do — the test carries its own frozen text and answer
 * key, so removing the bank row would not change a single past result, and
 * would only lose the question for everyone still writing new tests.
 */
export function canDeleteQuestion(usedInTests: number): boolean {
  return usedInTests === 0;
}

/**
 * Whether this question can be put in a test sat in `language`.
 *
 * A draft translation does not count. This is the gate that keeps an
 * unreviewed machine rendering out of a live exam, and it is asked on the
 * test form rather than at exam time so the problem surfaces while somebody
 * can still fix it.
 */
export function isAvailableIn(
  question: Pick<QuestionView, 'isActive' | 'translations'>,
  language: QuestionLanguage,
): boolean {
  if (!question.isActive) return false;
  return question.translations.some(
    (wording) => wording.language === language && wording.status === 'APPROVED',
  );
}

/** An editable set a product's questions can be grouped into. */
export const createQuestionSetSchema = z.object({
  productId: idSchema,
  name: z.string().trim().min(3, 'Give the set a name').max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateQuestionSetInput = z.infer<typeof createQuestionSetSchema>;

export const updateQuestionSetSchema = createQuestionSetSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateQuestionSetInput = z.infer<typeof updateQuestionSetSchema>;

export interface QuestionSetView {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  product: { id: string; name: string };
  /**
   * Live questions in the set, counted per language.
   *
   * Per language because that is the number a test actually depends on: forty
   * English questions build no Gujarati paper. Only approved wordings count.
   */
  availableByLanguage: Record<QuestionLanguage, number>;
  createdAt: string;
}

/**
 * What a test could draw on, for one product and optionally one set within it.
 *
 * Counted per product rather than per set, because a set is optional and most
 * banks start without one. Counting only what sits in a set made a bank with
 * two perfectly good questions report nothing at all, and the screen then had
 * nothing to say about why no test could be built.
 *
 * `inSets` breaks the same total down, so the test form can say "40 for this
 * product, 12 of them in AML — basics" and a narrower test still knows what
 * it has.
 */
export interface QuestionAvailability {
  product: { id: string; name: string };
  /** Every live question under the product, approved, by language. */
  byLanguage: Record<QuestionLanguage, number>;
  inSets: Array<{
    set: { id: string; name: string };
    byLanguage: Record<QuestionLanguage, number>;
  }>;
  /** Live questions filed under the product but in no set. */
  looseByLanguage: Record<QuestionLanguage, number>;
}

export const questionQuerySchema = z.object({
  productId: idSchema.optional(),
  questionSetId: idSchema.optional(),
  /** Narrows to questions that have an approved wording in this language. */
  language: z.enum(QUESTION_LANGUAGES).optional(),
  /** Finds the ones still carrying an unreviewed machine draft. */
  needsReview: z.coerce.boolean().default(false),
  q: z.string().trim().max(200).optional(),
  /** Retired questions are hidden unless asked for. */
  includeRetired: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type QuestionQuery = z.infer<typeof questionQuerySchema>;

/**
 * Whether a test of `wanted` questions can be built from what is available.
 *
 * Lives here rather than in the test module because both sides need the same
 * answer: the question bank screen says "enough for a 20-question test", and
 * the test form refuses to publish one it cannot fill. Two readings of the
 * same sentence is how a test gets published that cannot be sat.
 */
export function canBuildTest(available: number, wanted: number): boolean {
  return wanted > 0 && available >= wanted;
}

/**
 * The columns a bulk upload must supply, in order.
 *
 * One row is one question in its source language. Translations are not part
 * of the file: they are drafted and approved afterwards, which keeps the
 * sheet something a person can actually fill in and stops an unreviewed
 * rendering arriving through the back door.
 */
export const QUESTION_IMPORT_COLUMNS = [
  'product_code',
  'question_set',
  'language',
  'question',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct_answer',
  'explanation',
  'marks',
  'negative_marks',
] as const;
