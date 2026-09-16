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

/**
 * Just the badge number, for the bell to poll on.
 *
 * Deliberately separate from `fetchNotifications`: this runs on a timer for
 * every signed-in user, so it has to stay the cheapest call in the app. Pulling
 * twenty rows to render one integer would multiply that cost by twenty for a
 * number nobody has clicked on.
 */
export async function fetchUnreadCount(): Promise<number | null> {
  try {
    const result = await apiFetch<{ unread: number }>('/notifications/unread-count');
    return result.unread;
  } catch {
    // Null rather than 0: a failed poll must not silently clear a badge that
    // is genuinely showing unread work. The bell keeps what it had.
    return null;
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
