import { humanise } from '@/lib/format';

/**
 * Product interest as chips, truncated.
 *
 * Deliberately not the full product detail. A lead can carry up to six products
 * and a customer more; rendering detail per row gives variable-height rows and
 * an unreadable table by about the fourth lead. The chips answer "what are they
 * after?" at a glance and the record itself answers everything else.
 *
 * The remainder is shown as a count with the names in the tooltip, so nothing is
 * hidden outright — the information is one hover away rather than one page away.
 */
export function ProductChips({
  codes,
  labels,
  max = 2,
  tone = 'solid',
}: {
  codes: string[];
  /** Code → display name, from the product master. Falls back to the code. */
  labels?: Record<string, string>;
  max?: number;
  /** `solid` for what they hold, `outline` for what they are interested in. */
  tone?: 'solid' | 'outline';
}) {
  if (!codes.length) return <span className="text-[var(--color-text-subtle)]">—</span>;

  const name = (code: string) => labels?.[code] ?? humanise(code);
  const shown = codes.slice(0, max);
  const rest = codes.slice(max);

  const base =
    'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold leading-4';
  const styles =
    tone === 'solid'
      ? `${base} bg-navy-500 text-white`
      : `${base} border border-[var(--color-border-strong)] text-[var(--color-text-muted)]`;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((code) => (
        <span key={code} className={styles} title={name(code)}>
          {name(code)}
        </span>
      ))}
      {rest.length > 0 ? (
        <span
          className={`${base} text-[var(--color-text-subtle)]`}
          title={rest.map(name).join(', ')}
        >
          +{rest.length}
        </span>
      ) : null}
    </span>
  );
}
