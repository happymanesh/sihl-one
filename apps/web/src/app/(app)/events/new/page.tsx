import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NewEventForm } from '@/components/events/NewEventForm';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'New event' };

export default async function NewEventPage() {
  const user = await requireUser();
  if (!can(user, 'campaign:create')) redirect('/events');

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

      <NewEventForm />
    </div>
  );
}
