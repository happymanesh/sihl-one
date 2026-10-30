'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type { QuestionLanguage, QuestionView } from '@sihl-one/contracts';

import { rethrowControlFlow } from '@/lib/rethrow';
import { ApiError, apiFetch } from '@/lib/api';

export interface QuestionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

function toErrorState(error: unknown, fallback: string): QuestionState {
  rethrowControlFlow(error);
  if (error instanceof ApiError) {
    // The API's own wording is the whole value here — "that wording is already
    // approved" tells the author what to do; a generic failure does not.
    return {
      status: 'error',
      message: error.problem.detail ?? error.problem.title,
      errors: error.fieldErrors,
    };
  }
  return { status: 'error', message: fallback };
}

function wordingFrom(formData: FormData) {
  return {
    text: String(formData.get('text') ?? '').trim(),
    optionA: String(formData.get('optionA') ?? '').trim(),
    optionB: String(formData.get('optionB') ?? '').trim(),
    optionC: String(formData.get('optionC') ?? '').trim(),
    optionD: String(formData.get('optionD') ?? '').trim(),
    explanation: String(formData.get('explanation') ?? '').trim() || undefined,
  };
}

export async function createQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const input = {
    productId: String(formData.get('productId') ?? ''),
    questionSetId: String(formData.get('questionSetId') ?? '') || undefined,
    sourceLanguage: String(formData.get('sourceLanguage') ?? 'EN'),
    correctAnswer: String(formData.get('correctAnswer') ?? ''),
    marks: Number(formData.get('marks') || 1),
    negativeMarks: Number(formData.get('negativeMarks') || 0),
    wording: wordingFrom(formData),
  };

  if (!input.productId) return { status: 'error', message: 'Choose a product.' };
  if (!input.correctAnswer) return { status: 'error', message: 'Mark which option is correct.' };

  let created: QuestionView;
  try {
    created = await apiFetch<QuestionView>('/questions', { method: 'POST', body: input });
  } catch (error) {
    return toErrorState(error, 'The question could not be saved.');
  }

  revalidatePath('/test/questions');
  redirect(`/test/questions/${created.id}` as Route);
}

export async function updateQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  const input = {
    productId: String(formData.get('productId') ?? ''),
    questionSetId: String(formData.get('questionSetId') ?? '') || undefined,
    correctAnswer: String(formData.get('correctAnswer') ?? ''),
    marks: Number(formData.get('marks') || 1),
    negativeMarks: Number(formData.get('negativeMarks') || 0),
    wording: wordingFrom(formData),
  };

  try {
    await apiFetch(`/questions/${id}`, { method: 'PATCH', body: input });
  } catch (error) {
    return toErrorState(error, 'The question could not be saved.');
  }

  revalidatePath('/test/questions');
  revalidatePath(`/test/questions/${id}`);
  return { status: 'success', message: 'Saved.' };
}

export async function retireQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  try {
    await apiFetch(`/questions/${id}`, { method: 'PATCH', body: { isActive } });
  } catch (error) {
    return toErrorState(error, 'The question could not be changed.');
  }

  revalidatePath('/test/questions');
  revalidatePath(`/test/questions/${id}`);
  return { status: 'success', message: isActive ? 'Back in circulation.' : 'Retired.' };
}

export async function deleteQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  try {
    await apiFetch(`/questions/${id}`, { method: 'DELETE' });
  } catch (error) {
    return toErrorState(error, 'The question could not be removed.');
  }
  revalidatePath('/test/questions');
  redirect('/test/questions');
}

/**
 * Ask for a machine draft in another language.
 *
 * Lands as a draft that nobody has read. The screen then shows it for review;
 * nothing can put it in a test until somebody saves it.
 */
export async function translateQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  const targetLanguage = String(formData.get('targetLanguage') ?? '') as QuestionLanguage;

  try {
    await apiFetch(`/questions/${id}/translate`, {
      method: 'POST',
      body: { targetLanguage },
    });
  } catch (error) {
    return toErrorState(error, 'The translation could not be fetched.');
  }

  revalidatePath(`/test/questions/${id}`);
  return {
    status: 'success',
    message: 'Draft ready — read it through and save it before any test can use it.',
  };
}

/** Save one language's wording. Submitting it is the act of approving it. */
export async function saveTranslation(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  const language = String(formData.get('language') ?? '');

  try {
    await apiFetch(`/questions/${id}/translation`, {
      method: 'PATCH',
      body: { language, machineDraft: false, ...wordingFrom(formData) },
    });
  } catch (error) {
    return toErrorState(error, 'The wording could not be saved.');
  }

  revalidatePath('/test/questions');
  revalidatePath(`/test/questions/${id}`);
  return { status: 'success', message: 'Approved.' };
}

export async function removeTranslation(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const id = String(formData.get('id') ?? '');
  const language = String(formData.get('language') ?? '');

  try {
    await apiFetch(`/questions/${id}/translation/${language}`, { method: 'DELETE' });
  } catch (error) {
    return toErrorState(error, 'The wording could not be removed.');
  }

  revalidatePath(`/test/questions/${id}`);
  return { status: 'success', message: 'Removed.' };
}

export async function createQuestionSet(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const input = {
    productId: String(formData.get('productId') ?? ''),
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim() || undefined,
  };

  if (!input.productId) return { status: 'error', message: 'Choose a product.' };

  try {
    await apiFetch('/questions/sets', { method: 'POST', body: input });
  } catch (error) {
    return toErrorState(error, 'The set could not be created.');
  }

  revalidatePath('/test/questions');
  return { status: 'success', message: 'Set created.' };
}
