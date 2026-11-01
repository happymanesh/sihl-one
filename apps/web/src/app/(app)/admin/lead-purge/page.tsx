import { redirect } from 'next/navigation';

import { PurgeLeadPanel } from '@/components/admin/PurgeLeadPanel';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Purge a lead' };

/**
 * The hard delete, on a page of its own.
 *
 * Deliberately not a control on the lead record. Everything else that can be
 * done to a lead is done from the lead, and putting this there would make it
 * one more item in a menu — next to Transfer and Convert, a click away from
 * whatever somebody meant to press. A separate address somebody has to
 * navigate to is the cheapest possible friction and it is the right amount.
 *
 * Gated on `lead:purge` rather than on the SUPER_ADMIN role string. The API
 * checks the same permission, so the menu, the page and the endpoint agree by
 * construction; a role check here would be a fourth opinion that drifts the
 * first time the business re-cuts its roles.
 */
export default async function LeadPurgePage() {
  const user = await requireUser();
  if (!can(user, 'lead:purge')) redirect('/dashboard');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Purge a lead</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
          Permanently destroys a lead and everything hanging off it — interactions, tasks, visits,
          documents, consent records, messages. This is not the delete that marks a lead as removed
          and keeps the row; nothing purged here can be restored, from a backup or otherwise, and
          the only trace left is an entry in the audit trail.
        </p>
      </header>

      <div className="rounded-lg border border-warn-500/40 bg-warn-50 px-4 py-3 text-sm text-warn-600 dark:bg-warn-500/10">
        <p className="font-semibold">Use this for two things only.</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          <li>
            An erasure SIHL is obliged to carry out under the DPDP Act, on a request it has
            verified.
          </li>
          <li>Test or junk data that must not sit in a regulated book.</li>
        </ul>
        <p className="mt-1.5">
          A lead somebody simply wants out of their pipeline is a soft delete, done from the lead
          itself. A lead under investigation, in a complaint, or named in anything a regulator may
          ask about must not be purged at all.
        </p>
      </div>

      <PurgeLeadPanel />
    </div>
  );
}
