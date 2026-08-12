import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NewLeadForm } from '@/components/leads/NewLeadForm';
import type { LeadSourceItem, ProductItem } from '@sihl-one/contracts';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'New lead' };

export default async function NewLeadPage() {
  const user = await requireUser();

  // Server-side gate. Hiding the nav link is a courtesy; this is the check that
  // stops someone typing the URL.
  if (!can(user, 'lead:create')) redirect('/leads');

  // Active rows only — a source switched off yesterday must not be offerable
  // today, even though every lead already carrying it still reads fine.
  const [sources, products, assignable] = await Promise.all([
    apiFetch<LeadSourceItem[]>('/masters/lead-sources'),
    apiFetch<ProductItem[]>('/masters/products'),
    can(user, 'lead:assign')
      ? apiFetch<Array<{ id: string; fullName: string; orgUnit: string | null }>>(
          '/users/assignable',
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/leads" className="hover:underline">
          Leads
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>New</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">Add a lead</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Only a name, mobile number and source are required. Everything else can be filled in as
          you qualify.
        </p>
      </header>

      <div className="card p-5">
        <NewLeadForm
          sources={sources}
          products={products}
          assignableUsers={assignable}
          canAssign={can(user, 'lead:assign')}
        />
      </div>
    </div>
  );
}
