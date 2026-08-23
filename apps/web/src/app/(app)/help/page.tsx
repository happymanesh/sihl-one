import { HELP_AREAS, visibleHelpTopics } from '@/lib/help-topics';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Help' };

/**
 * In-app help, filtered by what the reader can actually do.
 *
 * Deliberately not a FAQ. A pilot has not yet produced the questions people
 * really ask, so writing answers to imagined ones means guessing — and a guessed
 * FAQ that does not match what a rep hits is read once and never again. These
 * are how-tos for tasks the app definitely performs.
 *
 * Filtered on the same permission strings the API enforces and the navigation
 * reads, so nobody is given instructions for a screen they cannot open. When a
 * role gains a permission it gains the matching topic on the same day, with no
 * second mapping to maintain.
 */
export default async function HelpPage() {
  const user = await requireUser();
  const topics = visibleHelpTopics(user.permissions);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Help</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          How to do the things you can do in SIHL ONE. Only what applies to you is shown —
          {' '}
          {topics.length} topics.
        </p>
      </header>

      {/* Jump links. The list is long enough on a phone that scrolling past
          Leads to reach Administration is a real cost. */}
      <nav aria-label="Sections" className="flex flex-wrap gap-1.5">
        {HELP_AREAS.filter((area) => topics.some((topic) => topic.area === area)).map((area) => (
          <a
            key={area}
            href={`#${slug(area)}`}
            className="rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            {area}
          </a>
        ))}
      </nav>

      {HELP_AREAS.map((area) => {
        const inArea = topics.filter((topic) => topic.area === area);
        if (inArea.length === 0) return null;

        return (
          <section key={area} id={slug(area)} className="space-y-2">
            <h2 className="scroll-mt-20 text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {area}
            </h2>

            {inArea.map((topic) => (
              /* A native disclosure rather than a scripted accordion: it works
                 before JavaScript loads, it is keyboard-operable for free, and
                 the browser's own find-in-page can open it. */
              <details
                key={topic.id}
                className="card group overflow-hidden p-0 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
                  {topic.title}
                  <span
                    aria-hidden
                    className="text-xs font-normal text-[var(--color-text-subtle)] group-open:hidden"
                  >
                    Show
                  </span>
                  <span
                    aria-hidden
                    className="hidden text-xs font-normal text-[var(--color-text-subtle)] group-open:inline"
                  >
                    Hide
                  </span>
                </summary>

                <div className="border-t border-[var(--color-border)] px-4 py-3">
                  <ol className="ml-4 list-decimal space-y-1.5 text-sm marker:text-[var(--color-text-subtle)]">
                    {topic.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  {topic.note ? (
                    <p className="mt-3 border-l-2 border-[var(--color-border-strong)] pl-3 text-xs text-[var(--color-text-muted)]">
                      {topic.note}
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </section>
        );
      })}

      <section className="card p-5">
        <h2 className="font-bold">Not here?</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Tell your manager what you were trying to do and what you expected to happen. During
          the pilot that is worth more than a longer help page — the questions people actually
          hit are what this should be built from, and nobody knows them yet.
        </p>
      </section>
    </div>
  );
}

function slug(area: string): string {
  return area.toLowerCase().replace(/[^a-z]+/g, '-');
}
