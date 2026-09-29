import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NewEventForm } from '@/components/events/NewEventForm';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

interface OrgUnitNode {
  id: string;
  name: string;
  path: string;
}

export const metadata = { title: 'New event' };

export default async function NewEventPage() {
  const user = await requireUser();
  if (!can(user, 'event:create')) redirect('/events');

  /*
    Both lists are optional. Whoever may create an event does not necessarily
    hold `user:read`, and a missing list must not stop them creating one — the
    API still defaults the owner to the creator and the branch to their own.
  */
  const [owners, units] = await Promise.all([
    apiFetch<Array<{ id: string; fullName: string }>>('/users/assignable').catch(() => []),
    apiFetch<OrgUnitNode[]>('/org-units').catch(() => [] as OrgUnitNode[]),
  ]);

  // Indented by depth so the tree reads as a tree in a flat select. Depth comes
  // from the materialised path, which is the only ordering the API guarantees.
  const branches = units
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      depth: Math.max(0, unit.path.split('/').filter(Boolean).length - 1),
    }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/events"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All events
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">New event</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          You will get a QR code to print. Every scan becomes a lead tagged to this event.
        </p>
      </header>

      <NewEventForm owners={owners} branches={branches} defaultOwnerId={user.id} />
    </div>
  );
}
