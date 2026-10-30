import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import {
  QUESTION_LANGUAGES,
  QUESTION_LANGUAGE_NAMES,
  type QuestionSetView,
  type QuestionView,
} from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Question bank' };

interface ProductRow {
  id: string;
  name: string;
  group?: { name: string } | null;
}

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Gated where training is not: a question carries its own answer, so an
  // open bank is an open answer key.
  if (!can(user, 'test:manage')) redirect('/test');

  const params = await searchParams;

  const [data, sets, products] = await Promise.all([
    apiFetch<{ items: QuestionView[]; total: number; page: number; pageSize: number }>(
      `/questions${toQuery({
        productId: params.productId,
        questionSetId: params.questionSetId,
        language: params.language,
        needsReview: params.needsReview,
        q: params.q,
        includeRetired: params.includeRetired,
        page: params.page ?? '1',
        pageSize: '25',
      })}`,
    ).catch(() => ({ items: [] as QuestionView[], total: 0, page: 1, pageSize: 25 })),
    apiFetch<QuestionSetView[]>('/questions/sets').catch(() => [] as QuestionSetView[]),
    apiFetch<ProductRow[]>('/masters/products').catch(() => [] as ProductRow[]),
  ]);

  const isFiltered = Boolean(
    params.q || params.productId || params.language || params.needsReview || params.questionSetId,
  );
  const drafts = data.items.filter((question) =>
    question.translations.some((wording) => wording.status === 'DRAFT'),
  ).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Question bank</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatNumber(data.total)} {data.total === 1 ? 'question' : 'questions'} · tests draw
            from here, and freeze their own copy when published
          </p>
        </div>
        <Link href="/test/questions/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          Add a question
        </Link>
      </header>

      {/*
        Unreviewed drafts, said out loud rather than left to be noticed.

        A draft is invisible to the test builder, so a bank that looks full
        can still be unable to fill a Hindi paper. This is the only place that
        discrepancy gets explained.
      */}
      {drafts > 0 && !params.needsReview ? (
        <p className="card border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
          {drafts} question{drafts === 1 ? ' has' : 's have'} a translation nobody has read yet. No
          test can use those languages until somebody approves them.{' '}
          <Link
            href={'/test/questions?needsReview=true' as Route}
            className="font-semibold underline"
          >
            Review them
          </Link>
        </p>
      ) : null}

      <form className="card flex flex-wrap items-end gap-3 p-3" action="/test/questions">
        <div className="min-w-[10rem] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Words in the question"
            className="input"
          />
        </div>
        <div className="min-w-[9rem]">
          <label className="label" htmlFor="productId">
            Product
          </label>
          <select
            id="productId"
            name="productId"
            defaultValue={params.productId ?? ''}
            className="input"
          >
            <option value="">All</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[8rem]">
          <label className="label" htmlFor="language">
            Has wording in
          </label>
          <select
            id="language"
            name="language"
            defaultValue={params.language ?? ''}
            className="input"
          >
            <option value="">Any</option>
            {QUESTION_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {QUESTION_LANGUAGE_NAMES[language]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            name="includeRetired"
            value="true"
            defaultChecked={params.includeRetired === 'true'}
            className="h-3.5 w-3.5 accent-teal-600"
          />
          Show retired
        </label>
        <button type="submit" className="btn btn-outline">
          Apply
        </button>
        {isFiltered ? (
          <Link href="/test/questions" className="btn btn-outline">
            Clear
          </Link>
        ) : null}
      </form>

      {sets.length > 0 ? (
        <section className="card p-4">
          <h2 className="text-sm font-bold">Sets, and what each can fill</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Approved wordings only — a draft builds no paper.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2 pr-4">Set</th>
                  <th className="pb-2 pr-4">Product</th>
                  {QUESTION_LANGUAGES.map((language) => (
                    <th key={language} className="pb-2 pr-4">
                      {QUESTION_LANGUAGE_NAMES[language]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sets.map((set) => (
                  <tr key={set.id}>
                    <td className="py-2 pr-4 font-semibold">{set.name}</td>
                    <td className="py-2 pr-4 text-xs text-[var(--color-text-muted)]">
                      {set.product.name}
                    </td>
                    {QUESTION_LANGUAGES.map((language) => (
                      <td key={language} className="tnum py-2 pr-4">
                        {set.availableByLanguage[language] === 0 ? (
                          <span className="text-[var(--color-text-subtle)]">—</span>
                        ) : (
                          set.availableByLanguage[language]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="file" size={40} />}
            title={isFiltered ? 'Nothing matches those filters' : 'The bank is empty'}
            description={
              isFiltered
                ? 'Try widening the search, or clear the filters.'
                : 'Add a question and any test for that product can draw on it.'
            }
            action={
              isFiltered ? (
                <Link href="/test/questions" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : (
                <Link href="/test/questions/new" className="btn btn-primary">
                  Write the first question
                </Link>
              )
            }
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {data.items.map((question) => {
              const source = question.translations.find(
                (wording) => wording.language === question.sourceLanguage,
              );
              return (
                <Link
                  key={question.id}
                  href={`/test/questions/${question.id}` as Route}
                  className="card block p-4 transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-semibold">{source?.text ?? '(no wording)'}</p>
                    {!question.isActive ? <Badge tone="neutral">Retired</Badge> : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <span>
                      {question.product.groupName ? `${question.product.groupName} › ` : ''}
                      {question.product.name}
                    </span>
                    {question.questionSet ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{question.questionSet.name}</span>
                      </>
                    ) : null}
                    <span aria-hidden>·</span>
                    <span className="tnum">
                      {question.marks} mark{question.marks === 1 ? '' : 's'}
                      {question.negativeMarks > 0 ? `, −${question.negativeMarks} if wrong` : ''}
                    </span>
                    <span aria-hidden>·</span>
                    <span>Answer {question.correctAnswer}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {question.translations.map((wording) => (
                      <span
                        key={wording.language}
                        className={`rounded-full border px-2 py-0.5 text-[0.6875rem] ${
                          wording.status === 'DRAFT'
                            ? 'border-amber-500/50 font-semibold text-amber-600 dark:text-amber-300'
                            : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        {QUESTION_LANGUAGE_NAMES[wording.language]}
                        {wording.status === 'DRAFT' ? ' — draft' : ''}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>

          <Pagination
            page={data.page}
            totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
            total={data.total}
            pageSize={data.pageSize}
          />
        </>
      )}
    </div>
  );
}
