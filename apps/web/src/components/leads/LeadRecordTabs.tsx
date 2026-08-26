'use client';

import { useState } from 'react';

type Pane = 'activity' | 'documents';

/**
 * Activity and Documents, one at a time.
 *
 * Both were full-width cards stacked under the lead, so a lead with a long
 * timeline pushed its documents somewhere nobody scrolled to. They answer
 * different questions — what happened, and what we hold — and only one is
 * usually being asked.
 *
 * Activity leads because it is what most people open a lead for. The panes are
 * rendered by the server and both are always in the DOM: switching hides one
 * rather than fetching, so there is no spinner and find-in-page still reaches
 * the hidden one.
 */
export function LeadRecordTabs({
  activity,
  documents,
  activityCount,
}: {
  activity: React.ReactNode;
  documents: React.ReactNode;
  activityCount: number;
}) {
  const [pane, setPane] = useState<Pane>('activity');

  const tab = (id: Pane, label: string, badge?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setPane(id)}
      aria-current={pane === id ? 'true' : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
        pane === id
          ? 'border-teal-500 text-[var(--color-text)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
      }`}
    >
      {label}
      {typeof badge === 'number' ? (
        <span className="ml-1.5 text-xs font-normal text-[var(--color-text-subtle)] tnum">
          {badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex border-b border-[var(--color-border)]">
        {tab('activity', 'Activity', activityCount)}
        {tab('documents', 'Documents')}
      </div>

      {/* `hidden` rather than unmounting: the panes are server-rendered, and
          throwing one away would mean re-rendering it on every switch. */}
      <div className="p-5" hidden={pane !== 'activity'}>
        {activity}
      </div>
      <div className="p-5" hidden={pane !== 'documents'}>
        {documents}
      </div>
    </section>
  );
}
