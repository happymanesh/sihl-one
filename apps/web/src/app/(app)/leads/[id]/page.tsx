import Link from 'next/link';
import type {
  MeetingModeItem,
  MobileVerificationMethod,
  ProductItem,
} from '@sihl-one/contracts';
import type { Route } from 'next';

import { Badge, LeadStatusBadge, PriorityBadge, ScoreBadge } from '@/components/ui/Badge';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { Icon } from '@/components/shell/Icon';
import { LeadActions } from '@/components/leads/LeadActions';
import { Timeline } from '@/components/leads/Timeline';
import { VerifyMobile } from '@/components/leads/VerifyMobile';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatCurrency, formatDate, formatDateTime, formatRelative, humanise } from '@/lib/format';

interface LeadDetail {
  id: string;
  reference: string;
  fullName: string;
  mobile: string;
  mobileVerifiedAt: string | null;
  mobileVerificationMethod: MobileVerificationMethod | null;
  mobileVerifiedBy: { id: string; fullName: string } | null;
  email: string | null;
  panMasked: string;
  city: string | null;
  state: string | null;
  status: string;
  source: string;
  priority: string;
  productInterest: string[];
  estimatedValue: string | null;
  score: number;
  scoreBand: string;
  scoreFactors: Array<{ code: string; label: string; points: number }>;
  nextBestActions: Array<{ code: string; title: string; reason: string; urgency: string }>;
  owner: { id: string; fullName: string; email: string } | null;
  partner: { id: string; name: string; type: string } | null;
  campaign: { id: string; name: string; code: string } | null;
  orgUnit: { id: string; name: string } | null;
  customer: { id: string; reference: string; clientCode: string | null } | null;
  attribution: Record<string, string | null>;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  convertedAt: string | null;
  lostReason: string | null;
  createdAt: string;
  allowedTransitions: string[];
  activityCount: number;
  timeline: Array<{
    id: string;
    type: string;
    direction: string;
    subject: string;
    body: string | null;
    outcome: string | null;
    occurredAt: string;
    isSystemGenerated: boolean;
    actor: { id: string; fullName: string } | null;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    changedAt: string;
    durationSeconds: number | null;
  }>;
}

interface AssignableUser {
  id: string;
  fullName: string;
  email: string;
  orgUnit: string | null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const lead = await apiFetch<LeadDetail>(`/leads/${id}`);
    return { title: `${lead.fullName} · ${lead.reference}` };
  } catch {
    return { title: 'Lead' };
  }
}

/**
 * Dictation is off until the language service is configured.
 *
 * A plain server-side environment variable rather than NEXT_PUBLIC_*: those are
 * inlined at build time, and turning this on should be a config change on the
 * running service, not a rebuild.
 */
function voiceInputEnabled(): boolean {
  return process.env.VOICE_INPUT_ENABLED === 'true';
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const lead = await apiFetch<LeadDetail>(`/leads/${id}`);

  // The owner picker is only fetched for users who can actually assign — one
  // fewer API call for the majority of users, who cannot.
  // Empty on failure rather than taking the lead page down: messaging is an
  // extra here, not the reason anyone opened this screen.
  const templates = can(user, 'activity:create')
    ? await apiFetch<
        Array<{ code: string; name: string; channel: string; purpose: string; body: string; isActive: boolean }>
      >('/messaging/templates')
        .then((rows) => rows.filter((row) => row.isActive))
        .catch(() => [])
    : [];

  const assignable = can(user, 'lead:assign')
    ? await apiFetch<AssignableUser[]>('/users/assignable').catch(() => [])
    : [];

  // Active modes only: one switched off yesterday must not be selectable today,
  // though interactions already carrying it still read correctly.
  const meetingModes = await apiFetch<MeetingModeItem[]>('/masters/meeting-modes').catch(
    () => [] as MeetingModeItem[],
  );

  // Offered on the interaction form so a rep can record what was discussed and
  // what they expect it to earn. An empty list hides the section rather than
  // blocking the form.
  const products = await apiFetch<ProductItem[]>('/masters/products').catch(
    () => [] as ProductItem[],
  );

  return (
    <div className="space-y-5">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/leads" className="hover:underline">
          Leads
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span className="font-mono">{lead.reference}</span>
      </nav>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold">{lead.fullName}</h1>
              <LeadStatusBadge status={lead.status} />
              <PriorityBadge priority={lead.priority} />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-muted)]">
              {/* Full contact details here, not masked: this view requires the
                  record-level permission and the read is written to the audit
                  trail, which is the trade the list view deliberately avoids. */}
              <a href={`tel:+91${lead.mobile}`} className="font-semibold hover:underline tnum">
                +91 {lead.mobile}
              </a>
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="hover:underline">
                  {lead.email}
                </a>
              ) : null}
              {lead.city ? <span>{[lead.city, lead.state].filter(Boolean).join(', ')}</span> : null}
            </div>

            <div className="mt-2.5">
              <VerifyMobile
                leadId={lead.id}
                verifiedAt={lead.mobileVerifiedAt}
                method={lead.mobileVerificationMethod}
                verifiedByName={lead.mobileVerifiedBy?.fullName ?? null}
                canVerify={lead.owner?.id === user.id}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {lead.productInterest.map((product) => (
                <Badge key={product} tone="navy">
                  {humanise(product)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="text-right">
            <ScoreBadge score={lead.score} band={lead.scoreBand} />
            <p className="mt-2 text-2xl font-bold tnum">{formatCurrency(lead.estimatedValue)}</p>
            <p className="text-xs text-[var(--color-text-subtle)]">Estimated value</p>
          </div>
        </div>

        {can(user, 'visit:create') && !lead.customer ? (
          <Link
            href={`/visits/new?entityType=LEAD&entityId=${lead.id}` as Route}
            className="btn btn-outline mt-4"
          >
            <Icon name="pin" size={16} />
            Plan a field visit
          </Link>
        ) : null}

        {lead.customer ? (
          <div className="mt-4 rounded-lg border border-teal-500/40 bg-teal-50 px-4 py-2.5 text-sm dark:bg-teal-900/25">
            Converted to customer{' '}
            <Link href={`/customers/${lead.customer.id}`} className="font-bold hover:underline">
              {lead.customer.reference}
            </Link>
            {lead.convertedAt ? ` on ${formatDate(lead.convertedAt)}` : ''}
          </div>
        ) : null}
      </header>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <LeadActions
            leadId={lead.id}
            status={lead.status}
            allowedTransitions={lead.allowedTransitions}
            currentOwnerId={lead.owner?.id ?? null}
            assignableUsers={assignable}
            templates={templates}
            email={lead.email}
            canUpdate={can(user, 'lead:update')}
            canAssign={can(user, 'lead:assign')}
            canConvert={can(user, 'lead:convert')}
            voiceInputEnabled={voiceInputEnabled()}
            meetingModes={meetingModes}
            products={products}
          />

          <DocumentPanel
            entityType="LEAD"
            entityId={lead.id}
            canUpload={can(user, 'lead:update')}
          />

          <section className="card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold">Activity timeline</h2>
              <span className="text-xs text-[var(--color-text-subtle)]">
                {lead.activityCount} interaction{lead.activityCount === 1 ? '' : 's'}
              </span>
            </div>
            <Timeline entries={lead.timeline} />
          </section>
        </div>

        <aside className="space-y-4">
          {lead.nextBestActions.length > 0 ? (
            <section className="card p-5">
              <h2 className="font-bold">Next best actions</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                Rule-based suggestions, ordered by urgency
              </p>
              <ul className="mt-3 space-y-2.5">
                {lead.nextBestActions.slice(0, 4).map((action) => (
                  <li
                    key={action.code}
                    className={`rounded-lg border-l-[3px] bg-[var(--color-surface-muted)] py-2 pl-3 pr-2 ${
                      action.urgency === 'HIGH'
                        ? 'border-danger-500'
                        : action.urgency === 'MEDIUM'
                          ? 'border-warn-500'
                          : 'border-navy-300'
                    }`}
                  >
                    <p className="text-sm font-semibold">{action.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{action.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="font-bold">Why this score</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
              {lead.score} of 100 · {humanise(lead.scoreBand)}
            </p>
            {/* The breakdown is the point. An unexplained score gets ignored by
                a sales floor, and correctly so. */}
            <ul className="mt-3 space-y-1.5 text-sm">
              {lead.scoreFactors.map((factor) => (
                <li key={factor.code} className="flex items-baseline justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">{factor.label}</span>
                  <span
                    className={`shrink-0 font-bold tnum ${
                      factor.points >= 0 ? 'text-teal-600 dark:text-teal-300' : 'text-danger-500'
                    }`}
                  >
                    {factor.points >= 0 ? '+' : ''}
                    {factor.points}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">Details</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Detail label="Owner" value={lead.owner?.fullName ?? 'Unassigned'} />
              <Detail label="Source" value={humanise(lead.source)} />
              <Detail label="Branch" value={lead.orgUnit?.name ?? '—'} />
              <Detail label="Partner" value={lead.partner?.name ?? '—'} />
              <Detail label="Campaign" value={lead.campaign?.name ?? '—'} />
              <Detail label="PAN" value={lead.panMasked || '—'} />
              <Detail
                label="Next follow-up"
                value={lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : 'Not scheduled'}
              />
              <Detail
                label="Last contact"
                value={lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : 'Never'}
              />
              <Detail label="Created" value={formatDate(lead.createdAt)} />
              {lead.lostReason ? (
                <Detail label="Lost reason" value={humanise(lead.lostReason)} />
              ) : null}
            </dl>
          </section>

          {lead.attribution.utmSource || lead.attribution.landingPath ? (
            <section className="card p-5">
              <h2 className="font-bold">Attribution</h2>
              <dl className="mt-3 space-y-2 text-xs">
                {Object.entries(lead.attribution)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <Detail key={key} label={humanise(key.replace(/^utm/, 'UTM '))} value={value!} />
                  ))}
              </dl>
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="font-bold">Stage history</h2>
            <ol className="mt-3 space-y-2 text-xs">
              {lead.statusHistory.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-2">
                  <span>
                    {entry.fromStatus ? `${humanise(entry.fromStatus)} → ` : ''}
                    <span className="font-semibold">{humanise(entry.toStatus)}</span>
                  </span>
                  <span className="shrink-0 text-[var(--color-text-subtle)]">
                    {formatDate(entry.changedAt)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--color-text-muted)]">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
