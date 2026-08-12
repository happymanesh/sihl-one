import { redirect } from 'next/navigation';
import type { MessageLogItem } from '@sihl-one/contracts';

import { MessagingManager } from '@/components/messaging/MessagingManager';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Messaging' };

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  channel: string;
  purpose: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

export default async function MessagingPage() {
  const user = await requireUser();
  if (!can(user, 'campaign:read')) redirect('/dashboard');

  const [templates, log] = await Promise.all([
    apiFetch<TemplateRow[]>('/messaging/templates'),
    apiFetch<MessageLogItem[]>('/messaging/log?limit=40'),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Messaging</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Templates and what has gone out. Nothing sends to a real provider yet — messages are
          recorded so the whole path can be checked before credentials are added.
        </p>
      </header>

      <MessagingManager
        templates={templates}
        log={log}
        canCreate={can(user, 'campaign:create')}
      />
    </div>
  );
}
