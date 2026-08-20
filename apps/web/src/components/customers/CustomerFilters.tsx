'use client';

import { useEffect, useState } from 'react';
import {
  CUSTOMER_STATUSES,
  ONBOARDING_STAGES,
  PRODUCT_DIMENSIONS,
  type ProductDimension,
  type ProductItem,
} from '@sihl-one/contracts';

import { FilterBar, FilterBarBoundary } from '@/components/filters/FilterBar';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { useFilters } from '@/components/filters/useFilters';
import { humanise } from '@/lib/format';

const OWNED_KEYS = ['q', 'status', 'onboardingStage', 'productInterest', 'productDimension'] as const;

const DIMENSION_LABEL: Record<ProductDimension, string> = {
  opportunity: 'Opportunity',
  interested: 'Interested',
  holds: 'Holds',
};

const DIMENSION_HINT: Record<ProductDimension, string> = {
  opportunity: 'Wants it, does not hold it',
  interested: 'Expressed interest, held or not',
  holds: 'Already holds it',
};

export function CustomerFilters({ products }: { products: ProductItem[] }) {
  return (
    <FilterBarBoundary>
      <CustomerFiltersInner products={products} />
    </FilterBarBoundary>
  );
}

function CustomerFiltersInner({ products }: { products: ProductItem[] }) {
  const { searchParams, apply, clear, pending, activeCount, values } = useFilters(OWNED_KEYS);
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
  }, [searchParams]);

  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (search === current) return;
    const timer = setTimeout(() => apply({ q: search || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const status = searchParams.get('status') ?? '';
  const stage = searchParams.get('onboardingStage') ?? '';
  const selectedProducts = values('productInterest');
  const dimension = (searchParams.get('productDimension') ?? 'opportunity') as ProductDimension;

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
        placeholder="Name, mobile, email, reference or client code…"
        className="input h-9 min-w-[16rem] flex-1"
        aria-label="Search customers"
      />

      <select
        value={status}
        onChange={(event) => apply({ status: event.target.value || null })}
        className="input h-9 w-auto"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {CUSTOMER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {humanise(value)}
          </option>
        ))}
      </select>

      <select
        value={stage}
        onChange={(event) => apply({ onboardingStage: event.target.value || null })}
        className="input h-9 w-auto"
        aria-label="Filter by onboarding stage"
      >
        <option value="">All stages</option>
        {ONBOARDING_STAGES.map((value) => (
          <option key={value} value={value}>
            {humanise(value)}
          </option>
        ))}
      </select>

      <MultiSelectFilter
        label="Products"
        allLabel="All products"
        options={products.map((product) => ({ value: product.code, label: product.name }))}
        selected={selectedProducts}
        onChange={(next) => apply({ productInterest: next.length ? next : null })}
      />

      {/* Only meaningful once a product is chosen — "Opportunity" with nothing
          selected is a question about nothing, and showing it always invites
          people to change it and wonder why the list did not move. */}
      {selectedProducts.length > 0 ? (
        <select
          value={dimension}
          onChange={(event) => apply({ productDimension: event.target.value })}
          className="input h-9 w-auto"
          aria-label="Which product relationship to filter on"
          title={DIMENSION_HINT[dimension]}
        >
          {PRODUCT_DIMENSIONS.map((value) => (
            <option key={value} value={value}>
              {DIMENSION_LABEL[value]}
            </option>
          ))}
        </select>
      ) : null}
    </FilterBar>
  );
}
