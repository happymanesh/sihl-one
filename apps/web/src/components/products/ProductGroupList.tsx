import type { ProductItem } from '@sihl-one/contracts';

/**
 * A set of products read the way the desks are organised.
 *
 * One line per group, the group's name first, then its products — and a
 * sub-product written against its parent, because "Intraday" alone does not
 * say what it is intraday *of*:
 *
 *     Broking :   Equity : Intraday, F&O, Commodity,
 *                 Currency
 *     Wealth :    Mutual funds, PMS
 *
 * A flat run of names was the same information with the structure taken out —
 * on a lead carrying six interests across two desks it read as one long list
 * and nobody could see at a glance that two businesses were in play.
 *
 * Laid out as a grid rather than with text indentation, so a group whose
 * products wrap continues under the products and not under the group name.
 * That is the alignment the product owner asked for and it is also the only
 * one that survives a long group name.
 */
export function ProductGroupList({
  codes,
  products,
  /** Rendered after a product's name — the lock marker, a status, a count. */
  annotate,
  emptyLabel = 'No products recorded',
  className = '',
}: {
  codes: readonly string[];
  products: readonly ProductItem[];
  annotate?: (code: string) => React.ReactNode;
  emptyLabel?: string;
  className?: string;
}) {
  const byCode = new Map(products.map((product) => [product.code, product]));

  /*
    Group, then parent, preserving the order the master is in.

    Ungrouped products collect under one heading rather than being dropped:
    a product with no group is a gap in the master, not a reason to hide
    something the client asked about.
  */
  const groups = new Map<string, Map<string, string[]>>();
  for (const code of codes) {
    const product = byCode.get(code);
    const group = product?.groupName ?? 'Other';
    const parent = product?.parentName ?? '';
    const label = product?.name ?? code;

    const parents = groups.get(group) ?? new Map<string, string[]>();
    parents.set(parent, [...(parents.get(parent) ?? []), label]);
    groups.set(group, parents);
  }

  if (codes.length === 0) {
    return <span className="text-xs text-[var(--color-text-subtle)]">{emptyLabel}</span>;
  }

  // Keyed by code so the annotation can find the product it belongs to.
  const codeOf = new Map<string, string>();
  for (const code of codes) codeOf.set(byCode.get(code)?.name ?? code, code);

  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm ${className}`}>
      {[...groups].map(([group, parents]) => (
        <div key={group} className="col-span-2 grid grid-cols-subgrid">
          <dt className="whitespace-nowrap font-semibold text-[var(--color-text-muted)]">
            {group} :
          </dt>
          <dd className="min-w-0">
            {[...parents].map(([parent, names], index) => (
              <span key={parent || '_'} className="break-words">
                {index > 0 ? <span aria-hidden>; </span> : null}
                {parent ? (
                  <span className="text-[var(--color-text-muted)]">{parent} : </span>
                ) : null}
                {names.map((name, i) => (
                  <span key={name}>
                    {i > 0 ? ', ' : ''}
                    {name}
                    {annotate?.(codeOf.get(name) ?? name)}
                  </span>
                ))}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
