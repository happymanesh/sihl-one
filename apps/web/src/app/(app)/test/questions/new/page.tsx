import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { QuestionSetView } from '@sihl-one/contracts';

import { QuestionForm } from '@/components/questions/QuestionForm';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

interface ProductRow {
  id: string;
  name: string;
  group?: { name: string } | null;
}

export const metadata = { title: 'Add a question' };

export default async function NewQuestionPage() {
  const user = await requireUser();
  if (!can(user, 'test:manage')) redirect('/test');

  const [products, sets] = await Promise.all([
    apiFetch<ProductRow[]>('/masters/products').catch(() => [] as ProductRow[]),
    apiFetch<QuestionSetView[]>('/questions/sets').catch(() => [] as QuestionSetView[]),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/test/questions"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← Question bank
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">Add a question</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Write it in one language. Other languages are added from the question’s own page
          afterwards, sharing this answer and these marks.
        </p>
      </header>

      <QuestionForm
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          groupName: product.group?.name ?? null,
        }))}
        sets={sets.map((set) => ({ id: set.id, name: set.name, productId: set.product.id }))}
      />
    </div>
  );
}
