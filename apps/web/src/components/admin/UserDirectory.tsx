'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState } from 'react';
import type { UserSummary } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { humanise } from '@/lib/format';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  SUSPENDED: 'red',
  LOCKED: 'red',
  DISABLED: 'neutral',
};

type SortKey = 'name' | 'designation' | 'manager' | 'branch' | 'status';
type Direction = 'asc' | 'desc';

/**
 * Sorting and filtering happen here, in the browser.
 *
 * The endpoint returns everyone in the administrator's scope in one response
 * rather than a page at a time, so there is nothing to fetch when a column is
 * clicked — sorting server-side would add a round-trip to reorder rows already
 * on screen. If this list ever grows past a few thousand people it should move
 * to the API with the sort in the query string, and the column headers are
 * already the right shape for that.
 */
export function UserDirectory({
  users,
  canUpdate,
  actorId,
}: {
  users: UserSummary[];
  canUpdate: boolean;
  /** Nobody may edit themselves through this screen — see the detail page. */
  actorId: string;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [designation, setDesignation] = useState('');
  const [branch, setBranch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction } | null>(null);

  const designations = useMemo(
    () => [...new Set(users.map((u) => u.designation?.name).filter(Boolean))].sort() as string[],
    [users],
  );
  const branches = useMemo(
    () => [...new Set(users.map((u) => u.orgUnit?.name).filter(Boolean))].sort() as string[],
    [users],
  );
  const roles = useMemo(
    () => [...new Set(users.flatMap((u) => u.roles))].sort(),
    [users],
  );
  const statuses = useMemo(() => [...new Set(users.map((u) => u.status))].sort(), [users]);

  const activeFilters =
    (search ? 1 : 0) +
    (designation ? 1 : 0) +
    (branch ? 1 : 0) +
    (role ? 1 : 0) +
    (status ? 1 : 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = users.filter((person) => {
      if (designation && person.designation?.name !== designation) return false;
      if (branch && person.orgUnit?.name !== branch) return false;
      if (role && !person.roles.includes(role)) return false;
      if (status && person.status !== status) return false;
      if (!needle) return true;
      // Employee code and email matter as much as the name here: an
      // administrator chasing a support ticket has the code, not the spelling.
      return [person.fullName, person.email, person.employeeCode ?? '', person.reference]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    if (!sort) return filtered;

    const value = (person: UserSummary): string | number => {
      switch (sort.key) {
        case 'name':
          return person.fullName.toLowerCase();
        // By rank, not alphabetically. "Zonal Head" sorting below "Area
        // Manager" is not an ordering anybody wants from a hierarchy column.
        case 'designation':
          return person.designation?.level ?? -1;
        case 'manager':
          return (person.manager?.fullName ?? '').toLowerCase();
        case 'branch':
          return (person.orgUnit?.name ?? '').toLowerCase();
        case 'status':
          return person.status.toLowerCase();
      }
    };

    return [...filtered].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const order = left < right ? -1 : left > right ? 1 : 0;
      return sort.direction === 'asc' ? order : -order;
    });
  }, [users, search, designation, branch, role, status, sort]);

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current?.key === key
        ? current.direction === 'asc'
          ? { key, direction: 'desc' }
          : // Third click returns to the order the server sent, which is most
            // senior first. Without it there is no way back to that view.
            null
        : { key, direction: 'asc' },
    );

  const clearAll = () => {
    setSearch('');
    setDesignation('');
    setBranch('');
    setRole('');
    setStatus('');
  };

  const columns: Array<{ label: string; key: SortKey | null }> = [
    { label: 'Name', key: 'name' },
    { label: 'Designation', key: 'designation' },
    { label: 'Reports to', key: 'manager' },
    { label: 'Branch', key: 'branch' },
    { label: 'Roles', key: null },
    { label: 'Status', key: 'status' },
    { label: '', key: null },
  ];

  return (
    <div className="space-y-3">
      <div className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <span
              aria-hidden
              className={`inline-block transition-transform ${showFilters ? 'rotate-90' : ''}`}
            >
              ›
            </span>
            Filters
            {activeFilters > 0 ? (
              <Badge tone="teal">{activeFilters}</Badge>
            ) : null}
          </button>

          <p className="text-xs text-[var(--color-text-muted)] tnum">
            {visible.length === users.length
              ? `${users.length} ${users.length === 1 ? 'person' : 'people'}`
              : `${visible.length} of ${users.length}`}
          </p>
        </div>

        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or employee code…"
              aria-label="Search users"
              className="input h-9 min-w-[15rem] flex-1"
            />

            <select
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              aria-label="Filter by designation"
              className="input h-9 w-auto"
            >
              <option value="">All designations</option>
              {designations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              aria-label="Filter by branch"
              className="input h-9 w-auto"
            >
              <option value="">All branches</option>
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              aria-label="Filter by role"
              className="input h-9 w-auto"
            >
              <option value="">All roles</option>
              {roles.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
              className="input h-9 w-auto"
            >
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </select>

            {activeFilters > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
              <tr>
                {columns.map((column) => {
                  const active = column.key && sort?.key === column.key;
                  return (
                    <th
                      key={column.label}
                      aria-sort={
                        active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                    >
                      {column.key ? (
                        <button
                          type="button"
                          onClick={() => toggle(column.key as SortKey)}
                          className={`flex items-center gap-1 uppercase tracking-wide ${
                            active ? 'text-[var(--color-text)]' : ''
                          }`}
                        >
                          {column.label}
                          <span aria-hidden className="text-[0.7rem]">
                            {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visible.map((person) => (
                <tr key={person.id} className="hover:bg-[var(--color-surface-muted)]">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{person.fullName}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      {person.email}
                      {person.employeeCode ? ` · ${person.employeeCode}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {person.designation ? (
                      <>
                        <span className="font-semibold">{person.designation.name}</span>
                        <span className="ml-1 text-[var(--color-text-subtle)]">
                          L{person.designation.level}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">Non-sales</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {person.manager?.fullName ?? (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    )}
                    {person.directReports > 0 ? (
                      <span className="ml-1 text-[var(--color-text-subtle)]">
                        ({person.directReports} report{person.directReports === 1 ? '' : 's'})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs">{person.orgUnit?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {person.roles.map((role) => (
                        <Badge key={role} tone="navy">
                          {role.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[person.status] ?? 'neutral'}>
                      {humanise(person.status)}
                    </Badge>
                    {/* An invited account has no password at all, so it is not
                        merely inactive — nobody can sign in until credentials
                        are issued. Saying so here prevents a support call. */}
                    {person.status === 'INVITED' ? (
                      <p className="mt-1 text-[0.6875rem] text-warn-600">Cannot sign in yet</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canUpdate && person.id !== actorId ? (
                      <Link
                        href={`/admin/users/${person.id}` as Route}
                        className="btn btn-outline h-8 text-xs"
                      >
                        Manage
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="card p-6 text-center text-sm text-[var(--color-text-muted)]">
          {users.length === 0
            ? 'No users visible in your part of the organisation.'
            : 'Nobody matches these filters.'}
        </p>
      ) : null}
    </div>
  );
}
