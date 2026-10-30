import Link from 'next/link';
import type { QuestionAvailability } from '@sihl-one/contracts';
import { QUESTION_LANGUAGES, QUESTION_LANGUAGE_NAMES } from '@sihl-one/contracts';

import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Test' };

/**
 * Test, before tests can be set.
 *
 * Deliberately a real page rather than a hidden menu entry. Test is being
 * built behind the question bank — a test with nothing to draw on cannot be
 * set, sat or scored — and a menu item that silently does nothing is read as
 * a broken build. This says where it has got to, and sends whoever can do
 * something useful to the bank.
 */
export default async function TestPage() {
  const user = await requireUser();
  const canManage = can(user, 'test:manage');

  const availability = canManage
    ? await apiFetch<QuestionAvailability[]>('/questions/availability').catch(
        () => [] as QuestionAvailability[],
      )
    : [];

  /*
    Per product, because that is the unit a test is set on.

    A question sits under a product whether or not anybody has put it in a
    set, so counting sets alone reported nothing for a bank that plainly had
    questions in it — and left this page unable to say why no test could be
    built from them.
  */
  const anyQuestions = availability.some((entry) =>
    QUESTION_LANGUAGES.some((language) => entry.byLanguage[language] > 0),
  );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Test</h1>
      </header>

      <div className="card space-y-3 p-6">
        <Icon name="check" size={32} />
        <h2 className="text-lg font-bold">Not open yet</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Tests are built on the question bank, and that comes first — a test with nothing to draw
          questions from cannot be set, taken or scored. Next: test creation, scheduling per branch,
          then the exam itself and results.
        </p>

        {canManage ? (
          <>
            <p className="text-sm text-[var(--color-text-muted)]">
              The bank is open now. Anything added there will be ready the day tests are.
            </p>
            {anyQuestions ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                  Longest paper each product could fill today
                </p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {availability.map((entry) => (
                    <li key={entry.product.id}>
                      <span className="font-semibold">{entry.product.name}</span>
                      {' — '}
                      {QUESTION_LANGUAGES.filter((language) => entry.byLanguage[language] > 0)
                        .map(
                          (language) =>
                            `${entry.byLanguage[language]} in ${QUESTION_LANGUAGE_NAMES[language]}`,
                        )
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Link href="/test/questions" className="btn btn-primary">
              Go to the question bank
            </Link>
          </>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Training is open and does not wait for any of this — sessions can be scheduled,
            announced per branch and have their material attached today.
          </p>
        )}

        <Link href="/training" className="btn btn-outline">
          Go to Training
        </Link>
      </div>
    </div>
  );
}
