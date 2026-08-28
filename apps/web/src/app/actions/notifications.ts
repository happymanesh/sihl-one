'use server';

import { revalidatePath } from 'next/cache';
import type { NotificationView } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';

/**
 * The rows behind the bell, fetched when the panel opens rather than on every
 * page load.
 *
 * The badge count comes from the layout, which is cheap and needed everywhere.
 * The rows are needed only when somebody actually looks, and fetching twenty
 * notifications on every navigation to render a number nobody clicked would be
 * a query per page for nothing.
 */
export async function fetchNotifications(): Promise<NotificationView[]> {
  try {
    const page = await apiFetch<{ items: NotificationView[] }>(
      '/notifications?page=1&pageSize=20',
    );
    return page.items;
  } catch {
    // The bell is never the reason a page fails. An empty panel is a worse
    // experience than a full one and a much better one than an error screen
    // over a working application.
    return [];
  }
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await apiFetch('/notifications/read', { method: 'POST', body: { ids } });
    // The badge is rendered by the layout, so the count only moves once the
    // layout re-runs.
    revalidatePath('/', 'layout');
  } catch {
    // Ignored on purpose: failing to mark something read must not swallow the
    // click that opened the record.
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    await apiFetch('/notifications/read-all', { method: 'POST', body: {} });
    revalidatePath('/', 'layout');
  } catch {
    // As above.
  }
}
