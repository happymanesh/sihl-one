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

  /*
    One row per desk, in the order the master defines.

    Fourteen chips in a single wrapping run read as one undifferentiated list:
    Mutual funds sat next to Currency with nothing to say they are two different
    businesses, and which desk a product belonged to could not be seen at all.
    Grouping is the information a rep is actually using when they tick these.

    A product with no group collects under "Other" rather than being dropped —
    an unfiled product is a gap in the master, not a reason to hide something a
    client asked about.
  */
  const groups: Array<{ name: string; parents: ProductItem[] }> = [];
  for (const parent of topLevel) {
    const name = parent.groupName ?? 'Other';
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.parents.push(parent);
    else groups.push({ name, parents: [parent] });
  }

  return (
    /*
      A grid, not indented text: the chips column starts at the same x on every
      row, so a desk whose products wrap continues under the products rather
      than under the label — and a long desk name cannot shunt the first row
      out of line with the rest.
    */
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2">
      {groups.map((group) => (
        <div key={group.name} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <span className="whitespace-nowrap text-xs font-bold text-[var(--color-text-muted)]">
            {group.name} :
          </span>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
            {group.parents.map((parent) => {
              const children = childrenOf(parent.id);
              if (children.length === 0) return chip(parent);

              return (
                <span
                  key={parent.id}
                  // Wraps inside the group as well: a parent with five
                  // sub-products would otherwise run off the side of a phone.
                  // The tinted background keeps them read as one unit even
                  // across two lines.
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
        </div>
      ))}
    </div>
  );
}
