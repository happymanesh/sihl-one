'use client';

import { useEffect, useState } from 'react';
import { LEAD_STATUSES, type LeadSourceItem, type ProductItem } from '@sihl-one/contracts';

import { FilterBar, FilterBarBoundary, ToggleChip } from '@/components/filters/FilterBar';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { useFilters } from '@/components/filters/useFilters';
import { BulkAssignBar, type AssignableOption } from '@/components/leads/BulkAssignBar';
import { useLeadSelection } from '@/components/leads/LeadSelection';
import { humanise } from '@/lib/format';

const OWNED_KEYS = [
  'q',
  'status',
  'source',
  'productInterest',
  'priority',
  'overdueOnly',
  'minScore',
  'ownerId',
  'owned',
] as const;

export interface OwnerOption {
  id: string;
  fullName: string;
  employeeCode?: string | null;
}

export function LeadFilters({
  sources,
  products,
  owners = [],
  hasUnassigned = false,
  assignees = [],
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
  /** Distinct owners of the leads in scope. One choice means the control hides. */
  owners?: OwnerOption[];
  /** Whether anything in scope is held by nobody. */
  hasUnassigned?: boolean;
  /** People the caller may hand leads to. Empty unless bulk assignment applies. */
  assignees?: AssignableOption[];
}) {
  return (
    <FilterBarBoundary>
      <LeadFiltersInner
        sources={sources}
        products={products}
        owners={owners}
        hasUnassigned={hasUnassigned}
        assignees={assignees}
      />
    </FilterBarBoundary>
  );
}

function LeadFiltersInner({
  sources,
  products,
  owners,
  hasUnassigned,
  assignees,
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
  owners: OwnerOption[];
  hasUnassigned: boolean;
  assignees: AssignableOption[];
}) {
  const { searchParams, apply, clear, pending, activeCount, values } = useFilters(OWNED_KEYS);
  const selection = useLeadSelection();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  // Keep the box in step when the URL changes from elsewhere — a dashboard
  // deep-link, or the browser back button.
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
  }, [searchParams]);

  // Debounced: firing a request per keystroke would hammer the API and race its
  // own responses.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (search === current) return;
    const timer = setTimeout(() => apply({ q: search || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const status = searchParams.get('status') ?? '';
  const source = searchParams.get('source') ?? '';
  const overdueOnly = searchParams.get('overdueOnly') === 'true';
  const hotOnly = searchParams.get('minScore') === '70';
  // One control, two parameters. An owner is an id; "unassigned" is the absence
  // of one and cannot be expressed as an id, so it rides on `owned` and the
  // select maps between the two. Setting either always clears the other —
  // leaving both would ask for leads owned by a named person and by nobody.
  // Ticking anything puts the row into assign mode.
  const selecting = (selection?.selected.length ?? 0) > 0;
  const ownerValue =
    searchParams.get('ownerId') ?? (searchParams.get('owned') === 'none' ? 'none' : '');

  return (
    <FilterBar
      pending={pending}
      activeCount={activeCount}
      onClear={() => {
        setSearch('');
        clear();
      }}
    >
      {/*
        Search and assign take the same slot, never both.

        A search box live beside a selection is an invitation to filter the list
        out from under the batch you were about to move — the rows go, the ticks
        go with them, and the count you were reading was for leads you can no
        longer see. Only one of these is on screen at a time.
      */}
      {selecting ? null : (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, mobile, email or reference…"
          className="input h-9 min-w-[16rem] flex-1"
          aria-label="Search leads"
        />
      )}
      {/*
        Always mounted, never moved.

        It renders nothing when nothing is ticked, so the row looks the same as
        it always did — but it has to keep the same position in the tree across
        that change. Swapping it for the search box in a single slot would
        remount it the moment the selection empties, and the assignment result
        it is holding would be destroyed at exactly the moment it needs to be
        read: an assignment that says nothing looks like one that did nothing.
      */}
      <BulkAssignBar people={assignees} />

      <select
        value={status}
        onChange={(event) => apply({ status: event.target.value || null })}
        className="input h-9 w-auto"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {LEAD_STATUSES.map((value) => (
          <option key={value} value={value}>
            {humanise(value)}
          </option>
        ))}
      </select>

      <select
        value={source}
        onChange={(event) => apply({ source: event.target.value || null })}
        className="input h-9 w-auto"
        aria-label="Filter by source"
      >
        <option value="">All sources</option>
        {sources.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>

      {/*
        Whose leads. Hidden when there is only one owner in scope — a sales
        executive owns everything they can see, so the control would be a
        dropdown with a single entry and filtering by it would change nothing.
      */}
      {owners.length + (hasUnassigned ? 1 : 0) > 1 ? (
        <select
          value={ownerValue}
          onChange={(event) => {
            const value = event.target.value;
            apply(
              value === 'none'
                ? { ownerId: null, owned: 'none' }
                : { ownerId: value || null, owned: null },
            );
          }}
          className="input h-9 w-auto"
          aria-label="Filter by owner"
        >
          <option value="">All owners</option>
          {/*
            Offered only when the pile exists, and listed first because it is
            the one nobody is working: a lead with no owner has nobody to
            notice it, so the filter is the only thing that surfaces it.
          */}
          {hasUnassigned ? <option value="none">Unassigned</option> : null}
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.fullName}
              {owner.employeeCode ? ` [${owner.employeeCode}]` : ''}
            </option>
          ))}
        </select>
      ) : null}

      <MultiSelectFilter
        label="Products"
        allLabel="All products"
        options={products.map((product) => ({ value: product.code, label: product.name }))}
        selected={values('productInterest')}
        onChange={(next) => apply({ productInterest: next.length ? next : null })}
      />

      <ToggleChip
        active={overdueOnly}
        onClick={() => apply({ overdueOnly: overdueOnly ? null : 'true' })}
      >
        Overdue only
      </ToggleChip>

      <ToggleChip active={hotOnly} onClick={() => apply({ minScore: hotOnly ? null : '70' })}>
        Hot leads
      </ToggleChip>
    </FilterBar>
  );
}
