import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NewCampaignForm } from '@/components/campaigns/NewCampaignForm';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  const user = await requireUser();
  // Guarded here as well as in the nav: a permission check that only exists in
  // the menu is a permission check somebody can navigate around.
  if (!can(user, 'campaign:create')) redirect('/campaigns');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/campaigns"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All campaigns
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">New campaign</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Every lead that arrives through this campaign&apos;s tracking link is attributed to it
          automatically.
        </p>
      </header>

      <NewCampaignForm />
    </div>
  );
}
