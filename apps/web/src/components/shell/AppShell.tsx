'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@sihl-one/contracts';

import { Logo } from '@/components/brand/Logo';
import { Icon } from './Icon';
import { IdleTimeout } from './IdleTimeout';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { SECTION_LABELS, visibleNavItems, type NavItem } from './navigation';

export function AppShell({
  user,
  children,
  onLogout,
  unreadNotifications = 0,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
  onLogout: () => Promise<void>;
  /** Read in the layout, so the badge is correct on every navigation. */
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const items = visibleNavItems(user);

  // Close the drawer on navigation. Without this it stays open over the page
  // the user just chose, which on a phone reads as "the tap did nothing".
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Collapsed state is a per-user preference, remembered the same way the theme
  // is. It applies only from `lg` up: on a phone the sidebar is already a
  // drawer, and a collapsed drawer would be a strip of icons over the page.
  useEffect(() => {
    setCollapsed(localStorage.getItem('sihl-nav-collapsed') === 'true');
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem('sihl-nav-collapsed', String(next));
      return next;
    });
  };

  const sections = (['work', 'grow', 'admin'] as const)
    .map((section) => ({ section, items: items.filter((item) => item.section === section) }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      className={`min-h-screen lg:grid ${
        collapsed ? 'lg:grid-cols-[68px_1fr]' : 'lg:grid-cols-[248px_1fr]'
      }`}
    >
      {/* Mobile scrim */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-[68px]' : 'lg:w-[248px]'}`}
      >
        <div className="flex h-14 items-center gap-1 border-b border-[var(--color-border)] px-4">
          <Link href="/dashboard" className={collapsed ? 'lg:hidden' : undefined}>
            <Logo size="sm" />
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="btn btn-ghost ml-auto hidden px-2 lg:inline-flex"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <Icon name="menu" size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {sections.map((group) => (
            <div key={group.section} className="mb-5">
              <p
                className={`px-2 pb-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] ${
                  collapsed ? 'lg:hidden' : ''
                }`}
              >
                {SECTION_LABELS[group.section]}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 px-4 backdrop-blur">
          <button
            type="button"
            className="btn btn-ghost -ml-2 px-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Icon name="menu" size={20} />
          </button>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell unread={unreadNotifications} />
            <div className="ml-1 border-l border-[var(--color-border)] pl-1">
              <UserMenu user={user} onLogout={onLogout} />
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>

      <IdleTimeout onLogout={onLogout} />
    </div>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  // Exact match for the dashboard, prefix match elsewhere, so /leads/abc still
  // highlights "Leads" but /dashboard does not stay lit on every page.
  const active =
    item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);

  // Hidden at `lg` when collapsed rather than removed, so the drawer on a phone
  // still shows labels and screen readers always have the name.
  const labelClass = collapsed ? 'lg:hidden' : '';

  if (item.available === false) {
    return (
      <li>
        <span
          aria-disabled="true"
          title={`${item.label} is not built yet`}
          className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-[var(--color-text-subtle)] opacity-60"
        >
          <Icon name={item.icon} size={17} />
          <span className={`flex-1 ${labelClass}`}>{item.label}</span>
          <span
            className={`rounded-full bg-[var(--color-surface-inset)] px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide ${labelClass}`}
          >
            Soon
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        // The title is the tooltip a collapsed rail needs; harmless when expanded.
        title={item.label}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors ${
          active
            ? 'bg-navy-500 text-white'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]'
        }`}
      >
        <Icon name={item.icon} size={17} />
        <span className={labelClass}>{item.label}</span>
      </Link>
    </li>
  );
}

function GlobalSearch() {
  return (
    <form action="/leads" className="relative max-w-md flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]">
        <Icon name="search" size={16} />
      </span>
      <input
        name="q"
        type="search"
        className="input h-9 pl-8"
        placeholder="Search leads by name, mobile or reference…"
        aria-label="Search leads"
      />
    </form>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Read the theme the blocking script in the root layout already applied,
  // rather than deciding again here and risking a mismatch.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sihl-theme', next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost px-2"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
