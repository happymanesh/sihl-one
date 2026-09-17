import Link from 'next/link';
import type { MeetingModeItem } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { InstaLeadForm } from '@/components/leads/InstaLeadForm';

export const metadata = { title: 'Insta Lead' };

interface Colleague {
  id: string;
  fullName: string;
  employeeCode?: string | null;
}

/**
 * Insta Lead — somebody is in front of you now.
 *
 * Its own route rather than a mode of the full Add lead form, so it can be
 * bookmarked, sent to the team in a message, and reached from the phone's home
 * screen as an app shortcut. A rep opening this has seconds, not minutes.
 */
export default async function InstaLeadPage() {
  await requireUser();

  const [modes, colleagues] = await Promise.all([
    apiFetch<MeetingModeItem[]>('/masters/meeting-modes').catch(() => [] as MeetingModeItem[]),
    apiFetch<Colleague[]>('/users/colleagues').catch(() => [] as Colleague[]),
  ]);

  /*
    The mode codes are read from the master rather than hard-coded.

    `lead.source` taught this lesson once already: a code that has drifted
    between environments is a foreign key violation at the worst moment. The
    photo requirement is the real discriminator, so the modes are chosen by what
    they demand rather than by name.
  */
  const clientSite = modes.find((mode) => mode.requiresPhoto) ?? modes[0];
  const office =
    modes.find((mode) => !mode.requiresPhoto && mode.code !== clientSite?.code) ?? clientSite;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/leads" className="hover:underline">
          Leads
        </Link>
        <span aria-hidden> / </span>
        <span>Insta Lead</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Insta Lead</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Someone in front of you now. Name and number is enough — the meeting starts as soon as
          you tap.
        </p>
      </div>

      <div className="card p-5">
        {clientSite && office ? (
          <InstaLeadForm
            colleagues={colleagues}
            clientSiteMode={clientSite.code}
            officeMode={office.code}
          />
        ) : (
          /* No meeting modes in the master means the visit cannot be created at
             all. Said plainly, with the ordinary form offered instead, rather
             than showing a button that will fail on tap. */
          <div className="text-sm">
            <p className="font-semibold">Meeting types are not set up yet.</p>
            <p className="mt-2 text-[var(--color-text-muted)]">
              An administrator needs to add them under Sources &amp; products before a meeting can
              be recorded this way.
            </p>
            <p className="mt-4">
              <Link href="/leads/new" className="btn btn-outline">
                Use the full lead form
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
