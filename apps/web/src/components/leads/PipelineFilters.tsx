'use client';

import type { ProductItem } from '@sihl-one/contracts';

import { FilterBar, FilterBarBoundary } from '@/components/filters/FilterBar';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { useFilters } from '@/components/filters/useFilters';

const OWNED_KEYS = ['productInterest'] as const;

/**
 * Pipeline filters.
 *
 * Deliberately narrower than the leads list: the board is already partitioned
 * by status, so a status filter here would fight the columns. Product is the
 * question the board cannot answer on its own — "where is my PMS pipeline
 * sitting?" — which is why it is the one filter offered.
 */
export function PipelineFilters({ products }: { products: ProductItem[] }) {
  return (
    <FilterBarBoundary>
      <PipelineFiltersInner products={products} />
    </FilterBarBoundary>
  );
}

function PipelineFiltersInner({ products }: { products: ProductItem[] }) {
  const { apply, clear, pending, activeCount, values } = useFilters(OWNED_KEYS);

  return (
    <FilterBar pending={pending} activeCount={activeCount} onClear={clear}>
      <MultiSelectFilter
        label="Products"
        allLabel="All products"
        options={products.map((product) => ({ value: product.code, label: product.name }))}
        selected={values('productInterest')}
        onChange={(next) => apply({ productInterest: next.length ? next : null })}
      />
      <span className="text-xs text-[var(--color-text-subtle)]">
        Narrows every column. Stage totals follow the filter.
      </span>
    </FilterBar>
  );
}
