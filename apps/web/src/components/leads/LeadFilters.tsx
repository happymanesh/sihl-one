'use client';

import { useEffect, useState } from 'react';
import { LEAD_STATUSES, type LeadSourceItem, type ProductItem } from '@sihl-one/contracts';

import { FilterBar, FilterBarBoundary, ToggleChip } from '@/components/filters/FilterBar';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { useFilters } from '@/components/filters/useFilters';
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
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
  /** Empty for anyone who may not read users — a rep sees only their own book. */
  owners?: OwnerOption[];
}) {
  return (
    <FilterBarBoundary>
      <LeadFiltersInner sources={sources} products={products} owners={owners} />
    </FilterBarBoundary>
  );
}

function LeadFiltersInner({
  sources,
  products,
  owners,
}: {
  sources: LeadSourceItem[];
  products: ProductItem[];
  owners: OwnerOption[];
}) {
  const { searchParams, apply, clear, pending, activeCount, values } = useFilters(OWNED_KEYS);
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
  const ownerId = searchParams.get('ownerId') ?? '';

  return (
    <FilterBar
      pending={pending}
      activeCount={activeCount}
      onClear={() => {
        setSearch('');
        clear();
      }}
    >
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Name, mobile, email or reference…"
        className="input h-9 min-w-[16rem] flex-1"
        aria-label="Search leads"
      />

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
        Whose leads. Absent for a rep, who only ever sees their own book, so the
        control would be a dropdown with one entry and no purpose.
      */}
      {owners.length > 0 ? (
        <select
          value={ownerId}
          onChange={(event) => apply({ ownerId: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="Filter by owner"
        >
          <option value="">All owners</option>
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
