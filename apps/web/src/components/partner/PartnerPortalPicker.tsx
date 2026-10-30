'use client';

import { useRouter } from 'next/navigation';
import type { Route } from 'next';

/**
 * Which partner's portal a super admin is looking at.
 *
 * Only shown to super admin — a partner has exactly one portal and never
 * needs to choose. It exists so support can answer "what does this partner
 * actually see", which the Partners directory cannot: that shows the firm as
 * SIHL sees it, not the referral link and lead list the partner logs in to.
 *
 * The choice goes in the URL rather than component state, so a particular
 * partner's portal is a link somebody can send and a refresh keeps it.
 */
export function PartnerPortalPicker({
  partners,
  selectedId,
}: {
  partners: Array<{ id: string; name: string }>;
  selectedId?: string;
}) {
  const router = useRouter();

  return (
    <div className="card flex flex-wrap items-center gap-3 p-3">
      <label className="label mb-0" htmlFor="partner-portal-picker">
        Viewing as
      </label>
      <select
        id="partner-portal-picker"
        className="input h-9 sm:max-w-sm"
        value={selectedId ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          router.push((next ? `/partner?partnerId=${next}` : '/partner') as Route);
        }}
      >
        <option value="">Choose a partner</option>
        {partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-[var(--color-text-subtle)]">
        You are seeing this partner&rsquo;s own view, read-only.
      </p>
    </div>
  );
}
