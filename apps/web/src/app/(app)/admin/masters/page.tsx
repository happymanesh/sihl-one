import { redirect } from 'next/navigation';
import type { LeadSourceItem, ProductItem } from '@sihl-one/contracts';

import { MastersManager } from '@/components/masters/MastersManager';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Sources and products' };

export default async function MastersPage() {
  const user = await requireUser();
  // Admin only, as asked. `system:configure` is held by SUPER_ADMIN alone.
  if (!can(user, 'system:configure')) redirect('/dashboard');

  const [sources, products] = await Promise.all([
    apiFetch<LeadSourceItem[]>('/masters/lead-sources?includeInactive=true'),
    apiFetch<ProductItem[]>('/masters/products?includeInactive=true'),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Sources and products</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          What appears in the Add lead dropdowns. Entries SIHL ONE shipped with can be renamed
          and switched off, but not removed — rules and past leads point at their codes.
        </p>
      </header>

      <MastersManager sources={sources} products={products} />
    </div>
  );
}
