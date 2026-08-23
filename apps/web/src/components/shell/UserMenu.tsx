'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { AuthenticatedUser } from '@sihl-one/contracts';

import { Icon } from './Icon';
import { humanise, initials } from '@/lib/format';

/**
 * Account menu in the top-right corner.
 *
 * The data scope stays visible here rather than being dropped in the move from
 * the sidebar. It is the answer to "why can't I see that lead?", which is
 * otherwise a support ticket — and it is the one piece of context a user cannot
 * work out for themselves.
 */
export function UserMenu({
  user,
  onLogout,
}: {
  user: AuthenticatedUser;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close on navigation, or the menu hangs over the page the user just chose.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Return focus to the trigger, or a keyboard user is dropped at the top
      // of the document with no idea where they are.
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-[var(--color-surface-muted)]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-500 text-xs font-bold text-white">
          {initials(fullName)}
        </span>
        {/* The name is hidden on narrow screens; the avatar alone is the target
            there, and the header has to leave room for search. */}
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">
          {user.firstName}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-1.5 w-64 overflow-hidden rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] shadow-overlay"
        >
          <div className="border-b border-[var(--color-border)] p-3">
            <p className="truncate text-sm font-bold">{fullName}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>

            <dl className="mt-2.5 space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-subtle)]">Role</dt>
                <dd className="truncate font-semibold">{humanise(user.roles[0])}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-subtle)]">Data scope</dt>
                <dd className="font-semibold">{humanise(user.dataScope)}</dd>
              </div>
              {user.orgUnitName ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--color-text-subtle)]">Branch</dt>
                  <dd className="truncate font-semibold">{user.orgUnitName}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          {/* Help lives here rather than as a sixth icon in the top bar: on a
              375-pixel screen that bar already carries five, and help is not
              tapped often enough mid-task to earn permanent space. This is
              where people look for things about themselves and the app. */}
          <a
            href="/help"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Help
          </a>
          <a
            href="/settings/security"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Security
          </a>
          <form action={onLogout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
            >
              <Icon name="logout" size={16} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
