import Link from 'next/link';
import {
  CLOSED_LEAD_STATUSES,
  canTransferLeads,
  ownsLeadProduct,
  type LeadProductView,
  type LeadProfileView,
  type MeetingModeItem,
  type MobileVerificationMethod,
  type ProductItem,
} from '@sihl-one/contracts';
import type { Route } from 'next';

import { LeadStatusBadge, PriorityBadge, ScoreBadge } from '@/components/ui/Badge';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { Icon } from '@/components/shell/Icon';
import { LeadActions } from '@/components/leads/LeadActions';
import { Timeline } from '@/components/leads/Timeline';
import { LeadProductOutcomes } from '@/components/leads/LeadProductOutcomes';
import { RenameLead } from '@/components/leads/RenameLead';
import { LeadRecordTabs } from '@/components/leads/LeadRecordTabs';
import { LeadAssignPanel } from '@/components/leads/LeadAssignPanel';
import { LeadProductsPanel } from '@/components/leads/LeadProductsPanel';
import { MissingProductsPrompt } from '@/components/leads/MissingProductsPrompt';
import { LeadProfilePanel } from '@/components/leads/LeadProfilePanel';
import { VerifyMobile } from '@/components/leads/VerifyMobile';
import { apiFetch } from '@/lib/api';
import { BackLink } from '@/components/ui/BackLink';
import { can, requireUser } from '@/lib/auth';
import { formatCurrency, formatDate, formatDateTime, formatRelative, humanise } from '@/lib/format';

interface LeadDetail {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
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
  profile: LeadProfileView | null;
  estimatedValue: string | null;
  score: number;
  scoreBand: string;
  scoreFactors: Array<{ code: string; label: string; points: number }>;
  nextBestActions: Array<{ code: string; title: string; reason: string; urgency: string }>;
  owner: { id: string; fullName: string; email: string } | null;
  createdBy: { id: string; fullName: string } | null;
  capturedBy: { id: string; fullName: string } | null;
  event: { id: string; name: string; code: string } | null;
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
    /** Null for a change to the lead as a whole. */
    productCode: string | null;
    productName: string | null;
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
  designation: string | null;
  productGroups: string[];
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
        Array<{
          code: string;
          name: string;
          channel: string;
          purpose: string;
          body: string;
          isActive: boolean;
        }>
      >('/messaging/templates')
        .then((rows) => rows.filter((row) => row.isActive))
        .catch(() => [])
    : [];

  const assignable = can(user, 'lead:assign')
    ? await apiFetch<AssignableUser[]>('/users/assignable').catch(() => [])
    : [];

  // Where each product stands. Empty for a lead nobody has ticked a product on
  // yet, which the panel handles by not rendering.
  const productOutcomes = await apiFetch<LeadProductView[]>(`/leads/${id}/products`).catch(
    () => [] as LeadProductView[],
  );

  // A wider list, fetched only for someone who may actually transfer. The API
  // ignores the flag for anyone else, so this cannot become a staff directory
  // for a rep who happens to call it.
  const canTransfer = can(user, 'lead:assign') && canTransferLeads(user.dataScope);
  const transferTargets = canTransfer
    ? await apiFetch<AssignableUser[]>('/users/assignable?for=transfer').catch(() => [])
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

  /*
    Which products on this lead are this person's to act on.

    Codes rather than a predicate, because a function cannot cross into a client
    component. One list, used for both the status change and the assign panel,
    so the two cannot disagree about what somebody holds.
  */
  const viewer = { id: user.id, isSuperAdmin: can(user, 'system:configure') };
  const myProductCodes = productOutcomes
    .filter((row) =>
      ownsLeadProduct(viewer, { ownerId: row.owner?.id ?? null }, lead.owner?.id ?? null),
    )
    .map((row) => row.productCode);

  return (
    <div className="space-y-5">
      {/*
        Back and the breadcrumb together, because they answer different
        questions. The breadcrumb says where this record lives; Back says
        where the reader was. A lead is opened from Tasks, Pipeline, Visits,
        Duplicates and search, and sending all of them to the full leads list
        loses both their place and their filters.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BackLink fallback="/leads" />
        <nav className="text-xs text-[var(--color-text-muted)]">
          <Link href="/leads" className="hover:underline">
            Leads
          </Link>
          <span className="mx-1.5" aria-hidden>
            /
          </span>
          <span className="font-mono">{lead.reference}</span>
        </nav>
      </div>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold">{lead.fullName}</h1>
              <LeadStatusBadge status={lead.status} />
              <PriorityBadge priority={lead.priority} />
              {/* Converted leads are read-only in the API — the customer record
                  owns the name from that point. */}
              <RenameLead
                leadId={lead.id}
                firstName={lead.firstName}
                lastName={lead.lastName}
                canEdit={can(user, 'lead:update') && lead.status !== 'CONVERTED'}
              />
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

            {/*
              A confirmed number with no product recorded is the one state a
              lead cannot be worked from, so it is asked about rather than left
              to be noticed. Only for the person who can actually answer.
            */}
            {lead.mobileVerifiedAt &&
            lead.productInterest.length === 0 &&
            productOutcomes.length === 0 &&
            can(user, 'lead:update') ? (
              <MissingProductsPrompt
                leadId={lead.id}
                leadName={lead.fullName}
                mobile={lead.mobile}
                products={products}
              />
            ) : null}

            <LeadProductsPanel
              leadId={lead.id}
              selected={lead.productInterest}
              products={products}
              leadProducts={productOutcomes}
              canEdit={can(user, 'lead:update')}
            />
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
            transferTargets={transferTargets}
            leadProducts={productOutcomes}
            canTransfer={canTransfer}
            templates={templates}
            email={lead.email}
            canUpdate={can(user, 'lead:update')}
            canAssign={can(user, 'lead:assign')}
            canConvert={can(user, 'lead:convert')}
            voiceInputEnabled={voiceInputEnabled()}
            meetingModes={meetingModes}
            products={products}
          />

          <LeadProductOutcomes
            leadId={lead.id}
            outcomes={productOutcomes}
            // Only the person working a product may record its outcome, so
            // Change appears per row rather than for the whole panel.
            editableCodes={can(user, 'lead:update') ? myProductCodes : []}
            leadOwnerName={lead.owner?.fullName ?? 'Unassigned'}
            // Requests routed to this person, and anything for a super admin.
            canDecideApproval={
              productOutcomes.some((row) => row.approval?.approver.id === user.id) ||
              can(user, 'system:configure')
            }
          />

          <LeadProfilePanel
            leadId={lead.id}
            profile={lead.profile}
            canEdit={can(user, 'lead:update')}
          />

          {/* One card, two panes. Stacked, a long timeline pushed the
              documents somewhere nobody scrolled to. */}
          <LeadRecordTabs
            activityCount={lead.activityCount}
            /*
              Shown to anybody who may hand work on at all.

              That is `lead:assign`, which the per-user "may assign leads to
              other people" switch subtracts — so the switch alone decides who
              sees this. The panel then shows only the products this person is
              working, which is what they are able to give away.
            */
            assign={
              can(user, 'lead:assign') ? (
                <LeadAssignPanel
                  leadId={lead.id}
                  leadProducts={productOutcomes}
                  assignableCodes={myProductCodes}
                  assignable={assignable.map((person) => ({
                    id: person.id,
                    fullName: person.fullName,
                    designation: person.designation,
                    branch: person.orgUnit,
                    productGroups: person.productGroups ?? [],
                  }))}
                  groupOfProduct={Object.fromEntries(
                    products.map((product) => [product.code, product.groupCode ?? null]),
                  )}
                  leadOwnerName={lead.owner?.fullName ?? 'Unassigned'}
                />
              ) : null
            }
            activity={<Timeline entries={lead.timeline} />}
            documents={
              <DocumentPanel
                entityType="LEAD"
                entityId={lead.id}
                canUpload={can(user, 'lead:update')}
              />
            }
          />
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
              {/*
                Who put it in, and whose QR brought them in.

                Neither moves when the lead is handed on, which is why they sit
                beside the owner rather than instead of it — "who has this now"
                and "who found them" are different questions and the screen was
                only answering the first.

                Captured by appears only for a lead that came from an event,
                because for every other origin there is nobody to name and an
                empty row reads as missing data.
              */}
              <Detail label="Created by" value={lead.createdBy?.fullName ?? '—'} />
              {lead.event ? (
                <Detail label="Captured by" value={lead.capturedBy?.fullName ?? 'Common QR'} />
              ) : null}
              <Detail label="Source" value={humanise(lead.source)} />
              <Detail label="Branch" value={lead.orgUnit?.name ?? '—'} />
              <Detail label="Partner" value={lead.partner?.name ?? '—'} />
              <Detail label="Campaign" value={lead.campaign?.name ?? '—'} />
              <Detail label="PAN" value={lead.panMasked || '—'} />
              <Detail
                label="Next follow-up"
                /* Nothing left to chase on a closed lead, so the field says
                   so rather than reading as an unset date. */
                value={
                  lead.nextFollowUpAt
                    ? formatDateTime(lead.nextFollowUpAt)
                    : CLOSED_LEAD_STATUSES.has(lead.status)
                      ? 'Closed'
                      : 'Not scheduled'
                }
              />
              <Detail
                label="Last contact"
                value={lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : 'Never'}
              />
              <Detail label="Created" value={formatDate(lead.createdAt)} />
              {/*
                Only when the lead carries no products.

                With products, this field is a roll-up of the most recently
                lost one, so it repeats what the Products panel already shows
                per product — which is what the business reported as a
                leftover from the days of one status per lead.

                It is not removed outright, because a lead with no products
                has nowhere else to record why it was lost, and the database
                refuses a LOST lead without a reason
                (`lead_lost_requires_reason`). Same condition as the capture
                in LeadActions, so the two always agree.
              */}
              {lead.lostReason && productOutcomes.length === 0 ? (
                <Detail label="Lost reason" value={humanise(lead.lostReason)} />
              ) : null}
            </dl>

            {/*
              Who is working each product.

              The lead owner above answers "who is accountable for the client";
              this answers "who do I ring about the mutual funds", which since
              ownership went per-product is a different question and was not on
              the screen anywhere. A product nobody has been named for says so
              explicitly rather than showing a blank — "nobody" and "the lead
              owner" are different answers, and here they resolve to the same
              person.
            */}
            {productOutcomes.length > 0 ? (
              <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Product owners
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {productOutcomes.map((row) => (
                    <li key={row.productCode} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 shrink-0 text-[var(--color-text-muted)]">
                        {row.productName ?? row.productCode}
                      </span>
                      <span className="min-w-0 text-right">
                        {row.owner ? (
                          <>
                            <span className="font-medium">{row.owner.fullName}</span>
                            {row.owner.designation || row.owner.branch ? (
                              <span className="block text-xs text-[var(--color-text-subtle)]">
                                {[row.owner.designation, row.owner.branch]
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            ) : null}
                            {row.assignedAt ? (
                              <span className="block text-xs text-[var(--color-text-subtle)]">
                                since {formatDate(row.assignedAt)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">
                            {lead.owner?.fullName ?? 'Unassigned'}{' '}
                            <span className="text-xs">(lead owner)</span>
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {lead.attribution.utmSource || lead.attribution.landingPath ? (
            <section className="card p-5">
              <h2 className="font-bold">Attribution</h2>
              <dl className="mt-3 space-y-2 text-xs">
                {Object.entries(lead.attribution)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <Detail
                      key={key}
                      label={humanise(key.replace(/^utm/, 'UTM '))}
                      value={value!}
                    />
                  ))}
              </dl>
            </section>
          ) : null}
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
