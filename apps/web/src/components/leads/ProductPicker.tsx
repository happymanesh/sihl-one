'use client';

import type { ProductItem } from '@sihl-one/contracts';

/**
 * Product chips, with sub-products grouped under their parent.
 *
 * Extracted so "What are they interested in?" on the new-lead form and
 * "Products discussed" on the interaction form render identically. They had
 * drifted: the interaction form grouped Equity with Intraday and Delivery,
 * while the capture form listed all fourteen as equal pills, so a rep met the
 * same products laid out two different ways within a minute of each other and
 * had to work out for themselves that Intraday belonged under Equity.
 *
 * Chips flow and wrap; a parent and its sub-products form one unit, so a line
 * break can never separate "Equity" from "Intraday". An early attempt gave each
 * product its own row, which turned fourteen chips into fourteen lines — the
 * grouping was right and the layout was wrong.
 *
 * Dashed outline marks a sub-product as the narrower choice. Either can be
 * picked, and picking both is legitimate: a conversation can cover the product
 * in general and one variant in particular.
 */
export function ProductPicker({
  products,
  name,
  selected,
  onToggle,
  tone = 'teal',
}: {
  products: ProductItem[];
  /** Field name when the form posts directly; omitted when state is lifted. */
  name?: string;
  selected: string[];
  onToggle: (code: string) => void;
  /** Teal on the interaction form, navy on capture — matches each form's submit. */
  tone?: 'teal' | 'navy';
}) {
  if (products.length === 0) return null;

  const topLevel = products.filter((product) => !product.parentId);
  const childrenOf = (parentId: string) =>
    products.filter((product) => product.parentId === parentId);

  const checkedStyle =
    tone === 'navy'
      ? 'has-[:checked]:border-navy-500 has-[:checked]:bg-navy-500 has-[:checked]:text-white'
      : 'has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white';

  const chip = (product: ProductItem, sub = false) => (
    <label
      key={product.code}
      title={product.summary ?? undefined}
      className={`cursor-pointer rounded-lg border px-2.5 py-1 font-semibold transition-colors ${checkedStyle} ${
        sub
          ? 'border-dashed border-[var(--color-border-strong)] text-[0.6875rem]'
          : 'border-[var(--color-border-strong)] text-xs'
      }`}
    >
      <input
        type="checkbox"
        name={name}
        value={name ? product.code : undefined}
        checked={selected.includes(product.code)}
        onChange={() => onToggle(product.code)}
        aria-label={sub ? `${product.parentName ?? ''} ${product.name}`.trim() : product.name}
        className="sr-only"
      />
      {product.name}
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
      {topLevel.map((parent) => {
        const children = childrenOf(parent.id);
        if (children.length === 0) return chip(parent);

        return (
          <span
            key={parent.id}
            // Wraps inside the group as well: a parent with five sub-products
            // would otherwise run off the side of a phone. The tinted
            // background keeps them read as one unit even across two lines.
            className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg bg-[var(--color-surface-muted)] px-1.5 py-1"
          >
            {chip(parent)}
            <span aria-hidden className="text-xs text-[var(--color-text-subtle)]">
              &rsaquo;
            </span>
            {children.map((child) => chip(child, true))}
          </span>
        );
      })}
    </div>
  );
}
