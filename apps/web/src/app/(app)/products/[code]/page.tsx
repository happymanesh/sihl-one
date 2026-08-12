import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ProductItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const product = await apiFetch<ProductItem>(
    `/masters/products/${encodeURIComponent(code)}`,
  ).catch(() => null);
  return { title: product ? product.name : 'Product' };
}

/**
 * One product, written to be read aloud.
 *
 * This is the screen a relationship manager turns towards a client, often on a
 * phone across a desk. So: large type, benefits as separate scannable lines
 * rather than a paragraph, and the charges and risk wording given their own
 * blocks instead of being folded into prose a rep would have to paraphrase
 * under pressure.
 *
 * Everything here is authored by an administrator in the product master. The
 * screen adds no numbers of its own — pricing SIHL has not stated is pricing
 * nobody should read out.
 */
export default async function ProductPage({ params }: Props) {
  await requireUser();
  const { code } = await params;

  const product = await apiFetch<ProductItem>(
    `/masters/products/${encodeURIComponent(code)}`,
  ).catch(() => null);
  if (!product) notFound();

  const hasContent = Boolean(
    product.description || product.keyBenefits.length > 0 || product.chargesSummary,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link
          href="/products"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All products
        </Link>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl font-bold">{product.name}</h1>
          {!product.isActive ? <Badge tone="amber">Not currently offered</Badge> : null}
        </div>
        {product.summary ? (
          <p className="mt-2 text-lg text-[var(--color-text-muted)]">{product.summary}</p>
        ) : null}
      </header>

      {!hasContent ? (
        <section className="card p-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            {/* Said plainly rather than showing an empty page. The rep needs to
                know this is missing content, not a broken screen. */}
            Nobody has written the details for this product yet. Ask an administrator to fill it
            in under Sources and products — until then, do not improvise the terms.
          </p>
        </section>
      ) : null}

      {product.keyBenefits.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-bold">Why a client would want this</h2>
          <ul className="mt-3 space-y-2.5">
            {product.keyBenefits.map((benefit) => (
              <li key={benefit} className="flex gap-2.5 text-base">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {product.description ? (
        <section className="card p-5">
          <h2 className="font-bold">In more detail</h2>
          {/* Rendered as plain paragraphs, not HTML. The text is
              administrator-authored, but a catalogue is not a reason to put an
              HTML sink on a page every salesperson opens. */}
          <div className="mt-3 space-y-3 text-base leading-relaxed">
            {product.description
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
          </div>
        </section>
      ) : null}

      {product.chargesSummary ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">Charges</h2>
            <Badge tone="amber">Indicative</Badge>
          </div>
          <p className="mt-3 text-base">{product.chargesSummary}</p>
          <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {/* ADR-0002. The back office owns pricing; quoting a figure from
                here as final is how a client is told the wrong number. */}
            Indicative only. Confirm the applicable rate with operations before committing to it
            with a client.
          </p>
        </section>
      ) : null}

      {product.eligibility ? (
        <section className="card p-5">
          <h2 className="font-bold">Who can open this</h2>
          <p className="mt-3 text-base">{product.eligibility}</p>
        </section>
      ) : null}

      {product.riskNote ? (
        <section className="card border-warn-500/40 p-5">
          <h2 className="font-bold">Risk</h2>
          {/* Its own block, not a footnote. Where SEBI wording applies it has to
              be said, and a rep skim-reading should not be able to miss it. */}
          <p className="mt-3 text-base">{product.riskNote}</p>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-bold">Interest in this product</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {formatNumber(product.leadCount)}{' '}
              {product.leadCount === 1 ? 'lead has' : 'leads have'} asked about it.
            </p>
          </div>
          <Link href="/leads/new" className="btn btn-primary">
            Add a lead
          </Link>
        </div>
      </section>

      <p className="text-xs text-[var(--color-text-subtle)]">
        Investments in securities are subject to market risks. Read all related documents
        carefully before investing.
      </p>
    </div>
  );
}
