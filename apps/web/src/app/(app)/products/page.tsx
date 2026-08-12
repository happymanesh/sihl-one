import Link from 'next/link';
import type { ProductItem } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Products' };

export default async function ProductsPage() {
  await requireUser();

  // Active only. A product switched off is one SIHL has stopped selling, and a
  // rep should not find it here and pitch it.
  const products = await apiFetch<ProductItem[]>('/masters/products');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          What SIHL offers, in the words to use with a client. Open one during a call or hold it
          up across the desk.
        </p>
      </header>

      {products.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="grid" size={40} />}
            title="No products yet"
            description="An administrator adds these under Sources and products."
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.code}`}
                className="card flex h-full flex-col p-4 transition-shadow hover:shadow-raised"
              >
                <p className="font-bold">{product.name}</p>
                <p className="mt-1 flex-1 text-sm text-[var(--color-text-muted)]">
                  {product.summary ?? 'No description yet.'}
                </p>
                <p className="mt-3 text-xs font-semibold text-navy-600 dark:text-teal-300">
                  {product.keyBenefits.length > 0
                    ? `${product.keyBenefits.length} talking points →`
                    : 'Open →'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
