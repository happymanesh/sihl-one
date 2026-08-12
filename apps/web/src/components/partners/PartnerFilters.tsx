import { PARTNER_STATUSES, PARTNER_TYPES } from '@sihl-one/contracts';

import { FilterBar } from '@/components/ui/FilterBar';
import { humanise } from '@/lib/format';

export function PartnerFilters() {
  return (
    <FilterBar
      searchLabel="Search partners"
      searchPlaceholder="Name, contact person or reference…"
      selects={[
        {
          name: 'status',
          label: 'All statuses',
          options: PARTNER_STATUSES.map((value) => ({ value, label: humanise(value) })),
        },
        {
          name: 'type',
          label: 'All types',
          options: PARTNER_TYPES.map((value) => ({ value, label: humanise(value) })),
        },
      ]}
    />
  );
}
