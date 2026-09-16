import Link from 'next/link';
import type { EventDetail } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CopyField } from '@/components/ui/CopyField';
import { EventActions } from '@/components/events/EventActions';
import { QrCode } from '@/components/ui/QrCode';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateTime, formatNumber, humanise } from '@/lib/format';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const event = await apiFetch<EventDetail>(`/events/${id}`).catch(() => null);
  return { title: event ? event.name : 'Event' };
}

const STATUS_TONES: Record<string, 'green' | 'navy' | 'teal' | 'neutral'> = {
  PLANNED: 'navy',
  RUNNING: 'green',
  COMPLETED: 'teal',
  CANCELLED: 'neutral',
};

export default async function EventDetailPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const event = await apiFetch<EventDetail>(`/events/${id}`);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/events"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All events
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <Badge tone={STATUS_TONES[event.status] ?? 'neutral'}>{humanise(event.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            <span className="font-mono">{event.reference}</span> ·{' '}
            {formatDateTime(event.startsAt)}
            {event.venue ? ` · ${event.venue}` : ''}
            {event.owner ? ` · ${event.owner.fullName}` : ''}
          </p>
        </div>

        {can(user, 'campaign:update') ? (
          <EventActions
            eventId={event.id}
            status={event.status}
            allowedTransitions={event.allowedTransitions}
          />
        ) : null}
      </header>

      <section aria-label="Capture">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {/*
            People met, then leads won — in that order, because the first is the
            question a rep standing at the stall actually has, and until now it
            had no answer at all. A client already on the book who registered
            here appeared nowhere on this page.
          */}
          <StatTile
            label="People met"
            value={formatNumber(event.attended)}
            hint={
              event.returningAttendees > 0
                ? `${formatNumber(event.returningAttendees)} already on the book`
                : event.expectedFootfall
                  ? `${event.expectedFootfall} expected footfall`
                  : undefined
            }
            href={`/leads?attendedEventId=${event.id}`}
          />
          <StatTile
            label="Leads captured"
            value={formatNumber(event.leads)}
            hint="New enquiries this event produced"
            href={`/leads?eventId=${event.id}`}
          />
          <StatTile
            label="Not yet contacted"
            value={formatNumber(event.uncontacted)}
            hint={event.uncontacted > 0 ? 'Nobody has called these' : 'All followed up'}
            tone={event.uncontacted > 0 ? 'warning' : 'default'}
            href={`/leads?eventId=${event.id}&status=NEW`}
          />
          <StatTile label="Converted" value={formatNumber(event.converted)} />
          <StatTile label="Conversion" value={`${event.conversionRate}%`} />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-[16rem] flex-1">
            <h2 className="font-bold">Registration QR</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Print this for the desk. Every scan opens a registration form already tagged to this
              event, so nobody has to type a spreadsheet afterwards.
            </p>

            <div className="mt-4">
              <CopyField value={event.captureUrl} label="Event registration URL" />
            </div>

            {event.status !== 'RUNNING' ? (
              <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/15">
                {/* The QR outlives the event. Saying so here is what stops
                    someone printing a banner for an event nobody opened. */}
                {event.status === 'PLANNED'
                  ? 'Scans are not being accepted yet — set the event to Running on the day.'
                  : 'This event is closed, so scans are no longer accepted.'}
              </p>
            ) : null}
          </div>

          <div className="text-center">
            <QrCode value={event.captureUrl} size={190} />
            <p className="mt-1.5 font-mono text-xs text-[var(--color-text-subtle)]">{event.code}</p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">What the leads became</h2>
          {event.leads > 0 ? (
            <Link
              // An exact filter on the event, not a free-text search for its
              // code — which matched nothing, because the lead search only ever
              // looked at the person.
              href={`/leads?eventId=${event.id}`}
              className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
            >
              View the leads
            </Link>
          ) : null}
        </div>

        {event.pipeline.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Nothing captured yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {event.pipeline.map((stage) => (
              <li key={stage.status} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{humanise(stage.status)}</span>
                <span className="text-sm tnum">{formatNumber(stage.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
