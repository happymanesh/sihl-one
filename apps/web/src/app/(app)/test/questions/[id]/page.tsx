import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { QuestionSetView, QuestionView } from '@sihl-one/contracts';

import { QuestionActions } from '@/components/questions/QuestionActions';
import { QuestionForm } from '@/components/questions/QuestionForm';
import { TranslationPanel } from '@/components/questions/TranslationPanel';
import { ApiError, apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

interface ProductRow {
  id: string;
  name: string;
  group?: { name: string } | null;
}

export const metadata = { title: 'Question' };

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, 'test:manage')) redirect('/test');

  const { id } = await params;

  let question: QuestionView;
  try {
    question = await apiFetch<QuestionView>(`/questions/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [products, sets, capability] = await Promise.all([
    apiFetch<ProductRow[]>('/masters/products').catch(() => [] as ProductRow[]),
    apiFetch<QuestionSetView[]>('/questions/sets').catch(() => [] as QuestionSetView[]),
    // False when no provider is configured, so the screen hides the draft
    // button rather than offering one that always fails.
    apiFetch<{ translationAvailable: boolean }>('/questions/languages').catch(() => ({
      translationAvailable: false,
    })),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link
          href="/test/questions"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← Question bank
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">Question</h1>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Added by {question.createdBy} on {formatDateTime(question.createdAt)}
          {question.isActive ? '' : ' · retired'}
        </p>
      </header>

      <QuestionForm
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          groupName: product.group?.name ?? null,
        }))}
        sets={sets.map((set) => ({ id: set.id, name: set.name, productId: set.product.id }))}
        question={question}
      />

      <TranslationPanel
        question={question}
        translationAvailable={capability.translationAvailable}
      />

      <QuestionActions
        questionId={question.id}
        isActive={question.isActive}
        usedInTests={question.usedInTests}
      />
    </div>
  );
}
