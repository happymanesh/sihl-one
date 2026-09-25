import Link from 'next/link';
import type { EventDetail, EventRepBreakdown, PresentationDay } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CopyField } from '@/components/ui/CopyField';
import { EventActions } from '@/components/events/EventActions';
import { PresentationSlotsEditor } from '@/components/events/PresentationSlotsEditor';
import { QrSwitcher } from '@/components/events/QrSwitcher';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { EventRepTable } from '@/components/events/EventRepTable';
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
  /** Runs events, rather than works them. Decides which QR greets them. */
  const runsEvents = can(user, 'campaign:read');
  const { id } = await params;
  const event = await apiFetch<EventDetail>(`/events/${id}`);
  const byRep = await apiFetch<EventRepBreakdown[]>(`/events/${id}/by-rep`).catch(
    () => [] as EventRepBreakdown[],
  );

  /*
    The schedule, for whoever runs the event.

    Fetched here rather than inside the editor so the page renders with it in
    place — a section that populates a moment later reads as a glitch on a
    screen somebody is watching during an event.
  */
  const schedule = await apiFetch<PresentationDay[]>(
    `/presentations/events/${event.id}/slots`,
  ).catch(() => [] as PresentationDay[]);

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
            <span className="font-mono">{event.reference}</span> · {formatDateTime(event.startsAt)}
            {event.venue ? ` · ${event.venue}` : ''}
            {event.owner ? ` · ${event.owner.fullName}` : ''}
          </p>
        </div>

        {/*
          Refresh sits outside the permission check, because reading again is
          not a privilege. While an event is running these figures move every
          few minutes and the page is server-rendered, so without this the only
          way to see a new scan is a full reload.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton />
          {can(user, 'campaign:update') ? (
            <EventActions
              eventId={event.id}
              status={event.status}
              allowedTransitions={event.allowedTransitions}
            />
          ) : null}
        </div>
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
          <StatTile
            label="Converted"
            value={formatNumber(event.converted)}
            href={`/leads?eventId=${event.id}&status=CONVERTED`}
          />
          {/* A ratio, not a set of rows — nothing to drill into. */}
          <StatTile label="Conversion" value={`${event.conversionRate}%`} />
        </div>

        {/*
          Whose QR brought them in.

          Second row rather than squeezed into the first: the row above is about
          the event, this one is about how it was worked. A stall where every
          lead is unattributed means the personal QRs were printed and never
          used, which is worth seeing at a glance.
        */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Assigned to a rep"
            value={formatNumber(event.assignedLeads)}
            hint="Scanned someone's personal QR"
            href={`/leads?eventId=${event.id}&captured=any`}
          />
          <StatTile
            label="Not assigned"
            value={formatNumber(event.unassignedLeads)}
            hint="Scanned the plain banner QR"
            tone={event.unassignedLeads > 0 ? 'warning' : 'default'}
            href={`/leads?eventId=${event.id}&captured=none`}
          />
          {/*
            People we already knew who came back.

            Counted from the attendance record rather than from leads, because
            these are not leads this event produced — they were on the book
            before they walked in. Kept beside the other two so the three
            together describe everyone who registered.
          */}
          <StatTile
            label="Welcome back"
            value={formatNumber(event.returningAttendees)}
            hint="Already on the book when they arrived"
            href={`/leads?returningAtEventId=${event.id}`}
          />
        </div>

        {event.scopedToViewer ? (
          <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {/* Without this a rep reads four leads off a stall that took two
                hundred and concludes the event failed. */}
            These are your own numbers — leads your QR brought in. The stall total will be higher.
          </p>
        ) : null}
      </section>

      {/*
        Which code greets you depends on your job.

        Somebody who runs events wants the stall's QR, the one that goes on the
        banner. A rep wants their own, because that is the one that puts leads in
        their name. Both are always reachable through the switch; only which one
        opens differs, and `campaign:read` is the same line the API already draws
        between running an event and working one.
      */}
      <QrSwitcher
        defaultTab={runsEvents ? 'common' : 'mine'}
        common={
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-[16rem] flex-1">
              <p className="text-sm text-[var(--color-text-muted)]">
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
              <p className="mt-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                {event.code}
              </p>
            </div>
          </div>
        }
        /*
          The rep's own QR.

          Same event, one extra parameter carrying their employee code, so every
          scan of this one lands as their lead instead of in a common pile.
          Offered only while the event is actually accepting scans — a personal
          QR printed for a closed event produces nothing and teaches people the
          feature is broken.
        */
        mine={
          event.myCaptureUrl && event.status === 'RUNNING' ? (
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-[16rem] flex-1">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Scans of this one are tagged{' '}
                  <span className="font-mono font-semibold">{event.myEmployeeCode}</span> and the
                  lead is assigned to you automatically. Use it on your phone or print your own
                  copy.
                </p>
                <div className="mt-4">
                  <CopyField value={event.myCaptureUrl} label="Your personal registration URL" />
                </div>
              </div>

              <div className="text-center">
                <QrCode value={event.myCaptureUrl} size={190} />
                <p className="mt-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                  {event.myEmployeeCode}
                </p>
              </div>
            </div>
          ) : null
        }
      />

      <section className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold">Lead Assigned</h2>
          <span className="text-xs text-[var(--color-text-muted)]">
            Whose QR brought each lead in, and whether the number was proven
          </span>
        </div>
        <EventRepTable eventId={event.id} rows={byRep} />
      </section>

      <PresentationSlotsEditor
        eventId={event.id}
        enabled={event.allowsPresentationBooking}
        days={schedule}
        eventStartsAt={event.startsAt}
        eventEndsAt={event.endsAt ?? null}
        canManage={can(user, 'campaign:update')}
      />
    </div>
  );
}
