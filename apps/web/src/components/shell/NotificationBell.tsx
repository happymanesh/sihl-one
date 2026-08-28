'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { NotificationView } from '@sihl-one/contracts';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '@/app/actions/notifications';
import { formatRelative } from '@/lib/format';
import { Icon } from './Icon';

/**
 * The bell.
 *
 * The unread count arrives as a prop from the layout, so it is correct on every
 * navigation without this component polling. Rows are fetched when the panel
 * opens, because until then nobody needs them.
 *
 * **Opening the panel does not mark everything read.** That is the common
 * default and it destroys the thing the bell is for: you glance at it, the
 * count clears, and the two items that mattered are now indistinguishable from
 * the forty that did not. Reading happens on click-through, or explicitly.
 */
export function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Optimistic, so the badge responds to a click rather than waiting for the
  // layout to re-render. The server value wins again on the next navigation.
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set());
  const badge = Math.max(0, unread - readLocally.size);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchNotifications().then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click and on Escape. A panel that traps the page is worse
  // than no panel.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const readOne = (id: string) => {
    if (readLocally.has(id)) return;
    setReadLocally((prev) => new Set(prev).add(id));
    startTransition(() => void markNotificationsRead([id]));
  };

  const readAll = () => {
    const unreadIds = (items ?? []).filter((n) => !n.readAt).map((n) => n.id);
    setReadLocally((prev) => new Set([...prev, ...unreadIds]));
    setItems((prev) =>
      prev ? prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })) : prev,
    );
    startTransition(() => void markAllNotificationsRead());
  };

  const href = (n: NotificationView): Route | null => {
    if (!n.entityId) return null;
    if (n.entityType === 'LEAD') return `/leads/${n.entityId}` as Route;
    if (n.entityType === 'TASK') return '/tasks' as Route;
    if (n.entityType === 'IMPORT') return '/leads' as Route;
    return null;
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost relative px-2"
        aria-label={badge > 0 ? `Notifications, ${badge} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {badge > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-danger-500 px-1 text-[10px] font-bold leading-[17px] text-white"
          >
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <p className="text-sm font-bold">Notifications</p>
            {(items ?? []).some((n) => !n.readAt) ? (
              <button
                type="button"
                onClick={readAll}
                disabled={pending}
                className="text-xs font-semibold text-teal-600 hover:underline disabled:opacity-50 dark:text-teal-300"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <ul className="max-h-[24rem] overflow-y-auto">
            {items === null ? (
              <li className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                Loading…
              </li>
            ) : items.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                Nothing yet. You will be told here when a lead or a task is assigned to you.
              </li>
            ) : (
              items.map((n) => {
                const target = href(n);
                const isUnread = !n.readAt && !readLocally.has(n.id);
                const inner = (
                  <>
                    <span className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          isUnread ? 'bg-teal-500' : 'bg-transparent'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${isUnread ? 'font-semibold' : 'text-[var(--color-text-muted)]'}`}
                        >
                          {n.title}
                        </span>
                        {n.body ? (
                          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                            {n.body}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">
                          {n.actorName ? `${n.actorName} · ` : ''}
                          {formatRelative(n.createdAt)}
                        </span>
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={n.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    {target ? (
                      <Link
                        href={target}
                        onClick={() => {
                          readOne(n.id);
                          setOpen(false);
                        }}
                        className="block px-3 py-2.5 hover:bg-[var(--color-surface-muted)]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => readOne(n.id)}
                        className="block w-full px-3 py-2.5 text-left hover:bg-[var(--color-surface-muted)]"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
